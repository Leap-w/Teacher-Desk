/**
 * 违纪 Store + Repository 自检（v3.8.0 · Phase 1A）。
 *
 * 这一层盯的是纯函数看不到的几条**链路不变量**：
 *
 * ① **空键不写盘**：设备上还没有违纪数据时，加载完一个字节都不写
 *    （云同步据此走「本地无此键 → 采纳云端」，加载时写 `[]` 会撞成首次同步冲突）。
 * ② **批量只写一次盘、只广播一次**：一次选 N 名学生 = N 条事件，但只有**一次**数组替换。
 *    循环调用单条新增的实现会在这里被 `writesFor` 当场抓住。
 * ③ **姓名快照随档案刷新，学生软删除不清历史**。
 * ④ **跨标签页广播两个方向**：本页改动广播键名；别的入口改完后本页重读并规范化。
 * ⑤ **云同步注册正确**：键出现在 `syncedKeys()` 里，且只有一个订阅者（重复订阅会规范化两遍）。
 */
import { nextTick } from 'vue'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeBroadcastChannel, installFakeBrowser, type FakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import { useStudentStore } from '@/stores/student'
import { useViolationStore } from '@/stores/violation'
import { readRaw } from '@/services/storage'
import { applySyncKeys, syncedKeys, syncSubscriberCount } from '@/services/sync'
import { VIOLATIONS_KEY } from '@/repositories'
import type { Student } from '@/types'
import type { ViolationBatchDraft, ViolationDraft, ViolationEvent } from '@/types/violation'

const prefix = appConfig.storageKeyPrefix
const STUDENTS_KEY = `${prefix}:students`

let browser: FakeBrowser

/**
 * 本用例里广播出去的消息。
 *
 * **监听原型而不是实例**：`services/sync.ts` 的通道是模块级缓存的，而
 * `installFakeBrowser()` 每个用例会把 `FakeBroadcastChannel.all` 清空——
 * 缓存实例不在数组里，按实例去数会漏，漏掉的表现恰好是「广播数 = 0」这种假通过
 * （与 `studentBatch.test.ts` 同一处置）。
 */
let posted: { kind: string; keys?: string[] }[]

/** 一份可控名册（s1…s10；姓名用可排序的中文，便于断言排行） */
function squad(count: number): Student[] {
  const names = ['安琪', '白玛', '陈晨', '旦增', '尔玛', '格桑', '何静', '金珠', '李雷']
  return Array.from({ length: count }, (_, index) => ({
    id: `s${index + 1}`,
    name: names[index % names.length] ?? `学生${index + 1}`,
    studentNo: String(index + 1).padStart(2, '0'),
    gender: index % 2 === 0 ? 'male' : 'female',
  }))
}

/** 一份完整的单条草稿（可覆写） */
function draft(overrides: Partial<ViolationDraft> = {}): ViolationDraft {
  return {
    studentId: 's1',
    date: '2026-11-03',
    timeSlotKind: 'forenoon',
    behaviorLabel: '迟到',
    severity: 'minor',
    ...overrides,
  }
}

/** 一份批量草稿（学生 id 由调用方逐人补，不在草稿里） */
function batchDraft(overrides: Partial<ViolationBatchDraft> = {}): ViolationBatchDraft {
  return {
    date: '2026-11-03',
    timeSlotKind: 'forenoon',
    behaviorLabel: '迟到',
    severity: 'minor',
    ...overrides,
  }
}

function seedStudents(roster: Student[]): void {
  browser.localStorage.seed(STUDENTS_KEY, JSON.stringify(roster))
}

/** 盘上某个键的原始数组（不经过被测代码读，避免「用被测对象验证自己」） */
function rawArray(key: string): Record<string, unknown>[] {
  const raw = readRaw(key)
  return raw ? (JSON.parse(raw) as Record<string, unknown>[]) : []
}

beforeEach(() => {
  browser = installFakeBrowser()
  setActivePinia(createPinia())
  posted = []
  vi.spyOn(FakeBroadcastChannel.prototype, 'postMessage').mockImplementation((data: unknown) => {
    posted.push(data as { kind: string; keys?: string[] })
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** 打开违纪 store（学生名册已播种） */
function openViolation(roster: Student[] = squad(6)) {
  seedStudents(roster)
  return useViolationStore()
}

/* ==================== 空键 ==================== */

describe('空键：不播种示例违纪、一个字节都不写', () => {
  it('首次打开没有违纪数据：空列表且不写盘（云同步据此采纳云端）', () => {
    const store = openViolation()
    expect(store.events).toEqual([])
    expect(browser.localStorage.writesFor(VIOLATIONS_KEY)).toBe(0)
  })

  it('键不存在时 repo.load() 返回空数组（不返回 null、不写盘）', async () => {
    seedStudents(squad(3))
    const { violationRepository } = await import('@/repositories')
    expect(violationRepository.load()).toEqual([])
    expect(browser.localStorage.writesFor(VIOLATIONS_KEY)).toBe(0)
  })

  it('云同步注册：键在 syncedKeys 里，且每次打开 store 只多一个订阅者（不会重复订阅）', () => {
    // 订阅表是模块级的，同一文件里前面的用例已经订过一次，所以这里看「增量 = 1」
    const before = syncSubscriberCount(VIOLATIONS_KEY)
    openViolation()
    expect(syncedKeys()).toContain(VIOLATIONS_KEY)
    expect(syncSubscriberCount(VIOLATIONS_KEY)).toBe(before + 1)
  })
})

/* ==================== 单条新增 ==================== */

describe('单条新增', () => {
  it('写入合法事件：id / 姓名快照 / 时间戳由 store 维护，且落盘一次', async () => {
    const store = openViolation()
    const created = store.addViolation(draft())
    expect(created).toBeTruthy()
    expect(created!.id).toBeTruthy()
    expect(created!.studentId).toBe('s1')
    expect(created!.studentName).toBe('安琪')
    expect(created!.createdAt).toBeTruthy()
    expect(created!.updatedAt).toBe(created!.createdAt)
    expect(store.events).toHaveLength(1)

    await nextTick()
    expect(browser.localStorage.writesFor(VIOLATIONS_KEY)).toBe(1)
    const onDisk = rawArray(VIOLATIONS_KEY)
    expect(onDisk).toHaveLength(1)
    expect(onDisk[0]).toMatchObject({ id: created!.id, studentId: 's1', behaviorLabel: '迟到' })
  })

  it('时间段 / 科目 / 家长意见随记录落盘（家长意见与教师备注分开）', async () => {
    const store = openViolation()
    const created = store.addViolation(
      draft({
        timeSlotKind: 'period',
        periodId: 'p3',
        subject: '数学',
        parentNote: '家长表示会督促',
        teacherNote: '已当面提醒',
      }),
    )!
    expect(created.periodLabel).toBe('第3节')
    expect(created.subject).toBe('数学')
    await nextTick()
    const onDisk = rawArray(VIOLATIONS_KEY)[0] as Record<string, unknown>
    expect(onDisk.parentNote).toBe('家长表示会督促')
    expect(onDisk.teacherNote).toBe('已当面提醒')
  })

  it('非法草稿 / 不在读名册的学生 → 拒绝写入且不写盘', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = openViolation()
    expect(store.addViolation(draft({ severity: 'critical' as never }))).toBeUndefined()
    expect(store.addViolation(draft({ date: '2026-02-30' }))).toBeUndefined()
    expect(store.addViolation(draft({ studentId: 'nobody' }))).toBeUndefined()
    expect(store.events).toHaveLength(0)
    await nextTick()
    expect(browser.localStorage.writesFor(VIOLATIONS_KEY)).toBe(0)
    warn.mockRestore()
  })
})

/* ==================== 批量新增 ==================== */

describe('批量新增：N 名学生 = N 条事件，但只写一次盘、只广播一次', () => {
  it('生成 N 条独立 id 的事件，共享一次提交时刻', async () => {
    const store = openViolation()
    const created = store.addViolationsForStudents(
      ['s1', 's2', 's3', 's4', 's5'],
      batchDraft({ date: '2026-11-04', behaviorLabel: '上课说话' }),
    )
    expect(created).toHaveLength(5)
    expect(new Set(created.map((item) => item.id)).size).toBe(5)
    expect(new Set(created.map((item) => item.createdAt)).size).toBe(1)
    expect(created.map((item) => item.studentId)).toEqual(['s1', 's2', 's3', 's4', 's5'])
    expect(store.events).toHaveLength(5)

    await nextTick()
    // ★ 这一条是「整体替换」纪律的硬断言：一次批量 = 一次写盘
    expect(browser.localStorage.writesFor(VIOLATIONS_KEY)).toBe(1)
    expect(rawArray(VIOLATIONS_KEY)).toHaveLength(5)
  })

  it('一次批量只广播一次键名（不是 N 次）', async () => {
    const store = openViolation()
    await nextTick()
    store.addViolationsForStudents(['s1', 's2', 's3'], batchDraft())
    await nextTick()
    expect(posted).toHaveLength(1)
    expect(posted[0]).toMatchObject({ kind: 'keys', keys: [VIOLATIONS_KEY] })
  })

  it('跳过不在读名册 / 重复的学生；全部无效时不写盘', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = openViolation()
    const created = store.addViolationsForStudents(['s1', 's1', 'nobody', 's2'], batchDraft())
    expect(created.map((item) => item.studentId)).toEqual(['s1', 's2'])
    expect(store.events).toHaveLength(2)
    // 先让第一次批量写盘落定，再量「无效请求一次都不该写」
    await nextTick()

    const writesBefore = browser.localStorage.writesFor(VIOLATIONS_KEY)
    expect(writesBefore).toBe(1)
    expect(store.addViolationsForStudents(['nobody'], batchDraft())).toEqual([])
    expect(store.addViolationsForStudents([], batchDraft())).toEqual([])
    expect(store.addViolationsForStudents(['s3'], batchDraft({ severity: 'x' as never }))).toEqual(
      [],
    )
    await nextTick()
    expect(browser.localStorage.writesFor(VIOLATIONS_KEY)).toBe(writesBefore)
    warn.mockRestore()
  })
})

/* ==================== 编辑 / 删除 ==================== */

describe('编辑与删除', () => {
  it('编辑：换等级、补家长意见；id / createdAt 不变；落盘更新', async () => {
    const store = openViolation()
    const created = store.addViolation(draft())!
    await nextTick()
    const updated = store.updateViolation(created.id, {
      severity: 'severe',
      parentNote: '家长已到校沟通',
      subject: '数学',
    })
    expect(updated).toBeTruthy()
    expect(updated!.id).toBe(created.id)
    expect(updated!.createdAt).toBe(created.createdAt)
    expect(updated!.severity).toBe('severe')
    expect(updated!.parentNote).toBe('家长已到校沟通')
    // 非 period 时间段不带科目（数据完整性：剔除自相矛盾的字段）
    expect('subject' in updated!).toBe(false)

    await nextTick()
    const onDisk = rawArray(VIOLATIONS_KEY)[0] as Record<string, unknown>
    expect(onDisk.severity).toBe('severe')
    expect(onDisk.parentNote).toBe('家长已到校沟通')
  })

  it('清空家长意见 = 真正删掉该键（不留空串）', async () => {
    const store = openViolation()
    const created = store.addViolation(draft({ parentNote: '先记一笔' }))!
    const updated = store.updateViolation(created.id, { parentNote: '' })!
    expect('parentNote' in updated).toBe(false)
    await nextTick()
    expect('parentNote' in (rawArray(VIOLATIONS_KEY)[0] as Record<string, unknown>)).toBe(false)
  })

  it('非法编辑 / 不存在的 id → 拒绝且不改数据', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = openViolation()
    const created = store.addViolation(draft())!
    expect(store.updateViolation(created.id, { date: '2026-13-01' })).toBeUndefined()
    expect(store.updateViolation(created.id, { severity: 'bad' as never })).toBeUndefined()
    expect(store.updateViolation('no-such-id', { severity: 'severe' })).toBeUndefined()
    expect(store.events[0]?.severity).toBe('minor')
    expect(store.events[0]?.date).toBe('2026-11-03')
    warn.mockRestore()
  })

  it('删除：移除记录并落盘；重复删除返回 false 且不写盘', async () => {
    const store = openViolation()
    const created = store.addViolation(draft())!
    await nextTick()
    const writesBefore = browser.localStorage.writesFor(VIOLATIONS_KEY)
    expect(store.removeViolation(created.id)).toBe(true)
    expect(store.events).toEqual([])
    await nextTick()
    expect(browser.localStorage.writesFor(VIOLATIONS_KEY)).toBe(writesBefore + 1)
    expect(rawArray(VIOLATIONS_KEY)).toEqual([])

    const writesAfter = browser.localStorage.writesFor(VIOLATIONS_KEY)
    expect(store.removeViolation(created.id)).toBe(false)
    await nextTick()
    expect(browser.localStorage.writesFor(VIOLATIONS_KEY)).toBe(writesAfter)
  })
})

/* ==================== 姓名快照 / 软删除 ==================== */

describe('学生关联：改名刷新快照、软删除不清历史', () => {
  it('学生改名后历史记录快照跟着刷新', async () => {
    const store = openViolation()
    const studentStore = useStudentStore()
    const created = store.addViolation(draft())!
    expect(created.studentName).toBe('安琪')

    studentStore.updateStudent('s1', { name: '安琪拉' })
    await nextTick()
    expect(store.events[0]?.studentName).toBe('安琪拉')
    expect(store.events[0]?.studentId).toBe('s1')
  })

  it('学生软删除后：记录仍在、个人历史仍可查、但不进排行与人数', async () => {
    const store = openViolation()
    const studentStore = useStudentStore()
    const created = store.addViolation(draft({ studentId: 's2' }))!
    store.addViolation(draft({ studentId: 's1' }))
    expect(store.overview.studentCount).toBe(2)

    studentStore.removeStudent('s2')
    await nextTick()

    // 历史不丢：个人档案仍能按 id 查
    expect(store.eventsOfStudent('s2')).toHaveLength(1)
    expect(store.eventsOfStudent('s2')[0]?.id).toBe(created.id)
    expect(store.statsOfStudent('s2').total).toBe(1)
    // 但不进排行、不计入在读人数
    expect(store.ranking.map((row) => row.studentId)).not.toContain('s2')
    expect(store.overview.studentCount).toBe(1)
    // 累计事件数仍然是全部历史（含已退档学生）
    expect(store.overview.total).toBe(2)
  })
})

/* ==================== 派生统计 ==================== */

describe('派生统计（全部实时算，不落计数器）', () => {
  it('概览 / 排行 / 经常违纪 / 按事件统计 / 次数映射随数据变化', async () => {
    const store = openViolation()
    store.addViolationsForStudents(['s1', 's2'], batchDraft({ behaviorLabel: '迟到' }))
    store.addViolation(draft({ studentId: 's1', behaviorLabel: '卫生脏乱' }))
    store.addViolation(
      draft({
        studentId: 's3',
        behaviorLabel: '打架',
        severity: 'severe',
      }),
    )
    await nextTick()

    expect(store.overview).toMatchObject({
      total: 4,
      studentCount: 3,
      severity: { minor: 3, moderate: 0, severe: 1 },
    })
    expect(store.ranking.map((row) => [row.studentId, row.count])).toEqual([
      ['s1', 2],
      ['s2', 1],
      ['s3', 1],
    ])
    expect(store.frequentStudents).toEqual([]) // 最高 2 次，未达 3 次门槛
    expect(store.behaviorCounts.find((row) => row.behaviorLabel === '迟到')?.count).toBe(2)
    expect(store.behaviorCounts.find((row) => row.behaviorLabel === '打架')?.count).toBe(1)
    expect(store.countByStudent.get('s1')).toBe(2)
    expect(store.severeEvents.map((item) => item.behaviorLabel)).toEqual(['打架'])
  })

  it('列表查询：按学生 / 等级 / 日期区间 / 关键词过滤，且按日期倒序（无分类筛选）', () => {
    const store = openViolation()
    store.addViolation(draft({ date: '2026-11-01', severity: 'minor' }))
    store.addViolation(
      draft({
        date: '2026-11-05',
        severity: 'severe',
        behaviorLabel: '打架',
        studentId: 's2',
      }),
    )
    store.addViolation(draft({ date: '2026-11-08', behaviorLabel: '旷课', studentId: 's1' }))

    expect(store.listEvents().map((item) => item.date)).toEqual([
      '2026-11-08',
      '2026-11-05',
      '2026-11-01',
    ])
    expect(store.listEvents({ studentId: 's1' })).toHaveLength(2)
    expect(store.listEvents({ severities: ['severe'] })).toHaveLength(1)
    // 日期区间两端都含
    expect(store.listEvents({ from: '2026-11-05', to: '2026-11-05' })).toHaveLength(1)
    expect(store.listEvents({ keyword: '旷课' })).toHaveLength(1)
    expect(store.listEvents({ keyword: '安琪' })).toHaveLength(2)
  })
})

/* ==================== 跨标签页 / 读盘复活 ==================== */

describe('跨标签页与读盘复活', () => {
  it('别的入口改了违纪键 → 本页重读并规范化', async () => {
    const store = openViolation(squad(2))
    await nextTick()

    // 扮演「另一个标签页」：先把新版内容写到盘上，再走与广播消息完全相同的入口
    // （`applySyncKeys` 就是 `handleMessage` 收到 keys 消息后调用的那个函数）
    browser.localStorage.seed(
      VIOLATIONS_KEY,
      JSON.stringify([
        {
          id: 'from-other-tab',
          studentId: 's1',
          studentName: '安琪',
          date: '2026-11-06',
          timeSlotKind: 'evening',
          behaviorLabel: '宿舍喧哗',
          severity: 'moderate',
          createdAt: '2026-11-06T01:00:00.000Z',
          updatedAt: '2026-11-06T01:00:00.000Z',
        },
      ]),
    )
    applySyncKeys([VIOLATIONS_KEY])
    await nextTick()

    expect(store.events).toHaveLength(1)
    expect(store.events[0]?.id).toBe('from-other-tab')
    expect(store.events[0]?.studentName).toBe('安琪')
  })

  it('盘上重复 id / 非法记录：加载时去重与丢弃，原文不动', () => {
    seedStudents(squad(2))
    browser.localStorage.seed(
      VIOLATIONS_KEY,
      JSON.stringify([
        {
          id: 'dup',
          studentId: 's1',
          studentName: '安琪',
          date: '2026-11-03',
          timeSlotKind: 'forenoon',
          behaviorLabel: '迟到',
          severity: 'minor',
          createdAt: '2026-11-03T01:00:00.000Z',
          updatedAt: '2026-11-03T01:00:00.000Z',
        },
        {
          id: 'dup',
          studentId: 's1',
          studentName: '安琪',
          date: '2026-11-04',
          timeSlotKind: 'forenoon',
          behaviorLabel: '旷课',
          severity: 'moderate',
          createdAt: '2026-11-04T01:00:00.000Z',
          updatedAt: '2026-11-04T01:00:00.000Z',
        },
        { id: 'bad', date: '坏日期' },
      ]),
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = useViolationStore()
    expect(store.events.map((item) => item.id)).toEqual(['dup'])
    // 盘上原文保留（不是被读操作冲成合法的两条）
    expect((JSON.parse(readRaw(VIOLATIONS_KEY)!) as unknown[]).length).toBe(3)
    warn.mockRestore()
  })
})

/* ==================== 类型回归 ==================== */

describe('返回类型（编译期钉住，运行期只做形状抽查）', () => {
  it('eventsOfStudent 返回按日期倒序的 ViolationEvent[]', () => {
    const store = openViolation()
    store.addViolation(draft({ studentId: 's1', date: '2026-11-01' }))
    store.addViolation(draft({ studentId: 's1', date: '2026-11-09' }))
    const rows: ViolationEvent[] = store.eventsOfStudent('s1')
    expect(rows.map((item) => item.date)).toEqual(['2026-11-09', '2026-11-01'])
  })
})
