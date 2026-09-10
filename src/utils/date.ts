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

/** 根据时间返回问候语 */
export function greetingByHour(date: Date): string {
  const hour = date.getHours()
  if (hour < 6) return '夜深了'
  if (hour < 12) return '上午好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}
