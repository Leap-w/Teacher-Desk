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
 *
 * **v3.3.0**：时间可被「教学设置 → 课程时间」覆盖，所以两个函数都收一份 `periods`。
 * 省略时仍是默认作息（纯函数的老调用方与测试不必改），**页面必须传 store 的生效表**——
 * 不传就会拿默认时间判一节课，教师改完作息后首页的「下一节课」会早 20 分钟。
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

/**
 * 按时段表的顺序升序排（时段自上而下的顺序）。
 * 顺序取的是**数组下标**而非 `period.order`：生效表就是默认表叠了时间，顺序不变，
 * 两者一致；用下标则在「传进来的是一张已排好序的子表」时也不会错位。
 */
export function sortLessonsByPeriod<T extends { periodId: Lesson['periodId'] }>(
  lessons: T[],
  periods: readonly CoursePeriod[] = COURSE_PERIODS,
): T[] {
  const order = new Map(periods.map((period, index) => [period.id, index]))
  return [...lessons].sort((a, b) => (order.get(a.periodId) ?? 0) - (order.get(b.periodId) ?? 0))
}

/** 计算某天课程里的「当前 / 下一节」状态（lessons 传入**当天的**课程） */
export function scheduleNowOf(
  lessons: Lesson[],
  now: Date,
  periods: readonly CoursePeriod[] = COURSE_PERIODS,
): ScheduleNowState {
  if (lessons.length === 0) return { state: 'empty' }
  const hhmm = hhmmOf(now)
  const sorted = sortLessonsByPeriod(lessons, periods)
  const periodOf = (id: Lesson['periodId']) => periods.find((item) => item.id === id)

  const ongoing = sorted.find((lesson) => {
    const period = periodOf(lesson.periodId)
    return period && period.startTime <= hhmm && hhmm < period.endTime
  })
  if (ongoing) {
    const period = periodOf(ongoing.periodId)
    return {
      state: 'ongoing',
      lesson: ongoing,
      period,
      minutesLeft: period ? Math.max(1, minutesBetween(period.endTime, hhmm)) : undefined,
    }
  }

  const upcoming = sorted.find((lesson) => {
    const period = periodOf(lesson.periodId)
    return period && period.startTime >= hhmm
  })
  if (upcoming) {
    const period = periodOf(upcoming.periodId)
    return {
      state: 'next',
      lesson: upcoming,
      period,
      minutesLeft: period ? Math.max(0, minutesBetween(period.startTime, hhmm)) : undefined,
    }
  }

  return { state: 'done' }
}
