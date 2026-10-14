/**
 * v3.7.5 §3「学期设置」+ §5「换课」自检。
 *
 * 这两块是同一条链上的两环，所以放在一个文件里测：**学期设置是教学周次的唯一来源，
 * 换课按周次生效**。链子断在哪一环，界面上都还「能点」，只是结果悄悄不对：
 *
 *  ① **周次只有一份**（§3.2）：开学日期 + 总周数 → 逐周递推。规格给的那张 20 周日期表
 *     是**验收依据、不是数据**——所以这里既逐行对照那张表，又把总周数改成 5 / 30 证明
 *     周次是算出来的；`.vue`（周次选择器）里若写死 20，学期改成 16 周时它还会给出
 *     「第 17 周」这种不存在的可选值，这里用源码级断言把这条路堵上。
 *  ② **结束日期不参与任何计算**（§3.1）：它只是教师自己记的一个日期。改它、留空、
 *     填一个和推算值不一致的日期，周次表都必须**一个字节不变**，只多一句提示。
 *  ③ **换课不动基础课表**（§5.1）：这是本轮换课与旧换课的根本区别。所以这里不满足于
 *     「结果看起来对」——换课之后**盘上课程表键的原文逐字节不变、写入计数为 0**，
 *     内存里的课表也逐条相等。
 *  ④ **冲突不许静默覆盖**（§5.4）：冲突要在**下笔之前**算出来（写入被整笔拒绝），
 *     提示里要有日期 / 星期 / 节次 / 涉及课程；编辑既有记录时要排除自身。
 *  ⑤ **缩短学期周数不删历史**（§3.4）：超范围的周次原样留在记录里，只在界面上报出来。
 *  ⑥ **旧记录不做破坏性迁移**（§5.5）：没有 `weeks` 字段的换课记录是当年直接改过基础
 *     课表的，保持原样、按老口径渲染与撤销——猜一个周次给它等于替教师编造生效范围。
 *
 * 仓库的常驻自检**没有 jsdom**（见 `vitest.config.ts`）：纯逻辑 / store / 数据层走运行时断言，
 * 组件的选法（全选 / 清空 / 快速范围）走既有的源码级断言惯例（同 `v331Linkage.test.ts`）。
 *
 * 写盘挂在 Vue 的 `watch`（pre-flush）上：**改完 store 必须先 `await nextTick()` 才读得到盘**。
 */
import { readFileSync } from 'node:fs'

import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { installFakeBrowser, type FakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import { useNow } from '@/composables/useToday'
import { syncedKeys } from '@/services/sync'
import { useSemesterStore } from '@/stores/semester'
import { useTimetableStore } from '@/stores/timetable'
import {
  appliesToWeek,
  describeExchangeWeeks,
  isWeeklyExchange,
  normalizeExchangeWeeks,
  resolveWeekLessons,
} from '@/utils/exchange'
import {
  DEFAULT_SEMESTER,
  SEMESTER_MAX_WEEKS,
  computedSemesterEnd,
  endDateMismatch,
  normalizeSemester,
  semesterWeeks,
  weekIndexOfDate,
} from '@/utils/semester'
import { classIdOf } from '@/utils/timetable'
import type { CourseExchange, CoursePeriodId, LessonInput, Weekday } from '@/types/timetable'

const prefix = appConfig.storageKeyPrefix
/** 学期设置：单元素数组（一个键 = 一份设置），见 repositories/semester */
const SEMESTER_KEY = `${prefix}:semester`
const LESSONS_KEY = `${prefix}:timetable`
const EXCHANGES_KEY = `${prefix}:timetable:exchanges`

const CLASS_NAME = '高一9班'

let browser: FakeBrowser

beforeEach(() => {
  browser = installFakeBrowser()
  // 首次打开课程表会播种示例课表——本文件测的是「我加的这几节」，
  // 与示例数据混在一起会让「课表原文不变」这类断言变成对播种逻辑的断言
  browser.localStorage.seed(LESSONS_KEY, JSON.stringify([]))
  browser.localStorage.seed(EXCHANGES_KEY, JSON.stringify([]))
  setActivePinia(createPinia())
})

function lesson(weekday: Weekday, periodId: CoursePeriodId, subject: string): LessonInput {
  return {
    weekday,
    periodId,
    subject,
    // classId 由班级名派生（班级名是唯一事实来源），写死别的值 store 会直接拒收
    classId: classIdOf(CLASS_NAME),
    className: CLASS_NAME,
    teacher: '我',
    type: 'normal',
  }
}

/** 盘上某个键的 JSON（不经过被测代码读，避免「用被测对象验证自己」） */
function disk(key: string): unknown {
  const raw = browser.localStorage.getItem(key)
  return raw === null ? null : JSON.parse(raw)
}

/* ==================================================================== */
/* ① 学期设置：教学周次是算出来的（§3.1 / §3.2）                          */
/* ==================================================================== */

describe('学期设置：第 1 周从开学日期起，每 7 天一周（§3.2）', () => {
  it('初始配置就是规格给定那四个字段（2026年秋季学期 / 2026-08-17 / 20 周 / 结束日期为空）', () => {
    expect(DEFAULT_SEMESTER).toEqual({
      id: 'semester',
      name: '2026年秋季学期',
      startDate: '2026-08-17',
      totalWeeks: 20,
      endDate: '',
    })
  })

  it('默认学期的 20 周起始日期逐行对照规格 §3.2 的表', () => {
    const expected: Array<[number, string]> = [
      [1, '2026-08-17'],
      [2, '2026-08-24'],
      [3, '2026-08-31'],
      [4, '2026-09-07'],
      [5, '2026-09-14'],
      [6, '2026-09-21'],
      [7, '2026-09-28'],
      [8, '2026-10-05'],
      [9, '2026-10-12'],
      [10, '2026-10-19'],
      [11, '2026-10-26'],
      [12, '2026-11-02'],
      [13, '2026-11-09'],
      [14, '2026-11-16'],
      [15, '2026-11-23'],
      [16, '2026-11-30'],
      [17, '2026-12-07'],
      [18, '2026-12-14'],
      [19, '2026-12-21'],
      [20, '2026-12-28'],
    ]
    const weeks = semesterWeeks(DEFAULT_SEMESTER)
    expect(weeks.map((week) => [week.index, week.startDate])).toEqual(expected)
    // 末周结束日 = 开学 + 20×7−1 天 = 2027-01-03（跨年也不出错）
    expect(weeks.at(-1)?.endDate).toBe('2027-01-03')
    expect(computedSemesterEnd(DEFAULT_SEMESTER)).toBe('2027-01-03')
  })

  it('每周的结束日恒为「起始 + 6 天」，周与周首尾相接', () => {
    const weeks = semesterWeeks({ ...DEFAULT_SEMESTER, totalWeeks: 30 })
    for (const week of weeks) {
      const month = Number(week.startDate.slice(5, 7))
      const day = Number(week.startDate.slice(8, 10))
      const expectedEnd = new Date(Date.UTC(Number(week.startDate.slice(0, 4)), month - 1, day + 6))
      const endKey = expectedEnd.toISOString().slice(0, 10)
      expect(week.endDate).toBe(endKey)
    }
  })

  it('总周数改了周次表跟着变——20 不是写死的常量', () => {
    expect(semesterWeeks({ ...DEFAULT_SEMESTER, totalWeeks: 5 })).toHaveLength(5)
    const thirty = semesterWeeks({ ...DEFAULT_SEMESTER, totalWeeks: 30 })
    expect(thirty).toHaveLength(30)
    // 第 30 周 = 开学 + 29×7 天 = 2027-03-08
    expect(thirty.at(-1)?.startDate).toBe('2027-03-08')
  })

  it('weekIndexOfDate：开学当天是第 1 周，学期范围外返回 undefined（不猜一个最近的周次）', () => {
    expect(weekIndexOfDate(DEFAULT_SEMESTER, '2026-08-17')).toBe(1)
    expect(weekIndexOfDate(DEFAULT_SEMESTER, '2026-08-23')).toBe(1) // 第 1 周周日
    expect(weekIndexOfDate(DEFAULT_SEMESTER, '2026-08-24')).toBe(2) // 第 2 周周一
    expect(weekIndexOfDate(DEFAULT_SEMESTER, '2026-12-28')).toBe(20)
    expect(weekIndexOfDate(DEFAULT_SEMESTER, '2027-01-03')).toBe(20) // 第 20 周周日
    // 开学前 / 学期结束后 / 非法日期：一律 undefined，而不是落到第 1 周或第 20 周
    expect(weekIndexOfDate(DEFAULT_SEMESTER, '2026-08-16')).toBeUndefined()
    expect(weekIndexOfDate(DEFAULT_SEMESTER, '2027-01-04')).toBeUndefined()
    expect(weekIndexOfDate(DEFAULT_SEMESTER, 'not-a-date')).toBeUndefined()
  })
})

describe('学期结束日期：仅作记录，不参与周次生成（§3.1）', () => {
  it('为空时不算「不一致」，也不阻止任何功能用这套周次', () => {
    expect(DEFAULT_SEMESTER.endDate).toBe('')
    expect(endDateMismatch(DEFAULT_SEMESTER)).toBe(false)
    expect(semesterWeeks(DEFAULT_SEMESTER)).toHaveLength(20)
  })

  it('改结束日期（早于 / 晚于推算值都行），周次表一个字节不变', () => {
    const base = semesterWeeks(DEFAULT_SEMESTER)
    expect(semesterWeeks({ ...DEFAULT_SEMESTER, endDate: '2027-01-15' })).toEqual(base)
    expect(semesterWeeks({ ...DEFAULT_SEMESTER, endDate: '2026-12-01' })).toEqual(base)
  })

  it('与推算值不一致时只是提示（不自动改任何配置）', () => {
    expect(
      endDateMismatch({ ...DEFAULT_SEMESTER, endDate: computedSemesterEnd(DEFAULT_SEMESTER) }),
    ).toBe(false)
    expect(endDateMismatch({ ...DEFAULT_SEMESTER, endDate: '2027-01-15' })).toBe(true)
    expect(endDateMismatch({ ...DEFAULT_SEMESTER, endDate: '2026-12-01' })).toBe(true)
  })

  it('normalizeSemester：结束日期非法就回空，而不是留一个假日期的值', () => {
    expect(normalizeSemester({ ...DEFAULT_SEMESTER, endDate: '2026-02-31' }).endDate).toBe('')
    expect(normalizeSemester({ ...DEFAULT_SEMESTER, endDate: '2027-01-15' }).endDate).toBe(
      '2027-01-15',
    )
    // 其余三个字段各自兜底：认不出就回默认值（不是丢弃整条设置）
    expect(normalizeSemester({}).totalWeeks).toBe(20)
    expect(normalizeSemester({ totalWeeks: SEMESTER_MAX_WEEKS + 1 }).totalWeeks).toBe(20)
    expect(normalizeSemester({ startDate: '9999-12-31' }).startDate).toBe('2026-08-17')
  })
})

/* ==================================================================== */
/* ② 学期设置 store：首次打开不写盘，改了才落盘（§3.4）                  */
/* ==================================================================== */

describe('学期设置 store：配置持久化与同步（§3.4）', () => {
  it('默认值不算教师的数据：没改过就一个字节都不写盘', async () => {
    const semester = useSemesterStore()
    expect(semester.settings).toEqual(DEFAULT_SEMESTER)
    expect(semester.weeks).toHaveLength(20)
    await nextTick()

    expect(browser.localStorage.getItem(SEMESTER_KEY)).toBeNull()
    expect(browser.localStorage.writesFor(SEMESTER_KEY)).toBe(0)
  })

  it('改完落盘：单元素数组、字段齐全、刷新后还在（重新加载模块 = 刷新页面）', async () => {
    const semester = useSemesterStore()
    expect(semester.update({ totalWeeks: 16, endDate: '2026-12-20' }).ok).toBe(true)
    await nextTick()

    expect(disk(SEMESTER_KEY)).toEqual([
      {
        id: 'semester',
        name: '2026年秋季学期',
        startDate: '2026-08-17',
        totalWeeks: 16,
        endDate: '2026-12-20',
      },
    ])

    vi.resetModules()
    const freshPinia = await import('pinia')
    freshPinia.setActivePinia(freshPinia.createPinia())
    const { useSemesterStore: freshUseSemesterStore } = await import('@/stores/semester')
    const reloaded = freshUseSemesterStore()
    expect(reloaded.settings.totalWeeks).toBe(16)
    expect(reloaded.settings.endDate).toBe('2026-12-20')
    expect(reloaded.weeks).toHaveLength(16)
    expect(reloaded.weeks[15]?.index).toBe(16)

    // 复位：把「当前 Pinia」还给本文件顶部静态 import 的那一份模块实例，
    // 否则后面的用例会拿到「没有 activePinia」
    setActivePinia(createPinia())
  })

  it('任一字段不合法整笔拒绝，盘上原文不变（不写半截）', async () => {
    const semester = useSemesterStore()
    semester.update({ totalWeeks: 18 })
    await nextTick()
    const before = browser.localStorage.getItem(SEMESTER_KEY)

    expect(semester.update({ name: '   ' }).ok).toBe(false)
    expect(semester.update({ startDate: '2026-13-01' }).ok).toBe(false)
    expect(semester.update({ startDate: '1999-01-01' }).ok).toBe(false)
    expect(semester.update({ totalWeeks: 0 }).ok).toBe(false)
    expect(semester.update({ totalWeeks: 2.5 }).ok).toBe(false)
    expect(semester.update({ totalWeeks: SEMESTER_MAX_WEEKS + 1 }).ok).toBe(false)
    expect(semester.update({ endDate: '2026-02-31' }).ok).toBe(false)
    await nextTick()

    expect(semester.settings.totalWeeks).toBe(18)
    expect(browser.localStorage.getItem(SEMESTER_KEY)).toBe(before)
  })

  it('学期键与换课键都走与其它模块同一条同步注册表（一个键 = 一份远端文档）', () => {
    useSemesterStore()
    expect(syncedKeys()).toContain(SEMESTER_KEY)
    // 换课键由课程表 store 注册（换课记录与课表同属一个模块）
    useTimetableStore()
    expect(syncedKeys()).toContain(EXCHANGES_KEY)
  })
})

/* ==================================================================== */
/* ③ 换课：只在选中的教学周生效，基础课表一个字节不动（§5.1 / §5.3）     */
/* ==================================================================== */

describe('换课：按教学周次生效的叠加层（§5.1 / §5.2 / §5.3）', () => {
  it('未选中的周仍显示基础课程，选中的周显示换课结果', () => {
    const store = useTimetableStore()
    const math = store.addLesson(lesson(1, 'p2', '数学'))!
    const result = store.exchangeLesson({
      lessonId: math.id,
      to: { weekday: 2, periodId: 'p3' },
      weeks: [3],
    })
    expect(result.ok).toBe(true)
    const exchangeId = result.ok ? result.exchanges[0]!.id : ''

    // 第 1 周（没选中）：原时段照常上课，目标时段是空的
    expect(store.lessonAt(1, 'p2', 1)?.subject).toBe('数学')
    expect(store.lessonAt(2, 'p3', 1)).toBeUndefined()

    // 第 3 周（选中）：原时段空出来（显示「调课」标记），目标时段出现搬过来的那一节
    expect(store.lessonAt(1, 'p2', 3)).toBeUndefined()
    expect(store.exchangeFromAt(1, 'p2', 3)?.id).toBe(exchangeId)
    const moved = store.lessonAt(2, 'p3', 3)!
    expect(moved.subject).toBe('数学')
    expect(moved.type).toBe('adjusted')
    expect(moved.exchangeId).toBe(exchangeId)

    // `week = undefined`（不在学期范围内）：直接看基础课表，不叠加任何东西
    expect(store.weekView(undefined).lessons).toEqual(store.lessons)
    expect(store.lessonAt(1, 'p2')).toBeDefined()
    expect(store.lessonAt(2, 'p3')).toBeUndefined()
  })

  it('多选不连续周次：第 3、4、8、12 周生效，第 5 周照旧（不连续也支持）', () => {
    const store = useTimetableStore()
    const math = store.addLesson(lesson(1, 'p2', '数学'))!
    expect(
      store.exchangeLesson({
        lessonId: math.id,
        to: { weekday: 2, periodId: 'p3' },
        weeks: [3, 4, 8, 12],
      }).ok,
    ).toBe(true)

    for (const week of [3, 4, 8, 12]) {
      expect(store.lessonAt(2, 'p3', week)?.subject).toBe('数学')
      expect(store.lessonAt(1, 'p2', week)).toBeUndefined()
    }
    for (const week of [1, 2, 5, 6, 7, 9, 20]) {
      expect(store.lessonAt(1, 'p2', week)?.subject).toBe('数学')
      expect(store.lessonAt(2, 'p3', week)).toBeUndefined()
    }
    // 生效周次原样落在记录上（升序去重）
    expect(store.exchanges[0]!.weeks).toEqual([3, 4, 8, 12])
    expect(store.weekView(5).appliedIds).toEqual([])
    expect(store.weekView(8).appliedIds).toEqual([store.exchanges[0]!.id])
  })

  it('今天就在选中的那一周：首页「今日课程」看到的是换过之后的课（§5.3 的当日路径）', () => {
    const store = useTimetableStore()
    const math = store.addLesson(lesson(1, 'p2', '数学'))!
    expect(
      store.exchangeLesson({
        lessonId: math.id,
        to: { weekday: 3, periodId: 'p3' },
        weeks: [5],
      }).ok,
    ).toBe(true)

    // 2026-09-16 是第 5 周（09-14 起）的周三：今天该上「搬到周三第3节」的那一节
    useNow().value = new Date('2026-09-16T09:00:00')
    expect(store.currentWeek).toBe(5)
    expect(store.todayLessons.map((item) => item.periodId)).toEqual(['p3'])

    // 2026-09-09 是第 4 周的周三：换课不在这一周生效，周三是空的
    useNow().value = new Date('2026-09-09T09:00:00')
    expect(store.currentWeek).toBe(4)
    expect(store.todayLessons).toHaveLength(0)

    // 学期范围外（2027-02-01 是寒假里的周一）：按基础课表看，不硬算一个最近的周次
    useNow().value = new Date('2027-02-01T09:00:00')
    expect(store.currentWeek).toBeUndefined()
    expect(store.todayLessons.map((item) => item.periodId)).toEqual(['p2']) // 基础课表：周一第2节
  })

  it('换课不动基础课表：盘上课程表键逐字节不变、写入计数为 0，内存里也逐条相等', async () => {
    const store = useTimetableStore()
    store.addLesson(lesson(1, 'p2', '数学'))
    store.addLesson(lesson(3, 'p4', '英语'))
    await nextTick()

    const beforeText = browser.localStorage.getItem(LESSONS_KEY)
    const beforeLessons = JSON.parse(beforeText!)
    browser.localStorage.resetCounters()

    const math = store.lessons[0]!
    expect(
      store.exchangeLesson({ lessonId: math.id, to: { weekday: 2, periodId: 'p3' }, weeks: [2, 3] })
        .ok,
    ).toBe(true)
    await nextTick()

    expect(browser.localStorage.getItem(LESSONS_KEY)).toBe(beforeText)
    expect(store.lessons).toEqual(beforeLessons)
    expect(browser.localStorage.writesFor(LESSONS_KEY)).toBe(0)
    // 换课是写自己的键——不是「什么都没落盘」
    expect(browser.localStorage.writesFor(EXCHANGES_KEY)).toBeGreaterThan(0)
    expect(disk(EXCHANGES_KEY)).toHaveLength(1)
  })

  it('删除换课只删规则：那一周自动回到基础课表，基础课表本来就没被动过', async () => {
    const store = useTimetableStore()
    const math = store.addLesson(lesson(1, 'p2', '数学'))!
    await nextTick()
    const beforeText = browser.localStorage.getItem(LESSONS_KEY)

    const created = store.exchangeLesson({
      lessonId: math.id,
      to: { weekday: 2, periodId: 'p3' },
      weeks: [3],
    })
    const id = created.ok ? created.exchanges[0]!.id : ''
    expect(store.removeExchange(id)).toBe(true)
    await nextTick()

    expect(store.exchanges).toHaveLength(0)
    expect(store.lessonAt(2, 'p3', 3)).toBeUndefined()
    expect(store.lessonAt(1, 'p2', 3)?.subject).toBe('数学')
    expect(browser.localStorage.getItem(LESSONS_KEY)).toBe(beforeText)
    expect(disk(EXCHANGES_KEY)).toEqual([])
  })

  it('撤销周次级换课 = 删记录（restored: 0），不再有「把课搬回来」这一步', async () => {
    const store = useTimetableStore()
    const math = store.addLesson(lesson(1, 'p2', '数学'))!
    const created = store.exchangeLesson({
      lessonId: math.id,
      to: { weekday: 2, periodId: 'p3' },
      weeks: [3],
    })
    const id = created.ok ? created.exchanges[0]!.id : ''

    expect(store.undoExchange(id)).toEqual({ ok: true, restored: 0 })
    await nextTick()
    expect(store.exchanges).toHaveLength(0)
    expect(store.lessonAt(1, 'p2', 3)?.subject).toBe('数学')
    expect(disk(EXCHANGES_KEY)).toEqual([])
  })

  it('换课记录落盘在独立的键上，刷新后还在（不是内存里的临时对象）', async () => {
    const store = useTimetableStore()
    const math = store.addLesson(lesson(1, 'p2', '数学'))!
    const created = store.exchangeLesson({
      lessonId: math.id,
      to: { weekday: 2, periodId: 'p3' },
      weeks: [3, 7],
    })
    const id = created.ok ? created.exchanges[0]!.id : ''
    await nextTick()

    vi.resetModules()
    const freshPinia = await import('pinia')
    freshPinia.setActivePinia(freshPinia.createPinia())
    const { useTimetableStore: freshUseTimetableStore } = await import('@/stores/timetable')
    const reloaded = freshUseTimetableStore()

    expect(reloaded.exchanges).toHaveLength(1)
    expect(reloaded.exchanges[0]!.id).toBe(id)
    expect(reloaded.exchanges[0]!.weeks).toEqual([3, 7])
    expect(reloaded.lessonAt(2, 'p3', 7)?.exchangeId).toBe(id)
    expect(reloaded.lessonAt(1, 'p2', 5)?.subject).toBe('数学')

    setActivePinia(createPinia())
  })
})

/* ==================================================================== */
/* ④ 冲突检测：下笔之前逐周试算，绝不静默覆盖（§5.4）                    */
/* ==================================================================== */

describe('换课冲突：写入前逐周试算，冲突整笔拒绝（§5.4）', () => {
  it('目标时段已被基础课表占住 → 拒绝写入，并说清日期 / 星期 / 节次 / 涉及课程', () => {
    const store = useTimetableStore()
    const math = store.addLesson(lesson(1, 'p2', '数学'))!
    store.addLesson(lesson(2, 'p3', '语文'))

    const result = store.exchangeLesson({
      lessonId: math.id,
      to: { weekday: 2, periodId: 'p3' },
      weeks: [3],
    })
    expect(result.ok).toBe(false)
    const reason = result.ok ? '' : result.reason
    expect(reason).toContain('第 3 周')
    expect(reason).toContain('周二')
    expect(reason).toContain('（9月1日）') // 第 3 周 09-01 —— 冲突日期要落到具体某天
    expect(reason).toContain('第3节')
    expect(reason).toContain('语文（高一9班）')
    expect(reason).toContain('不会覆盖')

    // 一个字节都没写：记录表空、目标位置还是原来那节课
    expect(store.exchanges).toHaveLength(0)
    expect(store.lessonAt(2, 'p3', 3)?.subject).toBe('语文')
  })

  it('两次换课抢同一个目标时段 → 后一次被拒（已写入的那条不被顶掉）', () => {
    const store = useTimetableStore()
    const math = store.addLesson(lesson(1, 'p2', '数学'))!
    const english = store.addLesson(lesson(3, 'p4', '英语'))!

    expect(
      store.exchangeLesson({ lessonId: math.id, to: { weekday: 2, periodId: 'p3' }, weeks: [3] })
        .ok,
    ).toBe(true)
    const second = store.exchangeLesson({
      lessonId: english.id,
      to: { weekday: 2, periodId: 'p3' },
      weeks: [3],
    })

    expect(second.ok).toBe(false)
    expect(second.ok ? '' : second.reason).toContain('都要调到这个时段')
    expect(store.exchanges).toHaveLength(1)
    // 第 3 周的目标时段仍是先到的那一节
    expect(store.lessonAt(2, 'p3', 3)?.subject).toBe('数学')
    // 后一次没生效：英语仍在周三第4节
    expect(store.lessonAt(3, 'p4', 3)?.subject).toBe('英语')
  })

  it('两次换课抢同一个源时段 → 后一次被拒', () => {
    const store = useTimetableStore()
    const math = store.addLesson(lesson(1, 'p2', '数学'))!

    expect(
      store.exchangeLesson({ lessonId: math.id, to: { weekday: 2, periodId: 'p3' }, weeks: [3] })
        .ok,
    ).toBe(true)
    const second = store.exchangeLesson({
      lessonId: math.id,
      to: { weekday: 4, periodId: 'p5' },
      weeks: [3],
    })

    expect(second.ok).toBe(false)
    expect(second.ok ? '' : second.reason).toContain('都要把这一节调走')
    expect(store.exchanges).toHaveLength(1)
    expect(store.lessonAt(4, 'p5', 3)).toBeUndefined()
  })

  it('同一周不冲突、叠加到另一周也是冲突：真正撞的是「同一周同一位置」', () => {
    const store = useTimetableStore()
    const math = store.addLesson(lesson(1, 'p2', '数学'))!
    const english = store.addLesson(lesson(3, 'p4', '英语'))!

    // 两次换课都调到 周二第3节，但周次完全错开 → 互不影响，都写入
    expect(
      store.exchangeLesson({ lessonId: math.id, to: { weekday: 2, periodId: 'p3' }, weeks: [3] })
        .ok,
    ).toBe(true)
    expect(
      store.exchangeLesson({ lessonId: english.id, to: { weekday: 2, periodId: 'p3' }, weeks: [5] })
        .ok,
    ).toBe(true)
    expect(store.exchanges).toHaveLength(2)
    expect(store.lessonAt(2, 'p3', 3)?.subject).toBe('数学')
    expect(store.lessonAt(2, 'p3', 5)?.subject).toBe('英语')

    // 第 3 周与第 5 周各有一条生效、各无冲突
    expect(store.weekView(3).conflicts).toHaveLength(0)
    expect(store.weekView(5).conflicts).toHaveLength(0)
    expect(store.conflictMessages(4)).toEqual([])
  })

  it('编辑既有换课：改变周次时排除自身，不会和自己判成冲突（§5.4 末段）', () => {
    const store = useTimetableStore()
    const math = store.addLesson(lesson(1, 'p2', '数学'))!
    const created = store.exchangeLesson({
      lessonId: math.id,
      to: { weekday: 2, periodId: 'p3' },
      weeks: [3],
    })
    const id = created.ok ? created.exchanges[0]!.id : ''

    // 原样重提 / 在原有周次上加周：都不该被自己的旧记录挡住
    expect(store.updateExchangeWeeks(id, [3]).ok).toBe(true)
    expect(store.updateExchangeWeeks(id, [3, 4, 5]).ok).toBe(true)
    expect(store.exchanges[0]!.weeks).toEqual([3, 4, 5])
    expect(store.lessonAt(2, 'p3', 5)?.subject).toBe('数学')

    // 缩周次、乃至只留一周，同样成立
    expect(store.updateExchangeWeeks(id, [9]).ok).toBe(true)
    expect(store.exchanges[0]!.weeks).toEqual([9])
    expect(store.lessonAt(2, 'p3', 5)).toBeUndefined()
    expect(store.lessonAt(1, 'p2', 5)?.subject).toBe('数学')
  })

  it('编辑周次时撞上别人的换课：整笔拒绝，原记录一个字节不变', async () => {
    const store = useTimetableStore()
    const math = store.addLesson(lesson(1, 'p2', '数学'))!
    const english = store.addLesson(lesson(3, 'p4', '英语'))!
    expect(
      store.exchangeLesson({ lessonId: math.id, to: { weekday: 2, periodId: 'p3' }, weeks: [3] })
        .ok,
    ).toBe(true)
    const second = store.exchangeLesson({
      lessonId: english.id,
      to: { weekday: 2, periodId: 'p3' },
      weeks: [5],
    })
    const secondId = second.ok ? second.exchanges[0]!.id : ''
    await nextTick()
    const before = browser.localStorage.getItem(EXCHANGES_KEY)

    // 把第二条也挪到第 3 周 → 与第一条抢同一个目标，整笔拒绝
    const clash = store.updateExchangeWeeks(secondId, [3, 5])
    expect(clash.ok).toBe(false)
    expect(clash.ok ? '' : clash.reason).toContain('都要调到这个时段')

    await nextTick()
    expect(store.exchanges.find((item) => item.id === secondId)?.weeks).toEqual([5])
    expect(browser.localStorage.getItem(EXCHANGES_KEY)).toBe(before)
  })

  it('换课建好之后基础课表又占了目标时段：那一周不应用、有提示，位置仍归基础课表', () => {
    const store = useTimetableStore()
    const math = store.addLesson(lesson(1, 'p2', '数学'))!
    const created = store.exchangeLesson({
      lessonId: math.id,
      to: { weekday: 2, periodId: 'p3' },
      weeks: [3, 5],
    })
    const id = created.ok ? created.exchanges[0]!.id : ''

    // 教师后来在周二第 3 节加了一节课（换课记录是之前建的，不知道这件事）——
    // 这一格归基础课表，那条换课在冲突的周次上**不生效**，但记录留着
    const english = store.addLesson(lesson(2, 'p3', '语文'))!
    const view = store.weekView(3)
    expect(view.appliedIds).toEqual([])
    expect(view.conflictIds).toEqual([id])
    expect(view.conflicts[0]?.kind).toBe('target-occupied')
    expect(store.conflictMessages(3)[0]).toContain('语文（高一9班）')
    expect(store.lessonAt(2, 'p3', 3)?.subject).toBe('语文')
    expect(store.lessonAt(1, 'p2', 3)?.subject).toBe('数学')

    // 改周次同样逐周试算：只要还带着这一周，改动就整笔拒绝
    const result = store.updateExchangeWeeks(id, [3])
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.reason).toContain('不会覆盖')
    expect(store.exchanges[0]!.weeks).toEqual([3, 5])

    // 把后来加的那节课删掉，冲突消失 → 原记录照旧生效（记录从没被删过）
    expect(store.removeLesson(english.id)).toBe(true)
    expect(store.weekView(3).conflictIds).toEqual([])
    expect(store.lessonAt(2, 'p3', 3)?.subject).toBe('数学')
    expect(store.updateExchangeWeeks(id, [3, 4]).ok).toBe(true)
  })

  it('空周次 / 超范围周次都不许写入（换课必须有生效范围）', () => {
    const store = useTimetableStore()
    const math = store.addLesson(lesson(1, 'p2', '数学'))!

    const empty = store.exchangeLesson({
      lessonId: math.id,
      to: { weekday: 2, periodId: 'p3' },
      weeks: [],
    })
    expect(empty.ok).toBe(false)
    expect(empty.ok ? '' : empty.reason).toContain('至少选择一个')

    const overflow = store.exchangeLesson({
      lessonId: math.id,
      to: { weekday: 2, periodId: 'p3' },
      weeks: [21],
    })
    expect(overflow.ok).toBe(false)
    expect(overflow.ok ? '' : overflow.reason).toContain('第 21 周')
    expect(overflow.ok ? '' : overflow.reason).toContain('20 周')

    expect(store.exchanges).toHaveLength(0)
  })
})

/* ==================================================================== */
/* ⑤ 缩短学期周数：历史换课记录不静默丢失（§3.4 / §5.6）                 */
/* ==================================================================== */

describe('学期周数改小：超范围的换课记录原样保留，只报告不删除（§3.4）', () => {
  it('20 周改到 16 周：第 20 周的换课记录还在，盘上周次一个不少', async () => {
    const semester = useSemesterStore()
    const store = useTimetableStore()
    const math = store.addLesson(lesson(1, 'p2', '数学'))!
    const created = store.exchangeLesson({
      lessonId: math.id,
      to: { weekday: 2, periodId: 'p3' },
      weeks: [3, 20],
    })
    const id = created.ok ? created.exchanges[0]!.id : ''
    await nextTick()

    expect(semester.update({ totalWeeks: 16 }).ok).toBe(true)
    await nextTick()

    // 记录与它的周次都在（不静默删除、也不偷偷截成 16）
    expect(store.exchanges).toHaveLength(1)
    expect(store.exchanges[0]!.weeks).toEqual([3, 20])
    expect(disk(EXCHANGES_KEY)).toEqual([store.exchanges[0]])

    // 界面上有提示：「这条有超范围周次」
    const issue = store.weekRangeIssues.find((item) => item.exchange.id === id)
    expect(issue).toBeDefined()
    expect(issue?.outOfRange).toEqual([20])
    expect(issue?.empty).toBe(false)

    // 仍在范围内的第 3 周照常生效；第 20 周已不在学期里（今天落在那儿时按基础课表看）
    expect(store.lessonAt(2, 'p3', 3)?.subject).toBe('数学')
    expect(semester.weekOf('2026-12-28')).toBeUndefined()
    expect(semester.weeks).toHaveLength(16)
  })

  it('改周次也不许把超范围的周次写回去（第 17 周在 16 周学期里不存在）', async () => {
    const semester = useSemesterStore()
    const store = useTimetableStore()
    const math = store.addLesson(lesson(1, 'p2', '数学'))!
    const created = store.exchangeLesson({
      lessonId: math.id,
      to: { weekday: 2, periodId: 'p3' },
      weeks: [3, 20],
    })
    const id = created.ok ? created.exchanges[0]!.id : ''
    semester.update({ totalWeeks: 16 })

    const result = store.updateExchangeWeeks(id, [17])
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.reason).toContain('第 17 周')
    expect(store.exchanges[0]!.weeks).toEqual([3, 20])

    // 只留范围内的周次则允许（第 20 周仍是保留下来的那条记录的一部分）
    expect(store.updateExchangeWeeks(id, [3, 16]).ok).toBe(true)
    expect(store.exchanges[0]!.weeks).toEqual([3, 16])
  })

  it('学期设置本身也不因为改周数而删业务数据（update 只碰自己那一条）', async () => {
    const semester = useSemesterStore()
    const store = useTimetableStore()
    const math = store.addLesson(lesson(1, 'p2', '数学'))!
    store.exchangeLesson({ lessonId: math.id, to: { weekday: 2, periodId: 'p3' }, weeks: [20] })
    await nextTick()
    const exchangesBefore = browser.localStorage.getItem(EXCHANGES_KEY)

    semester.update({ totalWeeks: 4 })
    await nextTick()

    expect(browser.localStorage.getItem(EXCHANGES_KEY)).toBe(exchangesBefore)
    expect(store.exchanges).toHaveLength(1)
  })
})

/* ==================================================================== */
/* ⑥ 旧换课记录（没有 weeks）：不迁移、不猜周次（§5.5 兼容）             */
/* ==================================================================== */

/** 一条 v3.7.5 之前的换课记录：没有 `weeks` 字段（当年是直接改基础课表实现的） */
const LEGACY_EXCHANGE: CourseExchange = {
  id: 'old-1',
  from: { weekday: 1, periodId: 'p2', className: CLASS_NAME, subject: '数学' },
  to: { weekday: 2, periodId: 'p3', className: CLASS_NAME, subject: '数学' },
  fromLesson: {
    subject: '数学',
    classId: classIdOf(CLASS_NAME),
    className: CLASS_NAME,
    teacher: '我',
    type: 'normal',
  },
  group: false,
  createdAt: '2026-09-01T08:00:00.000Z',
}

describe('v3.7.5 之前的换课记录：原样保留、按老口径渲染（§5.5）', () => {
  beforeEach(() => {
    browser.localStorage.seed(EXCHANGES_KEY, JSON.stringify([LEGACY_EXCHANGE]))
    // 旧换课当时把课真的搬到了目标位置（课表里就带着 exchangeId）
    browser.localStorage.seed(
      LESSONS_KEY,
      JSON.stringify([
        {
          id: 'moved',
          weekday: 2,
          periodId: 'p3',
          subject: '数学',
          className: CLASS_NAME,
          teacher: '我',
          type: 'adjusted',
          exchangeId: 'old-1',
        },
      ]),
    )
  })

  it('读回来还是旧记录（没有 weeks 字段），不被猜成某个周次', () => {
    const store = useTimetableStore()
    expect(store.exchanges).toHaveLength(1)
    const record = store.exchanges[0]!
    expect('weeks' in record).toBe(false)
    expect(isWeeklyExchange(record)).toBe(false)
    expect(appliesToWeek(record, 3)).toBe(false)
    expect(store.weekView(3).appliedIds).toEqual([])
  })

  it('按老口径渲染：课本来就在目标位置，叠加层不搬走也不重复', () => {
    const store = useTimetableStore()
    expect(store.lessonAt(2, 'p3', 3)?.id).toBe('moved')
    expect(store.lessonAt(1, 'p2', 3)).toBeUndefined()
  })

  it('删记录 / 改周次两个新入口都不认它，记录仍在（旧记录要走撤销）', () => {
    const store = useTimetableStore()
    expect(store.removeExchange('old-1')).toBe(false)
    const result = store.updateExchangeWeeks('old-1', [3])
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.reason).toContain('旧版换课记录')
    expect(store.exchanges).toHaveLength(1)
  })

  it('撤销旧记录仍走老路径：课表按快照复原、记录删除（restored: 1）', async () => {
    const store = useTimetableStore()
    expect(store.undoExchange('old-1')).toEqual({ ok: true, restored: 1 })
    await nextTick()

    expect(store.lessonAt(1, 'p2')?.subject).toBe('数学')
    expect(store.lessonAt(2, 'p3')).toBeUndefined()
    expect(store.exchanges).toHaveLength(0)
    expect(disk(EXCHANGES_KEY)).toEqual([])
  })
})

/* ==================================================================== */
/* ⑦ 纯逻辑：周次规范化 / 文案 / 叠加层                                  */
/* ==================================================================== */

describe('周次规范化与文案（纯逻辑）', () => {
  it('normalizeExchangeWeeks：去重升序、丢掉非正整数；不是数组 → undefined（旧的、没周次的记录）', () => {
    expect(normalizeExchangeWeeks([8, 3, 3, 1])).toEqual([1, 3, 8])
    expect(normalizeExchangeWeeks([0, -1, 2.5, '3', null])).toEqual([])
    expect(normalizeExchangeWeeks([])).toEqual([])
    // `undefined` / 非数组 = 旧记录；**绝不**把空数组当旧记录（那会凭空改基础课表）
    expect(normalizeExchangeWeeks(undefined)).toBeUndefined()
    expect(normalizeExchangeWeeks('3')).toBeUndefined()
    expect(normalizeExchangeWeeks(null)).toBeUndefined()
  })

  it('describeExchangeWeeks：全选说「全部 N 周」，其余压成区间（en dash 与源码一致）', () => {
    const all = Array.from({ length: 20 }, (_, index) => index + 1)
    const dash = '–'
    expect(describeExchangeWeeks(all, 20)).toBe('全部 20 周')
    expect(describeExchangeWeeks([], 20)).toBe('未选择周次（不生效）')
    expect(describeExchangeWeeks([3, 4, 5, 8], 20)).toBe(`第 3${dash}5、8 周`)
    expect(describeExchangeWeeks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 20)).toBe(
      `共 10 周（第 1${dash}10 等）`,
    )
    // 只有 16 周时，「1..16」也算全选（上限跟着学期设置走）
    expect(
      describeExchangeWeeks(
        Array.from({ length: 16 }, (_, i) => i + 1),
        16,
      ),
    ).toBe('全部 16 周')
  })

  it('叠加层支持互换与链式搬移：先把源腾空、再判目标', () => {
    const mk = (id: string, weekday: Weekday, periodId: CoursePeriodId, subject: string) => ({
      weekday,
      periodId,
      id,
      subject,
      classId: classIdOf(CLASS_NAME),
      className: CLASS_NAME,
      teacher: '我',
      type: 'normal' as const,
    })
    const lessons = [mk('a', 1, 'p2', '数学'), mk('b', 2, 'p3', '语文')]
    const exchange = (id: string, from: CourseExchange['from'], to: CourseExchange['to']) => ({
      id,
      from,
      to,
      fromLesson: {
        subject: from.subject,
        classId: classIdOf(CLASS_NAME),
        className: CLASS_NAME,
        teacher: '我',
        type: 'normal' as const,
      },
      group: false,
      createdAt: '2026-09-01T08:00:00.000Z',
      weeks: [3],
    })

    // 互换：甲从 A 搬到 B、乙从 B 搬到 A——同一周里两条都能落，谁也不覆盖谁
    const swap = resolveWeekLessons({
      lessons,
      exchanges: [
        exchange(
          'x',
          { weekday: 1, periodId: 'p2', className: CLASS_NAME, subject: '数学' },
          { weekday: 2, periodId: 'p3', className: CLASS_NAME, subject: '数学' },
        ),
        exchange(
          'y',
          { weekday: 2, periodId: 'p3', className: CLASS_NAME, subject: '语文' },
          { weekday: 1, periodId: 'p2', className: CLASS_NAME, subject: '语文' },
        ),
      ],
      week: 3,
    })
    expect(swap.conflicts).toEqual([])
    expect(swap.appliedIds.sort()).toEqual(['x', 'y'])
    expect(swap.lessons.find((item) => item.subject === '数学')?.weekday).toBe(2)
    expect(swap.lessons.find((item) => item.subject === '语文')?.weekday).toBe(1)

    // 链式：甲 A→B、乙 B→C（C 是空位）——乙腾空 B，甲正好落进 B
    const chain = resolveWeekLessons({
      lessons,
      exchanges: [
        exchange(
          'x',
          { weekday: 1, periodId: 'p2', className: CLASS_NAME, subject: '数学' },
          { weekday: 2, periodId: 'p3', className: CLASS_NAME, subject: '数学' },
        ),
        exchange(
          'z',
          { weekday: 2, periodId: 'p3', className: CLASS_NAME, subject: '语文' },
          { weekday: 4, periodId: 'p5', className: CLASS_NAME, subject: '语文' },
        ),
      ],
      week: 3,
    })
    expect(chain.conflicts).toEqual([])
    expect(chain.appliedIds.sort()).toEqual(['x', 'z'])
    expect(chain.lessons.find((item) => item.subject === '数学')?.weekday).toBe(2)
    expect(chain.lessons.find((item) => item.subject === '语文')?.weekday).toBe(4)

    // 迭代到稳定：乙落不了地（目标位置被英语占着、没人腾）→ 它腾不出 B → 甲也落不进去。
    // 两条都保留在「未生效」状态，那一格原样显示基础课表——不会出现「乙没走、甲却占了 B」
    const blocked = resolveWeekLessons({
      lessons: [...lessons, mk('c', 4, 'p5', '英语')],
      exchanges: [
        exchange(
          'x',
          { weekday: 1, periodId: 'p2', className: CLASS_NAME, subject: '数学' },
          { weekday: 2, periodId: 'p3', className: CLASS_NAME, subject: '数学' },
        ),
        exchange(
          'z',
          { weekday: 2, periodId: 'p3', className: CLASS_NAME, subject: '语文' },
          { weekday: 4, periodId: 'p5', className: CLASS_NAME, subject: '语文' },
        ),
      ],
      week: 3,
    })
    expect(blocked.appliedIds).toEqual([])
    expect(blocked.conflictIds.sort()).toEqual(['x', 'z'])
    expect(blocked.conflicts.every((conflict) => conflict.kind === 'target-occupied')).toBe(true)
    expect(blocked.lessons.map((item) => item.id).sort()).toEqual(['a', 'b', 'c'])
  })
})

/* ==================================================================== */
/* ⑧ 周次选择与课程表页的接线（源码级：本仓库没有 jsdom）                */
/* ==================================================================== */

describe('周次选择器与课程表页的接线（§5.2）', () => {
  const picker = readFileSync('src/views/Schedule/components/ExchangeWeekPicker.vue', 'utf8')

  it('可选周次由 max-week 动态生成——不写死 20 周', () => {
    expect(picker).toContain('Array.from({ length: Math.max(0, props.maxWeek) }')
    // 从学期设置传进来的上限是它唯一的周次来源
    expect(picker).toContain('maxWeek')
  })

  it('选法齐全：单点 / 多选 / 全选 / 清空 / 快速范围，并且始终显示已选', () => {
    expect(picker).toContain('function toggle(')
    expect(picker).toContain('function selectAll(')
    expect(picker).toContain('function clearAll(')
    expect(picker).toContain('function applyRange(')
    expect(picker).toContain('describeExchangeWeeks')
    expect(picker).toContain('已选')
  })

  it('课程表页把学期总周数传给它（周次只有学期设置这一个来源）', () => {
    const page = readFileSync('src/views/Schedule/index.vue', 'utf8')
    expect(page).toContain(':max-week="semesterStore.weekCount"')
    expect(page).toContain(':current-week="timetableStore.currentWeek"')
    // 换课提交时把选中的周次原样传给 store
    expect(page).toContain('timetableStore.exchangeLesson(')
    expect(page).toContain('describeExchangeWeeks(params.weeks, semesterStore.weekCount)')
  })

  it('学期设置页能改四个字段，并对结束日期不一致给出提示（不自动改配置）', () => {
    const page = readFileSync('src/views/My/settings/SemesterSettings.vue', 'utf8')
    expect(page).toContain('semester.update(')
    expect(page).toContain('endMismatch')
    expect(page).toContain('settings.endDate')
    expect(page).toContain('semester.weekCount')
  })
})
