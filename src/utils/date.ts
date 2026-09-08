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

/** 根据时间返回问候语 */
export function greetingByHour(date: Date): string {
  const hour = date.getHours()
  if (hour < 6) return '夜深了'
  if (hour < 12) return '上午好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}
