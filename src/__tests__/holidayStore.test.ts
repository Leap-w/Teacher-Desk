/**
 * 假期 store 的写入口自检（v3.6.1）。
 *
 * 这一层盯的是**跨两个存储键的那几条不变量**——纯函数的自检（`holiday.test.ts`）看不到它们：
 *
 * ① **老键 `teacherdesk:weekendReturns` 的形状冻结**（v3.6.1 唯一一处结构性取舍）。
 *    周末的回家记录继续住在老键里，且**只带它原来那五个字段**。这不是洁癖：
 *    `services/sync.ts` 会把 revive 的结果写回磁盘并推云，而旧版本客户端的
 *    `normalizeWeekendReturn` 会按白名单重建对象、丢弃不认识的字段——老键一旦被新形状污染，
 *    一个长驻旧标签页或离线手机回线就可能整批抹掉记录再顺着「最后写入胜出」推到云端。
 *    所以这里既断言「新代码不往老键写新字段」，也断言**没被碰过的记录逐字节不变**。
 *
 * ② **批量只改选中的学生**（规格第 5 节的核心承诺）。10 人里选 5 人，另 5 人的记录
 *    必须一个字节都没动——断言写在这一层才有意义，纯函数那层只能证明「没被传进来」。
 *
 * ③ **幂等**。重复点同一个按钮 = 零写盘、零广播。跨端冲突面随每次写入变大，
 *    一个「点了没反应」的按钮不该在后台推两次云。
 *
 * ④ **回家优先**：老键里的回家记录压过同期的留校影子，且影子只被遮蔽、不被自动清掉。
 */
import { nextTick } from 'vue'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { FakeBroadcastChannel, installFakeBrowser, type FakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import { useNow } from '@/composables/useToday'
import { useHolidayStore } from '@/stores/holiday'
import { useStudentStore } from '@/stores/student'
import { useWeekendStore } from '@/stores/weekend'
import { weekendHolidayId } from '@/utils/holiday'
import { readRaw } from '@/services/storage'
import { syncedKeys } from '@/services/sync'
import {
  BACKUP_MODULES,
  LEGACY_CLEAR_MODULES,
  createBackup,
  parseBackup,
  planClearSamples,
  planMerge,
} from '@/utils/backup'
import type { Student } from '@/types'

const prefix = appConfig.storageKeyPrefix
const STUDENTS_KEY = `${prefix}:students`
const WEEKEND_KEY = `${prefix}:weekendReturns`
const HOLIDAYS_KEY = `${prefix}:holidays`
const RECORDS_KEY = `${prefix}:holidayRecords`

const SAT = '2026-09-19'
const WEEKEND_ID = weekendHolidayId(SAT)

let browser: FakeBrowser

/** 一份可控名单（学号 01…，性别交替）——批量断言要数得清人头 */
function squad(count: number): Student[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `s${index + 1}`,
    name: `学生${String(index + 1).padStart(2, '0')}`,
    studentNo: String(index + 1).padStart(2, '0'),
    gender: index % 2 === 0 ? 'male' : 'female',
  }))
}

beforeEach(() => {
  browser = installFakeBrowser()
  setActivePinia(createPinia())
  // 钉住共享时钟（同 `v331Linkage.test.ts` 的做法）：store 的 todayKey / 本周末 / 归月
  // 都读它，不钉住的话「9 月 19 日那一期」是不是本月、是不是本周末会随跑测试的日期变。
  // 2026-09-29 是周二 → 本周末 = 10/03，下周末 = 10/10，而 9/19 那一期已经过去了。
  useNow().value = new Date(2026, 8, 29, 10, 0, 0)
})

/** 播种一份名单再开 store：store 在创建时读盘，顺序不能反 */
function openHoliday(roster: Student[] = squad(10)) {
  browser.localStorage.seed(STUDENTS_KEY, JSON.stringify(roster))
  return useHolidayStore()
}

/** 盘上某个键的原始数组（不经过被测代码读，避免「用被测对象验证自己」） */
function rawArray(key: string): Record<string, unknown>[] {
  const raw = readRaw(key)
  return raw ? (JSON.parse(raw) as Record<string, unknown>[]) : []
}

/* ==================== 空键：一个字节都不写 ==================== */

describe('空数据不写盘（云同步据此走「采纳云端」）', () => {
  it('两个新键都不存在时，加载完一个字节都不写', () => {
    const store = openHoliday()
    expect(store.holidays).toEqual([])
    expect(store.records).toEqual([])
    expect(browser.localStorage.writesFor(HOLIDAYS_KEY)).toBe(0)
    expect(browser.localStorage.writesFor(RECORDS_KEY)).toBe(0)
  })
})

/* ==================== 三态 ==================== */

describe('三态派生与计数', () => {
  it('三数之和恒等于在读人数；未登记就是**没有记录**', async () => {
    const store = openHoliday()
    const created = store.createHoliday({
      name: '国庆',
      startDate: '2026-10-01',
      endDate: '2026-10-07',
    })
    expect(created).toBeTruthy()
    const id = created!.id

    expect(store.countsOf(id)).toEqual({ home: 0, stay: 0, unregistered: 10 })

    store.setStatuses(id, ['s1', 's2', 's3'], 'home')
    store.setStatuses(id, ['s4', 's5'], 'stay')
    await nextTick()

    expect(store.countsOf(id)).toEqual({ home: 3, stay: 2, unregistered: 5 })
    expect(store.statusIn(id, 's1')).toBe('home')
    expect(store.statusIn(id, 's4')).toBe('stay')
    expect(store.statusIn(id, 's9')).toBe('unregistered')
    // 分母永远是在读学生：三数之和 = 10
    const counts = store.countsOf(id)
    expect(counts.home + counts.stay + counts.unregistered).toBe(10)
  })

  it('已退档学生不进任何人数，但记录仍读得出来（页面用 stale 计数说出来）', async () => {
    const store = openHoliday()
    const studentStore = useStudentStore()
    const created = store.createHoliday({
      name: '国庆',
      startDate: '2026-10-01',
      endDate: '2026-10-07',
    })
    const id = created!.id
    store.setStatuses(id, ['s1', 's2', 's3'], 'home')
    await nextTick()

    studentStore.removeStudent('s1')
    await nextTick()

    expect(store.countsOf(id)).toEqual({ home: 2, stay: 0, unregistered: 7 })
    expect(store.staleCountOf(id)).toBe(1)
  })

  it('自定义假期的代表日取 startDate；周末取那个周六', async () => {
    const store = openHoliday()
    const created = store.createHoliday({
      name: '国庆',
      startDate: '2026-10-01',
      endDate: '2026-10-07',
    })
    store.setStatuses(created!.id, ['s1'], 'home')
    store.setStatuses(WEEKEND_ID, ['s2'], 'stay')
    await nextTick()

    const rows = rawArray(RECORDS_KEY)
    expect(rows.find((row) => row.studentId === 's1')).toMatchObject({
      date: '2026-10-01',
      returnHome: true,
    })
    expect(rows.find((row) => row.studentId === 's2')).toMatchObject({
      holidayId: WEEKEND_ID,
      date: SAT,
      returnHome: false,
    })
  })
})

/* ==================== 旧键冻结 ==================== */

describe('老键 teacherdesk:weekendReturns 的形状冻结', () => {
  it('**周末的回家仍进老键**，且只带原来那五个字段（不写 holidayId / returnHome）', async () => {
    const store = openHoliday()
    store.setStatuses(WEEKEND_ID, ['s1', 's2'], 'home')
    await nextTick()

    const rows = rawArray(WEEKEND_KEY)
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        ['createdAt', 'id', 'studentId', 'studentName', 'weekendDate'].sort(),
      )
      expect(row.weekendDate).toBe(SAT)
    }
    // 新键那边一条都不该有：回家的记录归老键管
    expect(rawArray(RECORDS_KEY)).toEqual([])
  })

  it('周末的留校进**新键**，老键一个字节都不动', async () => {
    const store = openHoliday()
    store.setStatuses(WEEKEND_ID, ['s1'], 'stay')
    await nextTick()

    expect(rawArray(WEEKEND_KEY)).toEqual([])
    expect(rawArray(RECORDS_KEY)).toHaveLength(1)
    expect(rawArray(RECORDS_KEY)[0]).toMatchObject({ holidayId: WEEKEND_ID, returnHome: false })
  })

  it('回家 → 留校 → 未登记 走一遍：老键里一条不剩（删是因为教师撤了，不是被踩踏）', async () => {
    const store = openHoliday()
    store.setStatuses(WEEKEND_ID, ['s1', 's2'], 'home')
    await nextTick()
    expect(rawArray(WEEKEND_KEY)).toHaveLength(2)

    store.setStatuses(WEEKEND_ID, ['s1', 's2'], 'stay')
    await nextTick()
    expect(rawArray(WEEKEND_KEY)).toEqual([])
    expect(rawArray(RECORDS_KEY).every((row) => row.returnHome === false)).toBe(true)

    store.setStatuses(WEEKEND_ID, ['s1', 's2'], 'unregistered')
    await nextTick()
    expect(rawArray(WEEKEND_KEY)).toEqual([])
    expect(rawArray(RECORDS_KEY)).toEqual([])
  })

  it('本来就没有登记的周末设为「未登记」：**一个字节都不写**，不凭空造出这个键', async () => {
    const store = openHoliday()
    expect(readRaw(WEEKEND_KEY)).toBeNull()

    // 计划为空（本来就都是未登记）→ 直接返回 0，两次调用都不该留下任何痕迹
    expect(store.setStatuses(WEEKEND_ID, ['s1', 's2'], 'unregistered')).toBe(0)
    await nextTick()
    expect(store.setStatuses(WEEKEND_ID, ['s1', 's2'], 'unregistered')).toBe(0)
    await nextTick()

    expect(readRaw(WEEKEND_KEY)).toBeNull()
    expect(readRaw(RECORDS_KEY)).toBeNull()
  })

  it('回家优先：老键有记录就是回家，同期的留校影子只被遮蔽、不被自动清掉', () => {
    // 造一个跨版本打架的现场：同一个学生、同一期，老键说回家、新键说留校。
    // 两份都先落到盘上，再开 store —— 首屏加载这条路径才是教师真正会遇到的那条
    browser.localStorage.seed(STUDENTS_KEY, JSON.stringify(squad(10)))
    browser.localStorage.seed(
      WEEKEND_KEY,
      JSON.stringify([
        {
          id: 'w1',
          studentId: 's1',
          studentName: '学生01',
          weekendDate: SAT,
          createdAt: '2026-09-19T00:00:00.000Z',
        },
      ]),
    )
    browser.localStorage.seed(
      RECORDS_KEY,
      JSON.stringify([
        {
          id: 'shadow',
          holidayId: WEEKEND_ID,
          studentId: 's1',
          studentName: '学生01',
          date: SAT,
          returnHome: false,
          createdAt: '2026-09-19T00:00:00.000Z',
        },
      ]),
    )

    const store = useHolidayStore()
    expect(store.statusIn(WEEKEND_ID, 's1')).toBe('home')
    // 影子还在盘上：教师没点按钮，数据就不该动
    expect(rawArray(RECORDS_KEY).some((row) => row.id === 'shadow')).toBe(true)
  })

  /**
   * 源码级哨兵。上面几条行为断言能证明**本机**不写脏字段，但冻不住「以后有人图省事，
   * 把 `holidayId` / `returnHome` 加回老键」这件事——那是一个形状约定，
   * 而形状一旦变化，**单机测试永远是绿的**：数据要等到一台长驻的旧标签页、
   * 或者离线手机回线时才会被整批抹掉（旧客户端的 `normalizeWeekendReturn`
   * 按白名单重建对象，认不出的字段静默丢弃），那时已经晚了。
   *
   * 所以这条断言看的是**源码文本**，不是运行结果——它与 `weekend.test.ts` 里
   * 「必须写明 zh-Hans-CN」那条同属一类：钉住的是一条靠人守的纪律。
   */
  it('老键的形状冻结：旧键的读写路径里不许出现新字段名（源码哨兵）', () => {
    const read = (relative: string) =>
      readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

    const sources = ['../utils/weekend.ts', '../repositories/weekend/weekendRepository.ts'].map(
      read,
    )

    for (const source of sources) {
      expect(source).not.toContain('holidayId')
      expect(source).not.toContain('returnHome')
    }
    // 老键那五个字段本身也要还在：少一个同样是形状变化（旧客户端读不出就是丢记录）
    const revival = sources[0]!
    for (const field of ['id', 'studentId', 'studentName', 'weekendDate', 'createdAt']) {
      expect(revival).toContain(field)
    }
  })
})

/* ==================== 批量：只改选中的人 ==================== */

describe('批量登记只作用于选中的学生', () => {
  it('10 人里选 5 人设为回家：**另 5 人的记录逐字节不变**', async () => {
    const store = openHoliday()
    // 先让后 5 人处在某个非「未登记」的状态，这样「有没有被碰到」才看得出来
    store.setStatuses(WEEKEND_ID, ['s6', 's7', 's8', 's9', 's10'], 'home')
    await nextTick()
    const untouchedBefore = rawArray(WEEKEND_KEY)
      .filter((row) => ['s6', 's7', 's8', 's9', 's10'].includes(String(row.studentId)))
      .map((row) => JSON.stringify(row))
      .sort()

    store.setStatuses(WEEKEND_ID, ['s1', 's2', 's3', 's4', 's5'], 'home')
    await nextTick()

    const untouchedAfter = rawArray(WEEKEND_KEY)
      .filter((row) => ['s6', 's7', 's8', 's9', 's10'].includes(String(row.studentId)))
      .map((row) => JSON.stringify(row))
      .sort()
    expect(untouchedAfter).toEqual(untouchedBefore)

    // 选中的那 5 人也确实被登记了
    expect(store.countsOf(WEEKEND_ID)).toEqual({ home: 10, stay: 0, unregistered: 0 })
  })

  it('函数没有「取全班」的入口：只传 3 个人，另外 7 个人一动不动', async () => {
    const store = openHoliday()
    const created = store.createHoliday({
      name: '国庆',
      startDate: '2026-10-01',
      endDate: '2026-10-07',
    })
    const id = created!.id
    store.setStatuses(id, ['s1', 's2', 's3'], 'stay')
    await nextTick()

    expect(store.countsOf(id)).toEqual({ home: 0, stay: 3, unregistered: 7 })
    expect(rawArray(RECORDS_KEY)).toHaveLength(3)
  })

  it('幂等：重复点同一个按钮 = 零写盘、零广播、返回 0', async () => {
    const store = openHoliday()
    store.setStatuses(WEEKEND_ID, ['s1', 's2'], 'home')
    await nextTick()

    const writesBefore = browser.localStorage.writesFor(WEEKEND_KEY)
    const broadcastsBefore = FakeBroadcastChannel.postedTotal()

    expect(store.setStatuses(WEEKEND_ID, ['s1', 's2'], 'home')).toBe(0)
    await nextTick()

    expect(browser.localStorage.writesFor(WEEKEND_KEY)).toBe(writesBefore)
    expect(FakeBroadcastChannel.postedTotal()).toBe(broadcastsBefore)
  })

  it('改向时对侧记录被删干净：不存在「既回家又留校」', async () => {
    const store = openHoliday()
    store.setStatuses(WEEKEND_ID, ['s1'], 'home')
    await nextTick()

    store.setStatuses(WEEKEND_ID, ['s1'], 'stay')
    await nextTick()
    expect(rawArray(WEEKEND_KEY)).toEqual([])
    expect(rawArray(RECORDS_KEY)).toHaveLength(1)

    store.setStatuses(WEEKEND_ID, ['s1'], 'home')
    await nextTick()
    expect(rawArray(RECORDS_KEY)).toEqual([])
    expect(rawArray(WEEKEND_KEY)).toHaveLength(1)
    expect(store.statusIn(WEEKEND_ID, 's1')).toBe('home')
  })

  it('返回值是**实际被改动的人数**，不是传入的人数', async () => {
    const store = openHoliday()
    expect(store.setStatuses(WEEKEND_ID, ['s1', 's2'], 'home')).toBe(2)
    await nextTick()
    // 已经都是回家：这次一个也没动
    expect(store.setStatuses(WEEKEND_ID, ['s1', 's2', 's3'], 'home')).toBe(1)
    await nextTick()
  })
})

/* ==================== 假期的增删改 ==================== */

describe('假期本身的增删改', () => {
  it('名字为空 / 日期非法 → 拒绝写入（返回 undefined，不落库）', async () => {
    const store = openHoliday()
    expect(
      store.createHoliday({ name: '   ', startDate: '2026-10-01', endDate: '2026-10-07' }),
    ).toBeUndefined()
    expect(
      store.createHoliday({ name: '国庆', startDate: '2026-2-31', endDate: '2026-10-07' }),
    ).toBeUndefined()
    await nextTick()
    expect(browser.localStorage.writesFor(HOLIDAYS_KEY)).toBe(0)
  })

  it('起止填反自动交换（教师手滑，不该让他重填一遍）', () => {
    const store = openHoliday()
    const created = store.createHoliday({
      name: '国庆',
      startDate: '2026-10-07',
      endDate: '2026-10-01',
    })
    expect(created).toMatchObject({ startDate: '2026-10-01', endDate: '2026-10-07' })
  })

  it('虚拟周末不可编辑、不可删除', async () => {
    const store = openHoliday()
    expect(store.updateHoliday(WEEKEND_ID, { name: '改个名' })).toBeUndefined()
    expect(store.removeHoliday(WEEKEND_ID)).toBe(false)
    await nextTick()
    expect(browser.localStorage.writesFor(HOLIDAYS_KEY)).toBe(0)
  })

  it('删除假期**级联删掉它名下的登记**，只删该假期的', async () => {
    const store = openHoliday()
    const national = store.createHoliday({
      name: '国庆',
      startDate: '2026-10-01',
      endDate: '2026-10-07',
    })!
    const state = store.createHoliday({
      name: '州庆',
      startDate: '2026-11-01',
      endDate: '2026-11-03',
    })!
    store.setStatuses(national.id, ['s1', 's2'], 'home')
    store.setStatuses(national.id, ['s3'], 'stay')
    store.setStatuses(state.id, ['s4'], 'home')
    await nextTick()

    // 确认文案里的数字 = 实际会被删掉的条数
    expect(store.cascadeCountOf(national.id)).toEqual({ total: 3, home: 2, stay: 1 })

    expect(store.removeHoliday(national.id)).toBe(true)
    await nextTick()

    expect(rawArray(HOLIDAYS_KEY).map((row) => row.name)).toEqual(['州庆'])
    expect(rawArray(RECORDS_KEY)).toHaveLength(1)
    expect(rawArray(RECORDS_KEY)[0]).toMatchObject({ holidayId: state.id, studentId: 's4' })
  })
})

/* ==================== 列表与孤儿 ==================== */

describe('列表派生与孤儿登记', () => {
  it('列表 = 自定义假期 ∪ 有登记的周末 ∪ 本周末 ∪ 下周末', async () => {
    const store = openHoliday()
    const weekendStore = useWeekendStore()
    const created = store.createHoliday({
      name: '国庆',
      startDate: '2026-10-01',
      endDate: '2026-10-07',
    })!
    // 一个**全员留校、无一人回家**的周末：老键里一条记录都没有，
    // 只按老键推导的话这一期会从列表里消失，而它恰恰是刚登记过的那一期
    store.setStatuses(WEEKEND_ID, ['s1'], 'stay')
    await nextTick()

    const ids = store.entries.map((entry) => entry.holiday.id)
    expect(ids).toContain(created.id)
    expect(ids).toContain(WEEKEND_ID)
    expect(ids).toContain(weekendHolidayId(weekendStore.currentWeekend))
    expect(ids).toContain(weekendHolidayId(weekendStore.nextWeekend))
  })

  it('孤儿登记（引用了不在列表里的假期）只提示、可手动清理，不自动删', async () => {
    browser.localStorage.seed(STUDENTS_KEY, JSON.stringify(squad(10)))
    browser.localStorage.seed(
      RECORDS_KEY,
      JSON.stringify([
        {
          id: 'orphan',
          holidayId: 'ghost-holiday',
          studentId: 's1',
          studentName: '学生01',
          date: '2026-10-01',
          returnHome: true,
          createdAt: '2026-10-01T00:00:00.000Z',
        },
      ]),
    )

    const store = useHolidayStore()
    // 假期「不在列表里」最常见的原因恰恰是它还没同步到这台设备——自动删等于清掉对方的合法数据
    expect(store.orphanCount).toBe(1)
    expect(rawArray(RECORDS_KEY)).toHaveLength(1)

    expect(store.clearOrphans()).toBe(1)
    await nextTick()
    expect(store.orphanCount).toBe(0)
    expect(rawArray(RECORDS_KEY)).toEqual([])
  })

  /**
   * 源码级哨兵（同上一条冻结老键那条的性质）。
   *
   * 「清理孤儿」是本模块唯一一处**一次删任意多条、且条数在点之前看不见**的动作：
   * 删假期删的是确定的那一个假期（弹窗里写明联带几条），批量登记删的是刚选中的那些人
   * （弹窗里写明几个人），只有孤儿清理是「底部一行字 + 一个「清理」链接」，点下去删几条
   * 取决于硬盘上攒了多少。而它删的又是**判定本身可能出错**的那一类——「孤儿」的定义是
   * 「假期不在本机列表里」，而列表可能只是还没同步过来（那正是它最常见的成因）。
   *
   * 这条断言盯的是源码文本，因为它要防的正是「以后有人顺手把 click 直接接到 store 的
   * `clearOrphans` 上」：那样改**行为测试照样全绿**——store 没变、功能也没坏，只是
   * 少了一次确认，而少掉的这次确认正好落在唯一一个真正需要它的地方。
   */
  it('「清理孤儿」走二次确认，且弹窗里给出「先同步一次」这条退路（源码哨兵）', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../views/Holiday/index.vue', import.meta.url)),
      'utf8',
    )
    // 按钮接的是页面里的 askClearOrphans，不许直接接到 store 的 clearOrphans
    expect(source).toContain('@click="askClearOrphans"')
    expect(source).not.toContain('@click="clearOrphans"')
    // 确认弹窗真在，且确认后才调 store
    expect(source).toContain('title="清理登记"')
    expect(source).toContain('confirmClearOrphans')
    // 退路必须写在弹窗里：不确定的人得知道「先同步一次再回来看」
    expect(source).toContain('立即同步')
  })
})

/* ==================== 本月人次 ==================== */

describe('本月回家人次', () => {
  it('周末按周六归月、自定义假期按 startDate 归月，留校不算「回家人次」', async () => {
    const store = openHoliday()
    const created = store.createHoliday({
      name: '国庆',
      startDate: '2026-10-01',
      endDate: '2026-10-07',
    })!
    store.setStatuses(WEEKEND_ID, ['s1', 's2'], 'home') // 9 月那一期（周六 9/19）
    store.setStatuses(created.id, ['s3'], 'home') // 10 月那一段
    store.setStatuses(created.id, ['s4'], 'stay') // 留校不算「回家人次」
    await nextTick()

    // 时钟已钉在 2026-09-29 → 本月 = 2026-09，只有 9/19 那一期的两个人算
    expect(store.todayKey.slice(0, 7)).toBe('2026-09')
    expect(store.monthHomeCount).toBe(2)
  })
})

/* ==================== 架构：键的注册 ==================== */

describe('同步键注册（云同步与备份都靠这一份名单）', () => {
  it('两个新键都登记进了同步名单——没登记就不会上云，也不会跨标签页唤醒', () => {
    setActivePinia(createPinia())
    useHolidayStore()

    // 云端「一个存储键 = 一份远端文档」，漏登记的键在两台设备之间永远不同步，
    // 而界面上不会有任何异常：教师只会看到「手机上录的，电脑上没有」
    expect(syncedKeys()).toContain(HOLIDAYS_KEY)
    expect(syncedKeys()).toContain(RECORDS_KEY)
  })

  it('假期这一屏**不新增第三个持久化键**：三份数据就是三个键，多一个都要在这里过一遍', () => {
    setActivePinia(createPinia())
    useHolidayStore()

    // 老键是 v3.6.0 就在的（周末回家），本模块只复用不新建
    const expected = [HOLIDAYS_KEY, RECORDS_KEY, WEEKEND_KEY]
    const holidayKeys = syncedKeys().filter(
      (key) => key.includes('holiday') || key.includes('weekend'),
    )
    expect(holidayKeys.sort()).toEqual([...expected].sort())
  })
})

/* ==================== 架构：备份 / 恢复 / 清空示例 ==================== */

describe('备份登记：漏一行的表现是「这个模块不参与备份」，界面上看不出来', () => {
  it('三个键都在 BACKUP_MODULES 里（含旧键，它只是改了显示名）', () => {
    for (const [key, label, unit] of [
      ['weekendReturns', '周末回家', '条'],
      ['holidays', '自定义假期', '个'],
      ['holidayRecords', '假期登记', '条'],
    ]) {
      const hit = BACKUP_MODULES.find((module) => module.key === `${prefix}:${key}`)
      expect(hit, `${key} 没登记进 BACKUP_MODULES`).toMatchObject({ label, unit })
    }
  })

  it('改的只是显示名：旧键的键名一个字符都没动', () => {
    // 改了键名 = 所有已发布的客户端、以及教师手边已有的备份文件，都找不到自己那份周末回家记录
    expect(BACKUP_MODULES.some((module) => module.key === WEEKEND_KEY)).toBe(true)
  })

  it('导出 → 解析 → 合并：自定义假期与假期登记原样回来', () => {
    const holidays = [
      {
        id: 'd6f1a2c4-0000-4000-8000-000000000001',
        name: '国庆假期',
        startDate: '2026-10-01',
        endDate: '2026-10-07',
        createdAt: '2026-09-29T02:00:00.000Z',
        updatedAt: '2026-09-29T02:00:00.000Z',
      },
    ]
    const records = [
      {
        id: 'd6f1a2c4-0000-4000-8000-000000000002',
        holidayId: 'd6f1a2c4-0000-4000-8000-000000000001',
        studentId: 's1',
        studentName: '学生01',
        date: '2026-10-01',
        returnHome: false,
        createdAt: '2026-09-29T02:00:00.000Z',
      },
    ]
    const disk: Record<string, string> = {
      [HOLIDAYS_KEY]: JSON.stringify(holidays),
      [RECORDS_KEY]: JSON.stringify(records),
    }

    // 导出时的 `read` 就是 localStorage.getItem 的形状
    const { backup, broken } = createBackup(
      (key) => disk[key] ?? null,
      new Date('2026-09-29T10:00:00.000Z'),
    )
    expect(broken).toEqual([])

    const parsed = parseBackup(JSON.stringify(backup))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    // 备份里认得出的块越多越好，但**不能有本应用不认识的块**——有就说明键名写错了
    expect(parsed.unknownModules).toEqual([])
    expect(parsed.backup.data[HOLIDAYS_KEY]).toHaveLength(1)
    expect(parsed.backup.data[RECORDS_KEY]).toHaveLength(1)

    // 新机器（本机什么都没有）合并回来：两份数据都要落地
    const plan = planMerge({}, parsed.backup)
    expect(plan.writes[HOLIDAYS_KEY]).toBeDefined()
    expect(plan.writes[RECORDS_KEY]).toBeDefined()
    expect(JSON.parse(plan.writes[HOLIDAYS_KEY]!)).toEqual(holidays)
    expect(JSON.parse(plan.writes[RECORDS_KEY]!)).toEqual(records)
  })
})

describe('「清空示例数据」不碰教师建的假期', () => {
  /** 示例学生（id 带 seed- 前缀，由 services/mock.ts 播种） */
  const SAMPLE_STUDENT = { id: 'seed-1', name: '示例学生', gender: 'male', studentNo: '9001' }
  const REAL_STUDENT = { id: 'b3c1d2e4-0000-4000-8000-000000000009', name: '真实学生' }

  const HOLIDAY = {
    id: 'd6f1a2c4-0000-4000-8000-000000000001',
    name: '国庆假期',
    startDate: '2026-10-01',
    endDate: '2026-10-07',
    createdAt: '2026-09-29T02:00:00.000Z',
    updatedAt: '2026-09-29T02:00:00.000Z',
  }

  /** 一条假期登记；id 走 createId 的 UUID，不是示例前缀 */
  function record(id: string, studentId: string, holidayId = HOLIDAY.id) {
    return {
      id,
      holidayId,
      studentId,
      studentName: '某学生',
      date: '2026-10-01',
      returnHome: false,
      createdAt: '2026-09-29T02:00:00.000Z',
    }
  }

  it('学生与示例返家记录被删，**假期与假期登记一条不动、一个字节都不写**', () => {
    const writes = planClearSamples({
      [STUDENTS_KEY]: [SAMPLE_STUDENT, REAL_STUDENT],
      // 老键里的示例返家记录（id 带 weekend- 前缀）该删
      [WEEKEND_KEY]: [
        {
          id: 'weekend-2026-09-19-s1',
          studentId: 'seed-1',
          studentName: '示例学生',
          weekendDate: '2026-09-19',
          createdAt: '2026-09-19T02:00:00.000Z',
        },
      ],
      [HOLIDAYS_KEY]: [HOLIDAY],
      [RECORDS_KEY]: [record('d6f1a2c4-0000-4000-8000-000000000002', 'seed-1')],
    })

    // 示例学生与示例返家记录照旧被清掉
    expect(writes.removed.map((item) => item.label)).toEqual(
      expect.arrayContaining(['学生档案', '周末回家']),
    )
    // 两个新键**连写都不写**：`writes` 里出现它们就说明「清空示例」动过教师建的假期
    expect(writes.writes[STUDENTS_KEY]).toBe(JSON.stringify([REAL_STUDENT]))
    expect(writes.writes[WEEKEND_KEY]).toBe('[]')
    expect(writes.writes[HOLIDAYS_KEY]).toBeUndefined()
    expect(writes.writes[RECORDS_KEY]).toBeUndefined()
    expect(writes.removed.map((item) => item.label)).not.toContain('自定义假期')
    expect(writes.removed.map((item) => item.label)).not.toContain('假期登记')
  })

  it('判定看的是记录的 `id`，不是 `holidayId`——虚拟周末的 holidayId 就以 `weekend:` 开头', () => {
    // `weekendHolidayId()` 造出来的 id 是 `weekend:2026-09-19`，而示例前缀表里有 `weekend-`。
    // 谁哪天把判定从 `item.id` 改成 `item.holidayId`（看着更「业务」），这一期**全体留校登记**
    // 会被当成示例数据一次删光——教师只会看到「清空示例数据」之后名单空了
    const writes = planClearSamples({
      [STUDENTS_KEY]: [REAL_STUDENT],
      [HOLIDAYS_KEY]: [],
      [RECORDS_KEY]: [
        record('d6f1a2c4-0000-4000-8000-000000000002', REAL_STUDENT.id, weekendHolidayId(SAT)),
      ],
    })

    expect(writes.writes[RECORDS_KEY]).toBeUndefined()
    expect(writes.removed).toEqual([])
  })

  it('「清空示例数据」不会删掉云端可能补回来的键：两个新键在备份表里，所以清空时会写 `[]` 而不是删键', () => {
    // 数据块表里的模块整块清空要写 `[]`——删键会让 seed-on-null 把示例数据又种回来
    // （见 planClearSamples 第三遍的注释）。两个新键**不播种**，因此上面那条断言是
    // 「一条没删就不写」，而不是「删键」。这里钉住的是：它们确实在数据块表里，
    // 走的是要写 `[]` 的那条路，而不是 LEGACY_CLEAR_MODULES 那条「删键」的路
    const legacyKeys = LEGACY_CLEAR_MODULES.map((module) => module.key)
    expect(legacyKeys).not.toContain(HOLIDAYS_KEY)
    expect(legacyKeys).not.toContain(RECORDS_KEY)
  })
})
