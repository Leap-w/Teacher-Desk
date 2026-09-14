import { COURSE_PERIODS, EVENING_PERIOD_IDS, LEGACY_PERIOD_MIGRATION } from '@/types/timetable'
import type { CoursePeriod, CoursePeriodId, Lesson, LessonType, Weekday } from '@/types/timetable'

/** 星期中文标签（课程卡片、周视图表头、删除确认文案等共用一处） */
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

/* ========== 时间段（读的是 types/timetable.ts 的 COURSE_PERIODS，本处只做查表） ========== */

/** id → 时段定义；找不到返回 undefined（调用方给降级文案） */
export function periodById(id: CoursePeriodId | string): CoursePeriod | undefined {
  return COURSE_PERIODS.find((period) => period.id === id)
}

/** 时段完整名（如「早自习及第一节」），认不出时给占位而不是 undefined */
export function periodLabelOf(id: CoursePeriodId | string): string {
  return periodById(id)?.label ?? '—'
}

/** 时段短名（如「早自习」「第2节」），周视图行头等窄空间用 */
export function periodShortLabelOf(id: CoursePeriodId | string): string {
  return periodById(id)?.shortLabel ?? '—'
}

/** 时段顺序（1 起）；认不出的时段排到最后（不静默当第 1 节） */
export function periodOrderOf(id: CoursePeriodId | string): number {
  return periodById(id)?.order ?? Number.MAX_SAFE_INTEGER
}

/** 时间文案：`07:40–09:05` */
export function periodTimeTextOf(id: CoursePeriodId | string): string {
  const period = periodById(id)
  return period ? `${period.startTime}–${period.endTime}` : ''
}

/** 「第2节 · 09:20–10:00」：需要同时说清节次与时间的地方（编辑抽屉选完后提示、详情页） */
export function periodFullTextOf(id: CoursePeriodId | string): string {
  const period = periodById(id)
  return period ? `${period.label} · ${period.startTime}–${period.endTime}` : '—'
}

/** 是否晚自习时段（三节之一） */
export function isEveningPeriod(id: CoursePeriodId | string): boolean {
  return EVENING_PERIOD_IDS.includes(id as CoursePeriodId)
}

/** 该 id 是不是合法的时段 id（导入校验、normalize 用） */
export function isValidPeriodId(id: unknown): id is CoursePeriodId {
  return typeof id === 'string' && COURSE_PERIODS.some((period) => period.id === id)
}

/**
 * 旧 `period`（数字 1~8）→ 新时段 id（V1.1.3 迁移，确定性）。
 * 超出 1~8 的数字返回 undefined（该条按非法数据处理，与既有口径一致）。
 */
export function periodIdFromLegacyPeriod(period: unknown): CoursePeriodId | undefined {
  if (typeof period !== 'number' || !Number.isInteger(period)) return undefined
  return LEGACY_PERIOD_MIGRATION[period]
}

/* ========== 类型（正常 / 代课 / 调课） ========== */

const LESSON_TYPES: readonly LessonType[] = ['normal', 'substitute', 'adjusted']

export function isValidLessonType(value: unknown): value is LessonType {
  return typeof value === 'string' && LESSON_TYPES.includes(value as LessonType)
}

/** 类型中文标签（卡片徽标、导入预览共用） */
export const LESSON_TYPE_LABELS: Record<LessonType, string> = {
  normal: '正常',
  substitute: '代课',
  adjusted: '调课',
}
/* ========== 班级 / 日期 ========== */

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

/* ========== 排序 / 冲突 ========== */

/** 时段升序（同时段按科目名，保证渲染顺序稳定；不改动入参数组） */
export function sortLessons(lessons: Lesson[]): Lesson[] {
  return [...lessons].sort(
    (a, b) =>
      periodOrderOf(a.periodId) - periodOrderOf(b.periodId) ||
      a.subject.localeCompare(b.subject, 'zh-Hans-CN'),
  )
}

/**
 * 同一时间的已有课程：教师同一时段只能在一个班上课，
 * 因此「星期 + 时段」重复即冲突（编辑自身时用 excludeId 排除）。
 */
export function findSlotConflict(
  lessons: Lesson[],
  weekday: Weekday,
  periodId: CoursePeriodId,
  excludeId?: string,
): Lesson | undefined {
  return lessons.find(
    (lesson) =>
      lesson.weekday === weekday && lesson.periodId === periodId && lesson.id !== excludeId,
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

/* ========== 晚自习组 ========== */

/**
 * 组 id（确定性）：同一星期 + 同一班级 + 同一科目的连续晚自习共享它。
 * 用确定性字符串而不是随机 id，是为了让「同样的表导入两次」得到同样的分组关系。
 */
export function eveningGroupIdOf(weekday: Weekday, classId: string, subject: string): string {
  return `evening-${weekday}-${classId}-${subject}`
}
/** 从一组课程里取「同一晚自习组的其他节」（不含自己，按顺序升序） */
export function sameEveningGroupSiblings(lessons: readonly Lesson[], lesson: Lesson): Lesson[] {
  if (!lesson.courseGroupId) return []
  return sortLessons(
    lessons.filter((item) => item.courseGroupId === lesson.courseGroupId && item.id !== lesson.id),
  )
}
