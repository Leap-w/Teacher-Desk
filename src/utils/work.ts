import { WORK_CATEGORIES, WORK_PRIORITY_LABELS, WORK_STATUS_LABELS } from '@/types/work'
import type {
  WorkCategory,
  WorkFilter,
  WorkInput,
  WorkItem,
  WorkPriority,
  WorkStatus,
} from '@/types/work'

/* ========== 日期 / 时间（本地日历日，不走 UTC） ========== */

/** 某一时刻的「本地日历日」YYYY-MM-DD（`toISOString` 是 UTC，跨时区会差一天，不用它） */
export function isoDateOf(date: Date = new Date()): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** YYYY-MM-DD 严格校验（月日范围、真实存在的日期——2 月 30 日不接受） */
export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!matched) return false
  const [, year, month, day] = matched
  const date = new Date(Number(year), Number(month) - 1, Number(day))
  return (
    date.getFullYear() === Number(year) &&
    date.getMonth() === Number(month) - 1 &&
    date.getDate() === Number(day)
  )
}

/** HH:mm 严格校验（00:00–23:59） */
export function isValidClockTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

/**
 * 把常见的日期写法归一成 YYYY-MM-DD：`2026-9-4` / `2026/09/04` / `2026年9月4日`。
 * 认不出或不是真实日期时返回 undefined（**不做臆造补全**，例如「9/4」缺年份一律拒绝）。
 */
export function parseDateText(text: string): string | undefined {
  const value = text.trim()
  if (!value) return undefined
  const matched = /^(\d{4})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})\s*日?$/.exec(value)
  if (!matched) return undefined
  const [, year, month, day] = matched
  const iso = `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`
  return isValidIsoDate(iso) ? iso : undefined
}

/** 把常见的时间写法归一成 HH:mm：`18:00` / `18:00:00` / `9:5` */
export function parseTimeText(text: string): string | undefined {
  const value = text.trim()
  if (!value) return undefined
  const matched = /^(\d{1,2})\s*[:：]\s*(\d{1,2})(?:\s*[:：]\s*\d{1,2})?$/.exec(value)
  if (!matched) return undefined
  const hour = Number(matched[1])
  const minute = Number(matched[2])
  if (hour > 23 || minute > 59) return undefined
  return `${`${hour}`.padStart(2, '0')}:${`${minute}`.padStart(2, '0')}`
}

/** 日期 ± n 天（本地日历，跨月跨年交给 Date） */
export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(year!, month! - 1, day!)
  date.setDate(date.getDate() + days)
  return isoDateOf(date)
}

/** 该日期所在周的周一（ISO 周：周一为一周之始，与课表的 `Weekday` 口径一致） */
export function weekStartOf(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(year!, month! - 1, day!)
  const weekday = date.getDay() === 0 ? 7 : date.getDay()
  return addDays(isoDate, 1 - weekday)
}

/** 该日期所在周的周日（本周最后一天；「本周剩余」的上界） */
export function weekEndOf(isoDate: string): string {
  return addDays(weekStartOf(isoDate), 6)
}

/** 日期展示文案：今天 / 明天 / 昨天 / 9月14日（周一） */
export function workDateLabel(date: string, today: string = isoDateOf()): string {
  if (date === today) return '今天'
  if (date === addDays(today, 1)) return '明天'
  if (date === addDays(today, -1)) return '昨天'
  const [year, month, day] = date.split('-').map(Number)
  const weekday = new Date(year!, month! - 1, day!).getDay()
  const weekdayLabel = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][weekday] ?? ''
  return `${month}月${day}日（${weekdayLabel}）`
}

/* ========== 标签 / 判定 ========== */

export function workStatusLabel(status: WorkStatus): string {
  return WORK_STATUS_LABELS[status]
}

export function workPriorityLabel(priority: WorkPriority): string {
  return WORK_PRIORITY_LABELS[priority]
}

/** 优先级权重（排序用：紧急 > 重要 > 普通） */
export function workPriorityWeight(priority: WorkPriority): number {
  if (priority === 'urgent') return 3
  if (priority === 'important') return 2
  return 1
}

/** 是否已完成 */
export function isWorkDone(work: WorkItem): boolean {
  return work.status === 'done'
}

/** 是否逾期（归属日期早于今天且未完成） */
export function isWorkOverdue(work: WorkItem, today: string = isoDateOf()): boolean {
  return !isWorkDone(work) && work.date < today
}

/** 是否是「今天该做」：归属日期就是今天，或更早但还没做完（含逾期） */
export function isWorkForToday(work: WorkItem, today: string = isoDateOf()): boolean {
  return work.date <= today && !isWorkDone(work)
}

/* ========== 排序 / 分组 / 筛选 ========== */

/**
 * 列表排序（不改动入参数组）：未完成在前 → 日期升序 → 优先级降序（紧急在前）→ 创建时间升序。
 * 已完成沉底，避免一堆「✓」把今天真正要做的事挤下去。
 */
export function sortWorks(works: readonly WorkItem[]): WorkItem[] {
  return [...works].sort((a, b) => {
    if (isWorkDone(a) !== isWorkDone(b)) return isWorkDone(a) ? 1 : -1
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    const weight = workPriorityWeight(b.priority) - workPriorityWeight(a.priority)
    if (weight !== 0) return weight
    return a.createdAt.localeCompare(b.createdAt)
  })
}

/** 按筛选条件取子集（筛选是纯函数，页面只负责传值） */
export function filterWorks(works: readonly WorkItem[], filter: WorkFilter): WorkItem[] {
  if (filter === 'all') return sortWorks(works)
  return sortWorks(works.filter((work) => work.status === filter))
}

/** 今日：归属日期 ≤ 今天且未完成（含逾期）；已完成但归属日期是今天的也留在今日里（当成情况反馈） */
export function todayWorks(works: readonly WorkItem[], today: string = isoDateOf()): WorkItem[] {
  return sortWorks(works.filter((work) => work.date === today || isWorkOverdue(work, today)))
}

/** 本周剩余：归属日期在「明天 ~ 本周日」之间且未完成 */
export function weekWorks(works: readonly WorkItem[], today: string = isoDateOf()): WorkItem[] {
  const weekEnd = weekEndOf(today)
  const tomorrow = addDays(today, 1)
  return sortWorks(
    works.filter((work) => !isWorkDone(work) && work.date >= tomorrow && work.date <= weekEnd),
  )
}

export interface WorkSummary {
  /** 今日未完成（含逾期） */
  todayOpen: number
  /** 今日已完成 */
  todayDone: number
  /** 本周剩余（明天起） */
  weekOpen: number
  /** 逾期未完成 */
  overdue: number
}

/** 概览数字（工作台「今日工作」卡片与页面页头共用同一份口径） */
export function workSummary(works: readonly WorkItem[], today: string = isoDateOf()): WorkSummary {
  return {
    todayOpen: works.filter((work) => isWorkForToday(work, today)).length,
    todayDone: works.filter((work) => work.date === today && isWorkDone(work)).length,
    weekOpen: weekWorks(works, today).length,
    overdue: works.filter((work) => isWorkOverdue(work, today)).length,
  }
}

/* ========== 校验 ========== */

/** 分类是否属于预设三项 */
export function isValidWorkCategory(value: unknown): value is WorkCategory {
  return typeof value === 'string' && (WORK_CATEGORIES as readonly string[]).includes(value)
}

export function isValidWorkStatus(value: unknown): value is WorkStatus {
  return value === 'todo' || value === 'in-progress' || value === 'done'
}

export function isValidWorkPriority(value: unknown): value is WorkPriority {
  return value === 'normal' || value === 'important' || value === 'urgent'
}

/**
 * 必填字段与取值范围的兜底校验（表单已提示，此处防其他写入入口绕过）：
 * 名称非空、日期是真实日期、截止时间（若给）是合法 HH:mm。
 */
export function isWorkInputValid(input: WorkInput): boolean {
  if (typeof input.title !== 'string' || !input.title.trim()) return false
  if (!isValidIsoDate(input.date)) return false
  if (input.deadline !== undefined && !isValidClockTime(input.deadline)) return false
  if (!isValidWorkStatus(input.status)) return false
  if (!isValidWorkPriority(input.priority)) return false
  if (!isValidWorkCategory(input.category)) return false
  return true
}

/** 同日同名（用于导入去重与「已存在」提示） */
export function isSameWork(
  a: Pick<WorkItem, 'title' | 'date'>,
  b: Pick<WorkItem, 'title' | 'date'>,
): boolean {
  return a.date === b.date && a.title.trim() === b.title.trim()
}
