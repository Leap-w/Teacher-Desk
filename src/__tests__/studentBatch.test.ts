/**
 * 批量修改落库（Phase 5B）。
 *
 * 被测的是 `utils/studentBatch.ts` 的补丁规则与 `stores/student.ts` 的 `applyStudentBatch`。
 * 前者纯函数、后者只管分账，所以能把各种「教师点错了」的处境直接摆出来跑。
 *
 * 五条最要紧的：
 *  ① **整批只写一次盘、只广播一条**。`syncPersisted` 的 deep watch 盯着数组本身，
 *     一次整体替换 = 一次写盘；循环调 `updateStudent()` 的话，选 30 个人就是 30 次写盘
 *     + 30 条广播（`applyStudentImport` 的注释里已把这条写成纪律，这里把它测出来）。
 *  ② **性别与宿舍不符要跳过，不能写进去**。`normalizeStudent` 的白名单收敛会在下次
 *     加载时把错性别的房间清掉——写进去也是一个会自己消失的值，教师却先看到它生效了。
 *  ③ **「没变化」不等于「跳过」**。批量给全班加一个本来就有的标签，第二次执行应当
 *     报告「无需修改」；把它算进 `skipped`，教师会看到一句莫名其妙的「跳过 63 人」。
 *  ④ **不修改就是真的不修改**。「不修改」与「清空」必须区分开——混成一个的话，
 *     教师只想改宿舍时标签会整批没掉。
 *  ⑤ **不动无关学生**。整批替换 ≠ 全表重建：没被选中的学生对象引用不变。
 */
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeBroadcastChannel, installFakeBrowser, type FakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import { useStudentStore } from '@/stores/student'
import { splitTagInput } from '@/utils/studentBatch'
import type { Student } from '@/types'

const STUDENTS_KEY = `${appConfig.storageKeyPrefix}:students`

/** 女生宿舍 / 男生宿舍各一间，用于性别校验的用例 */
const GIRLS_ROOM = '女生2栋113'
const BOYS_ROOM = '男生1栋209'

function makeStudent(
  id: string,
  name: string,
  studentNo: string,
  extra: Partial<Student> = {},
): Student {
  return { id, name, studentNo, gender: 'female', ...extra }
}

/** 播种一份名单并拿到 store（store 在创建时读盘，顺序不能反） */
function seedAndOpen(students: Student[]) {
  browser.localStorage.seed(STUDENTS_KEY, JSON.stringify(students))
  return useStudentStore()
}

function find(store: ReturnType<typeof useStudentStore>, id: string): Student {
  const student = store.students.find((item) => item.id === id)
  if (!student) throw new Error(`名单里没有 ${id}`)
  return student
}

let browser: FakeBrowser
/**
 * 本用例里广播出去的消息。**监听原型而不是实例**：`services/sync.ts` 的通道是模块级
 * 缓存的，`installFakeBrowser()` 清空 `FakeBroadcastChannel.all` 之后，那个缓存实例
 * 已不在数组里——按实例去数会漏，而漏掉的表现恰好是「广播数 = 0」这种假通过。
 */
let posted: { kind: string; keys?: string[] }[]

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

describe('落库：整批一次写盘', () => {
  it('三人一起改宿舍：写盘一次、广播一条', async () => {
    const store = seedAndOpen([
      makeStudent('s1', '甲', '0101'),
      makeStudent('s2', '乙', '0102'),
      makeStudent('s3', '丙', '0103'),
    ])
    browser.localStorage.resetCounters()

    const outcome = store.applyStudentBatch(['s1', 's2', 's3'], { dormitory: GIRLS_ROOM })
    await nextTick()

    expect(outcome).toEqual({ updated: 3, skipped: 0 })
    expect(browser.localStorage.writesFor(STUDENTS_KEY)).toBe(1)
    expect(posted).toHaveLength(1)
    expect(posted[0]).toMatchObject({ kind: 'keys', keys: [STUDENTS_KEY] })
  })

  it('「未修改数」按人数报，不是按字段数', async () => {
    const store = seedAndOpen([makeStudent('s1', '甲', '0101'), makeStudent('s2', '乙', '0102')])
    browser.localStorage.resetCounters()

    // 一名学生同时改宿舍 + 班委 + 标签，只算「更新 1 名」
    const outcome = store.applyStudentBatch(['s1', 's2'], {
      dormitory: GIRLS_ROOM,
      cadreRole: '班长',
      addTags: ['走读'],
    })
    await nextTick()

    expect(outcome).toEqual({ updated: 2, skipped: 0 })
    expect(browser.localStorage.writesFor(STUDENTS_KEY)).toBe(1)
  })

  it('一个人都没变 → 不赋值：一个字节都不写、一条广播都不发', async () => {
    const store = seedAndOpen([makeStudent('s1', '甲', '0101', { dormitory: GIRLS_ROOM })])
    browser.localStorage.resetCounters()

    const outcome = store.applyStudentBatch(['s1'], { dormitory: GIRLS_ROOM })
    await nextTick()

    expect(outcome).toEqual({ updated: 0, skipped: 0 })
    expect(browser.localStorage.writesFor(STUDENTS_KEY)).toBe(0)
    expect(posted).toHaveLength(0)
  })

  it('空的 ids 与空 changes 都是安全的空操作', async () => {
    const store = seedAndOpen([makeStudent('s1', '甲', '0101')])
    browser.localStorage.resetCounters()

    expect(store.applyStudentBatch([], { dormitory: GIRLS_ROOM })).toEqual({
      updated: 0,
      skipped: 0,
    })
    expect(store.applyStudentBatch(['s1'], {})).toEqual({ updated: 0, skipped: 0 })
    await nextTick()

    expect(browser.localStorage.writesFor(STUDENTS_KEY)).toBe(0)
    expect(posted).toHaveLength(0)
  })
})

describe('补丁规则：不修改 ≠ 清空', () => {
  it('没提到的字段原样不动（只想改宿舍时，班委与标签不该被牵连）', async () => {
    const store = seedAndOpen([
      makeStudent('s1', '甲', '0101', {
        dormitory: GIRLS_ROOM,
        cadreRole: '学习委员',
        tags: ['走读'],
      }),
    ])

    store.applyStudentBatch(['s1'], { cadreRole: '班长' })
    await nextTick()

    const updated = find(store, 's1')
    expect(updated.cadreRole).toBe('班长')
    expect(updated.dormitory).toBe(GIRLS_ROOM)
    expect(updated.tags).toEqual(['走读'])
  })

  it('空串 = 清空：宿舍与班委都能批量清掉', async () => {
    const store = seedAndOpen([
      makeStudent('s1', '甲', '0101', { dormitory: GIRLS_ROOM, cadreRole: '班长' }),
    ])

    const outcome = store.applyStudentBatch(['s1'], { dormitory: '', cadreRole: '' })
    await nextTick()

    expect(outcome).toEqual({ updated: 1, skipped: 0 })
    expect(find(store, 's1').dormitory).toBeUndefined()
    expect(find(store, 's1').cadreRole).toBeUndefined()
  })

  it('本来就为空时清空不算更新（避免「批量清了 63 人」这种虚报）', async () => {
    const store = seedAndOpen([makeStudent('s1', '甲', '0101')])
    browser.localStorage.resetCounters()

    expect(store.applyStudentBatch(['s1'], { dormitory: '', cadreRole: '' })).toEqual({
      updated: 0,
      skipped: 0,
    })
    await nextTick()

    expect(browser.localStorage.writesFor(STUDENTS_KEY)).toBe(0)
  })

  it('班委职务两端的空格被清掉（自定义输入框里粘进来的）', async () => {
    const store = seedAndOpen([makeStudent('s1', '甲', '0101')])

    store.applyStudentBatch(['s1'], { cadreRole: '  劳动委员  ' })
    await nextTick()

    expect(find(store, 's1').cadreRole).toBe('劳动委员')
  })
})

describe('性别校验：不符的跳过，不做静默写入', () => {
  it('给女生选男生宿舍 → 跳过她、照常改别人', async () => {
    const store = seedAndOpen([
      makeStudent('s1', '女生甲', '0101'),
      makeStudent('s2', '男生乙', '0102', { gender: 'male' }),
    ])

    const outcome = store.applyStudentBatch(['s1', 's2'], { dormitory: BOYS_ROOM })
    await nextTick()

    expect(outcome).toEqual({ updated: 1, skipped: 1 })
    // 不写进去的理由：normalizeStudent 的宿舍白名单会在下次加载时把它清掉，
    // 教师会先看到它生效了一瞬间，再莫名其妙地消失
    expect(find(store, 's1').dormitory).toBeUndefined()
    expect(find(store, 's2').dormitory).toBe(BOYS_ROOM)
  })

  it('全班性别一致时一次都不跳过（跳过是例外，不是常态）', async () => {
    const store = seedAndOpen([
      makeStudent('s1', '甲', '0101'),
      makeStudent('s2', '乙', '0102'),
      makeStudent('s3', '丙', '0103'),
    ])

    expect(store.applyStudentBatch(['s1', 's2', 's3'], { dormitory: GIRLS_ROOM })).toEqual({
      updated: 3,
      skipped: 0,
    })
  })

  it('全员不符 → 一个都不改，也就一个字节都不写', async () => {
    const store = seedAndOpen([makeStudent('s1', '甲', '0101')])
    browser.localStorage.resetCounters()

    expect(store.applyStudentBatch(['s1'], { dormitory: BOYS_ROOM })).toEqual({
      updated: 0,
      skipped: 1,
    })
    await nextTick()

    expect(browser.localStorage.writesFor(STUDENTS_KEY)).toBe(0)
    expect(posted).toHaveLength(0)
  })

  it('清空宿舍不做性别校验（「未分配」对谁都成立）', async () => {
    const store = seedAndOpen([
      makeStudent('s1', '女生甲', '0101', { dormitory: GIRLS_ROOM }),
      makeStudent('s2', '男生乙', '0102', { gender: 'male', dormitory: BOYS_ROOM }),
    ])

    expect(store.applyStudentBatch(['s1', 's2'], { dormitory: '' })).toEqual({
      updated: 2,
      skipped: 0,
    })
  })
})

describe('标签：去重与移除', () => {
  it('添加已存在的标签不算更新（第二次「批量加走读」应当报告无需修改）', async () => {
    const store = seedAndOpen([makeStudent('s1', '甲', '0101', { tags: ['走读'] })])
    browser.localStorage.resetCounters()

    const outcome = store.applyStudentBatch(['s1'], { addTags: ['走读'] })
    await nextTick()

    expect(outcome).toEqual({ updated: 0, skipped: 0 })
    expect(browser.localStorage.writesFor(STUDENTS_KEY)).toBe(0)
    expect(find(store, 's1').tags).toEqual(['走读'])
  })

  it('已有标签排在前面，新标签追加在后（顺序稳定，不整批重排）', async () => {
    const store = seedAndOpen([makeStudent('s1', '甲', '0101', { tags: ['走读', '三好学生'] })])

    store.applyStudentBatch(['s1'], { addTags: ['三好学生', '体育骨干'] })
    await nextTick()

    expect(find(store, 's1').tags).toEqual(['走读', '三好学生', '体育骨干'])
  })

  it('一次添加里自己重复的标签只留一个', async () => {
    const store = seedAndOpen([makeStudent('s1', '甲', '0101')])

    store.applyStudentBatch(['s1'], { addTags: ['走读', '走读', ' 走读 '] })
    await nextTick()

    expect(find(store, 's1').tags).toEqual(['走读'])
  })

  it('移除指定标签，其余保持原序', async () => {
    const store = seedAndOpen([
      makeStudent('s1', '甲', '0101', { tags: ['走读', '三好学生', '体育骨干'] }),
    ])

    store.applyStudentBatch(['s1'], { removeTags: ['三好学生'] })
    await nextTick()

    expect(find(store, 's1').tags).toEqual(['走读', '体育骨干'])
  })

  it('移除一个不存在的标签不算更新', async () => {
    const store = seedAndOpen([makeStudent('s1', '甲', '0101', { tags: ['走读'] })])
    browser.localStorage.resetCounters()

    expect(store.applyStudentBatch(['s1'], { removeTags: ['查无此签'] })).toEqual({
      updated: 0,
      skipped: 0,
    })
    await nextTick()

    expect(browser.localStorage.writesFor(STUDENTS_KEY)).toBe(0)
  })

  it('移除全部标签 → 标签变成空数组（而不是 undefined）', async () => {
    const store = seedAndOpen([makeStudent('s1', '甲', '0101', { tags: ['走读', '三好学生'] })])

    store.applyStudentBatch(['s1'], { removeTags: ['走读', '三好学生'] })
    await nextTick()

    expect(find(store, 's1').tags).toEqual([])
  })

  it('同时加与减：先减后加，同一个标签以「加」为准', async () => {
    const store = seedAndOpen([makeStudent('s1', '甲', '0101', { tags: ['走读', '三好学生'] })])

    store.applyStudentBatch(['s1'], { removeTags: ['走读'], addTags: ['走读'] })
    await nextTick()

    expect(find(store, 's1').tags).toEqual(['三好学生', '走读'])
  })

  it('没有标签的学生移除标签不算更新', async () => {
    const store = seedAndOpen([makeStudent('s1', '甲', '0101')])
    browser.localStorage.resetCounters()

    expect(store.applyStudentBatch(['s1'], { removeTags: ['走读'] })).toEqual({
      updated: 0,
      skipped: 0,
    })
    await nextTick()

    expect(browser.localStorage.writesFor(STUDENTS_KEY)).toBe(0)
  })
})

describe('分账：谁被动过、谁没动', () => {
  it('不在 ids 里的学生对象引用不变（整批替换 ≠ 全表重建）', async () => {
    const store = seedAndOpen([
      makeStudent('s1', '甲', '0101'),
      makeStudent('s2', '乙', '0102'),
      makeStudent('s3', '丙', '0103'),
    ])
    const untouched = find(store, 's3')

    store.applyStudentBatch(['s1', 's2'], { cadreRole: '班长' })
    await nextTick()

    expect(find(store, 's3')).toBe(untouched)
  })

  it('选中了但没变化的学生，引用同样不变（不该被顺手重新造一个）', async () => {
    const store = seedAndOpen([
      makeStudent('s1', '甲', '0101', { cadreRole: '班长' }),
      makeStudent('s2', '乙', '0102'),
    ])
    const noop = find(store, 's1')

    store.applyStudentBatch(['s1', 's2'], { cadreRole: '班长' })
    await nextTick()

    expect(find(store, 's1')).toBe(noop)
    expect(find(store, 's2').cadreRole).toBe('班长')
  })

  it('已被软删除的学生不参与批量修改，也不计入任何一边', async () => {
    const store = seedAndOpen([
      makeStudent('s1', '在读', '0101'),
      makeStudent('s2', '已退档', '0102', { deletedAt: '2026-01-01T00:00:00.000Z' }),
    ])

    const outcome = store.applyStudentBatch(['s1', 's2'], { cadreRole: '班长' })
    await nextTick()

    expect(outcome).toEqual({ updated: 1, skipped: 0 })
    expect(find(store, 's2').cadreRole).toBeUndefined()
    expect(find(store, 's2').deletedAt).toBeDefined()
  })

  it('名单里没有的 id 只是不匹配，不报错也不虚报计数', async () => {
    const store = seedAndOpen([makeStudent('s1', '甲', '0101')])

    expect(store.applyStudentBatch(['s1', '查无此人'], { cadreRole: '班长' })).toEqual({
      updated: 1,
      skipped: 0,
    })
  })

  it('座位号等档案不维护的字段原样保留（座位方案的自动就座还靠它）', async () => {
    const store = seedAndOpen([makeStudent('s1', '甲', '0101', { seatNumber: 7 })])

    store.applyStudentBatch(['s1'], { cadreRole: '班长' })
    await nextTick()

    expect(find(store, 's1').seatNumber).toBe(7)
  })
})

describe('标签输入框的切分', () => {
  it('半角 / 全角逗号、顿号、分号都是分隔符，且自动去重', () => {
    expect(splitTagInput('走读,三好学生，体育骨干、文艺;劳动；走读')).toEqual([
      '走读',
      '三好学生',
      '体育骨干',
      '文艺',
      '劳动',
    ])
  })

  it('空串与纯分隔符得到空数组', () => {
    expect(splitTagInput('')).toEqual([])
    expect(splitTagInput(' , ，、 ')).toEqual([])
  })
})
