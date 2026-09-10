import { WEEKDAY_LABELS, weekdayOf } from '@/utils/timetable'

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
