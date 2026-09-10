import { WEEKDAY_LABELS, weekdayOf } from '@/utils/timetable'
import type { Weekday } from '@/types/timetable'

/** 将时间格式化为 HH:mm（24 小时制） */
export function formatClock(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

/** 生成日期标签，如「2026年9月8日星期二」 */
export function formatDateLabel(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(date)
}

/** 仅日期，如「2026年9月10日」（工作台头部第一行） */
export function formatDateOnly(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date)
}

/** 仅星期，如「星期四」（工作台头部第二行、今日课程卡片右上角） */
export function formatWeekdayLabel(date: Date): string {
  // 星期文案只有 WEEKDAY_LABELS 一个来源（与课表内部索引同一张表），不再走 Intl，
  // 避免「同一天出现两种星期写法」的分叉（§9.6 审查修复）
  return WEEKDAY_LABELS[weekdayOf(date)]
}

/**
 * 本地日期 → 日期键 `YYYY-MM-DD`（请假 / 离校登记等按「天」记录的数据用）。
 * 不用 `toISOString()`：那是 UTC，东八区凌晨会被算成前一天。
 */
export function formatDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * 日期键 → 中文月日，如「9月11日」（纯字符串解析，不经 Date，不涉时区）。
 * 用在「同一年内」的上下文里（请假时段、值的轮换说明），年份由旁边的输入框给出。
 * Phase 6 从 `utils/leave.ts` 上移到这里：值日轮换说明也要同一口径，**不留第二份副本**（§11.1）。
 */
export function formatMonthDay(dateKey: string): string {
  return `${Number(dateKey.slice(5, 7))}月${Number(dateKey.slice(8, 10))}日`
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * 日期键守卫：`YYYY-MM-DD` 且**这一天真实存在**。
 * 只判 `1..12 月` `1..31 日` 会放过「2 月 31 日」——它既会让
 * `<input type="date">` 静默渲染为空（教师看着空日期点保存），
 * 又会让时长计算凭空多出几天；因此回读校验：`Date` 会把不存在的
 * 日期顺延（2-31 → 3-3），对不上即拒绝（同 normalizeLesson 的「严格判定」口径）。
 *
 * Phase 5 起住在 `utils/leave.ts`，Phase 6 值日轮换也要校验起点日期，
 * 因此上移到日期工具的公共位置，**不留第二份副本**（§11.1）。
 */
export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_KEY_PATTERN.test(value)) return false
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const roundTrip = new Date(Date.UTC(year, month - 1, day))
  return (
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() + 1 === month &&
    roundTrip.getUTCDate() === day
  )
}

/**
 * 日期键 → 该日星期（1 = 周一 … 7 = 周日）。
 * 星期判定沿用课表的 `weekdayOf`（项目里只有一张星期表）；日期用**本地**时间构造，
 * 与 `addDaysToDateKey` 同款——不写 `new Date('2026-09-11')`（那会被当作 UTC 午夜，
 * 东八区之外整体差一天）。
 */
export function weekdayOfDateKey(dateKey: string): Weekday {
  const [year, month, day] = dateKey.split('-').map(Number)
  return weekdayOf(new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1))
}

/** 日期键 → 该日是否周末（周六 / 周日） */
export function isWeekendDateKey(dateKey: string): boolean {
  return weekdayOfDateKey(dateKey) >= 6
}

/** 日期键加减天数（返回新的日期键；跨月 / 跨年交给 Date 处理） */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1)
  date.setDate(date.getDate() + days)
  return formatDateKey(date)
}

/** 根据时间返回问候语 */
export function greetingByHour(date: Date): string {
  const hour = date.getHours()
  if (hour < 6) return '夜深了'
  if (hour < 12) return '上午好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}
