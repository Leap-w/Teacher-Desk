import type { Lesson, Weekday } from '@/types/timetable'

/** 星期中文标签（课程卡片右上角「今天 星期四」、周视图等共用一处） */
export const WEEKDAY_LABELS: Record<Weekday, string> = {
  1: '星期一',
  2: '星期二',
  3: '星期三',
  4: '星期四',
  5: '星期五',
  6: '星期六',
  7: '星期日',
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
