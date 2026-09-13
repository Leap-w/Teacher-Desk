/**
 * 「当前 / 下一节课」状态机（UI-5A 抽取，**Dashboard 与课程表共用同一份实现**）：
 * 之前这段逻辑内联在首页 `views/Home/index.vue`——课程表页需要同一结论时
 * 不能再抄一遍（规则多一份就多一处会漂移，§11.1），故上收到这里。
 *
 * 判定口径（与首页 NextCourseCard 的四态一致）：
 * - ongoing：start ≤ now < end（显示剩余分钟）
 * - next：start ≥ now 的最早一节（显示 N 分钟后上课）
 * - done：今天有课但全部结束
 * - empty：今天没课（周末不排 / 课程表无安排由调用方区分文案）
 *
 * 时段时间唯一来源：`types/timetable.ts#COURSE_PERIODS`（不在组件里散落 07:40 之类）。
 */
import { COURSE_PERIODS } from '@/types/timetable'
import type { CoursePeriod, Lesson } from '@/types/timetable'

export interface ScheduleNowState {
  state: 'ongoing' | 'next' | 'done' | 'empty'
  /** ongoing / next 对应的课程 */
  lesson?: Lesson
  /** 对应时段（取起止时间 / 标签用） */
  period?: CoursePeriod
  /** ongoing = 距结束分钟；next = 距上课分钟 */
  minutesLeft?: number
}

function hhmmOf(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 分钟差：hh:mm − hh:mm（同日） */
function minutesBetween(target: string, from: string): number {
  const [th, tm] = target.split(':').map(Number)
  const [fh, fm] = from.split(':').map(Number)
  return th * 60 + tm - (fh * 60 + fm)
}

/** 按 COURSE_PERIODS 的 order 升序排（时段自上而下的顺序） */
export function sortLessonsByPeriod<T extends { periodId: Lesson['periodId'] }>(lessons: T[]): T[] {
  const order = new Map(COURSE_PERIODS.map((period, index) => [period.id, index]))
  return [...lessons].sort((a, b) => (order.get(a.periodId) ?? 0) - (order.get(b.periodId) ?? 0))
}

/** 计算某天课程里的「当前 / 下一节」状态（lessons 传入**当天的**课程） */
export function scheduleNowOf(lessons: Lesson[], now: Date): ScheduleNowState {
  if (lessons.length === 0) return { state: 'empty' }
  const hhmm = hhmmOf(now)
  const sorted = sortLessonsByPeriod(lessons)

  const ongoing = sorted.find((lesson) => {
    const period = COURSE_PERIODS.find((item) => item.id === lesson.periodId)
    return period && period.startTime <= hhmm && hhmm < period.endTime
  })
  if (ongoing) {
    const period = COURSE_PERIODS.find((item) => item.id === ongoing.periodId)
    return {
      state: 'ongoing',
      lesson: ongoing,
      period,
      minutesLeft: period ? Math.max(1, minutesBetween(period.endTime, hhmm)) : undefined,
    }
  }

  const upcoming = sorted.find((lesson) => {
    const period = COURSE_PERIODS.find((item) => item.id === lesson.periodId)
    return period && period.startTime >= hhmm
  })
  if (upcoming) {
    const period = COURSE_PERIODS.find((item) => item.id === upcoming.periodId)
    return {
      state: 'next',
      lesson: upcoming,
      period,
      minutesLeft: period ? Math.max(0, minutesBetween(period.startTime, hhmm)) : undefined,
    }
  }

  return { state: 'done' }
}
