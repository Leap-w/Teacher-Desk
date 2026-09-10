import type { Lesson, Weekday } from '@/types/timetable'

/** 星期中文标签（课程卡片右上角「今天 星期四」、周视图表头等共用一处） */
export const WEEKDAY_LABELS: Record<Weekday, string> = {
  1: '星期一',
  2: '星期二',
  3: '星期三',
  4: '星期四',
  5: '星期五',
  6: '星期六',
  7: '星期日',
}

/** 星期短标签（手机分日切换条、PC 周视图列头等窄空间处使用） */
export const WEEKDAY_SHORT_LABELS: Record<Weekday, string> = {
  1: '周一',
  2: '周二',
  3: '周三',
  4: '周四',
  5: '周五',
  6: '周六',
  7: '周日',
}

/** 全部星期（升序） */
export const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7]

/**
 * 周课表默认显示的列（周一~周五）。
 * 周六 / 周日**不是**不显示，而是「有课才追加列」——见 `weekendWeekdaysOf`，
 * 避免教师录入的周末课程在周视图里彻底隐身（开发手册 §9.7 取舍）。
 */
export const WEEKDAY_COLUMNS: Weekday[] = [1, 2, 3, 4, 5]

/** 可录入的节次范围（第 1~8 节）；超出范围的课会被 load 丢弃，不做臆造补齐 */
export const LESSON_PERIODS: number[] = [1, 2, 3, 4, 5, 6, 7, 8]

/** 节次上限：取自 LESSON_PERIODS 末项，避免「校验口径」与「可选项」各维护一份（§9.7） */
export const MAX_LESSON_PERIOD = LESSON_PERIODS[LESSON_PERIODS.length - 1] ?? 8

/**
 * 班级名 → 班级标识。约定：**班级名是唯一事实来源，classId 由它确定性派生**
 * （同名必同 id），项目里没有班级实体（§2.6）。
 *
 * 只做首尾去空格：`高一9班` 与 `高一 9班` 是**两个**班级——本函数保持一一对应，
 * 否则下拉里会出现两个班级名却共用一个 id（§9.7 取舍 ④）。
 */
export function classIdOf(className: string): string {
  const name = className.trim()
  return name ? `class-${name}` : ''
}

/** JS `Date.getDay()`（0 = 周日）→ 课表星期（1 = 周一 … 7 = 周日） */
export function weekdayOf(date: Date): Weekday {
  const day = date.getDay()
  return (day === 0 ? 7 : day) as Weekday
}

/** 节次升序（同节次按科目名，保证渲染顺序稳定；不改动入参数组） */
export function sortLessons(lessons: Lesson[]): Lesson[] {
  return [...lessons].sort(
    (a, b) => a.period - b.period || a.subject.localeCompare(b.subject, 'zh-Hans-CN'),
  )
}

/**
 * 同一时间的已有课程：教师同一节次只能在一个班上课，
 * 因此「星期 + 节次」重复即冲突（编辑自身时用 excludeId 排除）。
 */
export function findSlotConflict(
  lessons: Lesson[],
  weekday: Weekday,
  period: number,
  excludeId?: string,
): Lesson | undefined {
  return lessons.find(
    (lesson) => lesson.weekday === weekday && lesson.period === period && lesson.id !== excludeId,
  )
}

/**
 * 需要追加到周视图的周末列：只追加**实际有课**的那一天（都没课则为空数组，
 * 周课表保持默认五列）。
 */
export function weekendWeekdaysOf(lessons: Lesson[]): Weekday[] {
  return ([6, 7] as Weekday[]).filter((weekday) =>
    lessons.some((lesson) => lesson.weekday === weekday),
  )
}
