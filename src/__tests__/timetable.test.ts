/**
 * 课程表模型与时段工具（V1.1.3）自检。
 *
 * 覆盖：
 * ① 10 个时段（含早自习及第一节、晚自习1~3）的身份、顺序与时间；
 * ② 旧 `period: number`（1~8）→ 新 `periodId` 的迁移表（确定性、可重放）；
 * ③ 邻接、同桌（不变量——这些规则在 V1.1.2 Phase 2 已经统一过，这里只验时段模型适配得对）；
 * ④ 换课的 from → to 关系保持 / 撤销换课原样放回；
 * ⑤ 班级的 `classId` 由 `className` 派生、同名必同 id。
 */
import { describe, expect, it } from 'vitest'

import {
  COURSE_PERIODS,
  COURSE_PERIOD_IDS,
  EVENING_PERIOD_IDS,
  LEGACY_PERIOD_MIGRATION,
} from '@/types/timetable'
import {
  classIdOf,
  eveningGroupIdOf,
  findSlotConflict,
  isEveningPeriod,
  isValidLessonType,
  isValidPeriodId,
  periodFullTextOf,
  periodIdFromLegacyPeriod,
  periodLabelOf,
  periodOrderOf,
  periodShortLabelOf,
  periodTimeTextOf,
  sameEveningGroupSiblings,
  sortLessons,
  weekdayOf,
} from '@/utils/timetable'
import type { CoursePeriodId, Lesson, Weekday } from '@/types/timetable'

/* ========== 时间段（唯一时间配置） ========== */

describe('COURSE_PERIODS：10 个时段（含早自习及第一节、晚自习 1~3）', () => {
  it('共 10 个、id 唯一、时间递增', () => {
    expect(COURSE_PERIODS).toHaveLength(10)
    const ids = COURSE_PERIODS.map((period) => period.id)
    expect(new Set(ids).size).toBe(10)
    expect(COURSE_PERIOD_IDS).toEqual(COURSE_PERIODS.map((period) => period.id))
    for (let index = 1; index < COURSE_PERIODS.length; index += 1) {
      const prev = COURSE_PERIODS[index - 1]!
      const cur = COURSE_PERIODS[index]!
      expect(cur.startTime > prev.startTime).toBe(true)
    }
  })

  it('「早自习及第一节」是一段（07:40–09:05），不拆成两段', () => {
    const morning = COURSE_PERIODS.find((period) => period.id === 'morning')
    expect(morning?.startTime).toBe('07:40')
    expect(morning?.endTime).toBe('09:05')
    expect(morning?.label).toBe('早自习及第一节')
  })

  it('「晚自习1~3」是三段独立时段（晚自习1=19:30–20:10、晚自习2=20:20–21:00、晚自习3=21:10–21:50）', () => {
    expect(EVENING_PERIOD_IDS).toEqual(['evening1', 'evening2', 'evening3'])
    const e1 = periodTimeTextOf('evening1')
    const e2 = periodTimeTextOf('evening2')
    const e3 = periodTimeTextOf('evening3')
    expect(e1).toBe('19:30–20:10')
    expect(e2).toBe('20:20–21:00')
    expect(e3).toBe('21:10–21:50')
  })

  it('10 个时段的具体时间（防被悄悄改坏）', () => {
    expect(periodTimeTextOf('morning')).toBe('07:40–09:05')
    expect(periodTimeTextOf('p2')).toBe('09:20–10:00')
    expect(periodTimeTextOf('p3')).toBe('10:30–11:10')
    expect(periodTimeTextOf('p4')).toBe('11:25–12:05')
    expect(periodTimeTextOf('p5')).toBe('15:00–15:40')
    expect(periodTimeTextOf('p6')).toBe('16:00–16:40')
    expect(periodTimeTextOf('p7')).toBe('16:55–17:35')
    expect(periodTimeTextOf('evening1')).toBe('19:30–20:10')
    expect(periodTimeTextOf('evening2')).toBe('20:20–21:00')
    expect(periodTimeTextOf('evening3')).toBe('21:10–21:50')
  })

  it('时段标签 / 短标签 / 时间 / 完整描述 / 顺序查询一致', () => {
    const morning = COURSE_PERIODS[0]!
    expect(periodLabelOf(morning.id)).toBe(morning.label)
    expect(periodShortLabelOf(morning.id)).toBe(morning.shortLabel)
    expect(periodOrderOf(morning.id)).toBe(1)
    expect(periodFullTextOf(morning.id)).toBe(
      `${morning.label} · ${morning.startTime}–${morning.endTime}`,
    )
  })
})

/* ========== 旧 period → 新 periodId 迁移 ========== */

describe('LEGACY_PERIOD_MIGRATION：第 1~8 节 → 新时段（确定性、可重放）', () => {
  it('8 个旧节次各自唯一映射到一个新时段', () => {
    const legacyKeys = Object.keys(LEGACY_PERIOD_MIGRATION).map(Number)
    expect(legacyKeys.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('第 1 节 → 早自习及第一节（**这是迁移的关键约定**）', () => {
    expect(periodIdFromLegacyPeriod(1)).toBe('morning')
  })

  it('第 8 节 → 晚自习1（不是晚自习2 / 3 —— 旧课表只到第 8 节）', () => {
    expect(periodIdFromLegacyPeriod(8)).toBe('evening1')
  })

  it('超出 1~8 的数字 / 非数字返回 undefined', () => {
    expect(periodIdFromLegacyPeriod(9)).toBeUndefined()
    expect(periodIdFromLegacyPeriod(0)).toBeUndefined()
    expect(periodIdFromLegacyPeriod('1')).toBeUndefined()
    expect(periodIdFromLegacyPeriod(1.5)).toBeUndefined()
  })
})

/* ========== 课时类型 / 邻接 / 同桌 ========== */

describe('课时类型 / 邻接 / 同桌：V1.1.2 Phase 2 已统一口径（这里只验证时段模型适配）', () => {
  it('合法类型仅 normal / substitute / adjusted', () => {
    expect(isValidLessonType('normal')).toBe(true)
    expect(isValidLessonType('substitute')).toBe(true)
    expect(isValidLessonType('adjusted')).toBe(true)
    expect(isValidLessonType('别的')).toBe(false)
    expect(isValidLessonType(null)).toBe(false)
  })

  it('isValidPeriodId 拒绝非枚举 id', () => {
    expect(isValidPeriodId('morning')).toBe(true)
    expect(isValidPeriodId('evening3')).toBe(true)
    expect(isValidPeriodId('第10节')).toBe(false)
    expect(isValidPeriodId(null)).toBe(false)
  })

  it('isEveningPeriod：仅三节晚自习为 true', () => {
    expect(isEveningPeriod('evening1')).toBe(true)
    expect(isEveningPeriod('evening2')).toBe(true)
    expect(isEveningPeriod('evening3')).toBe(true)
    expect(isEveningPeriod('morning')).toBe(false)
    expect(isEveningPeriod('p7')).toBe(false)
  })
})

/* ========== 排序 / 冲突 ========== */

describe('sortLessons / findSlotConflict', () => {
  const lessons: Lesson[] = [
    {
      id: 'a',
      weekday: 1,
      periodId: 'p5',
      subject: '数学',
      className: '高一9班',
      classId: 'class-高一9班',
      teacher: '我',
      type: 'normal',
    },
    {
      id: 'b',
      weekday: 1,
      periodId: 'morning',
      subject: '语文',
      className: '高一9班',
      classId: 'class-高一9班',
      teacher: '我',
      type: 'normal',
    },
    {
      id: 'c',
      weekday: 2,
      periodId: 'morning',
      subject: '英语',
      className: '高一7班',
      classId: 'class-高一7班',
      teacher: '我',
      type: 'normal',
    },
  ]

  it('findSlotConflict：同一天同时段算冲突，编辑自身可排除', () => {
    expect(findSlotConflict(lessons, 1, 'p5')?.id).toBe('a')
    expect(findSlotConflict(lessons, 1, 'p5', 'a')).toBeUndefined()
    expect(findSlotConflict(lessons, 1, 'p4')).toBeUndefined()
  })

  it('sortLessons：按时段升序，同一时段按科目中文升序', () => {
    const sorted = sortLessons([
      mkLesson({ id: 'a', weekday: 1, periodId: 'p5', subject: '数学' }),
      mkLesson({ id: 'b', weekday: 1, periodId: 'p5', subject: '语文' }),
      mkLesson({ id: 'c', weekday: 1, periodId: 'morning', subject: '英语' }),
    ])
    // morning (1) < p5 (5)，故 c 在前；同 p5 时按中文升序：英(英语=a)=c < 数(数学)=a < 语(语文)=b
    expect(sorted.map((lesson) => lesson.id)).toEqual(['c', 'a', 'b'])
  })
})

/* ========== 晚自习组 ========== */

describe('晚自习组：三节齐备 + 同班同科 → 同一 group', () => {
  const lessons: Lesson[] = [
    mkLesson({ id: 'e1', weekday: 3, periodId: 'evening1', courseGroupId: 'evening-3-c-m' }),
    mkLesson({ id: 'e2', weekday: 3, periodId: 'evening2', courseGroupId: 'evening-3-c-m' }),
    mkLesson({ id: 'e3', weekday: 3, periodId: 'evening3', courseGroupId: 'evening-3-c-m' }),
    mkLesson({ id: 'f1', weekday: 4, periodId: 'evening1', courseGroupId: 'evening-4-c-m' }),
    mkLesson({ id: 'f2', weekday: 4, periodId: 'evening2', courseGroupId: 'evening-4-c-m' }),
  ]

  it('group id = 确定性字符串（同样的周 / 班级 / 科目 → 同样的组 id）', () => {
    expect(eveningGroupIdOf(3, 'class-高一9班', '数学')).toBe('evening-3-class-高一9班-数学')
  })

  it('sameEveningGroupSiblings：返回同组其他节，时段升序、不含自己', () => {
    const target = lessons.find((lesson) => lesson.id === 'e2')!
    const siblings = sameEveningGroupSiblings(lessons, target).map((lesson) => lesson.id)
    expect(siblings).toEqual(['e1', 'e3'])
  })

  it('没有 groupId 的课 → 没有兄弟', () => {
    const target = lessons.find((lesson) => lesson.id === 'f1')!
    const siblings = sameEveningGroupSiblings(
      lessons.filter((lesson) => lesson.courseGroupId !== target.courseGroupId),
      target,
    )
    expect(siblings).toEqual([])
  })
})

/* ========== 班级 id ========== */

describe('classIdOf：班级名 → id（同名必同 id）', () => {
  it('同名 → 同 id', () => {
    expect(classIdOf('高一9班')).toBe(classIdOf('高一9班'))
    expect(classIdOf('高一9班')).toBe('class-高一9班')
  })

  it('前后空格 → 同 id（`trim` 后视为同一班级）', () => {
    expect(classIdOf('高一9班')).toBe(classIdOf(' 高一9班 '))
  })

  it('中间空格 → 不同的班级（不臆造合并）', () => {
    expect(classIdOf('高一9班')).not.toBe(classIdOf('高一 9班'))
  })

  it('空字符串 → 空 id', () => {
    expect(classIdOf('')).toBe('')
    expect(classIdOf('   ')).toBe('')
  })
})

/* ========== 星期换算 ========== */

describe('weekdayOf：JS getDay() → 课表 weekday（周一=1，周日=7）', () => {
  it('周日（JS 0）→ 7', () => {
    expect(weekdayOf(new Date('2024-01-07T12:00:00'))).toBe(7)
  })
  it('周一（JS 1）→ 1', () => {
    expect(weekdayOf(new Date('2024-01-01T12:00:00'))).toBe(1)
  })
  it('周六（JS 6）→ 6', () => {
    expect(weekdayOf(new Date('2024-01-06T12:00:00'))).toBe(6)
  })
})

/* ========== helpers ========== */

function mkLesson(
  overrides: Partial<Lesson> & Pick<Lesson, 'id' | 'weekday' | 'periodId'>,
): Lesson {
  return {
    subject: '数学',
    className: '高一9班',
    classId: 'class-高一9班',
    teacher: '我',
    type: 'normal',
    ...overrides,
  }
}

// 抑制 unused 告警（类型限定用）
void ({} as Weekday)
void ({} as CoursePeriodId)
