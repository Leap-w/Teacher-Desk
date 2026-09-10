/**
 * 课程表领域类型（Phase 4 引入）。
 * 本阶段只有「读」：数据来自本地 mock（`services/mock.ts`），今日课程卡片与本周课时统计
 * 都由它派生；周视图课表编辑、教师 / 科目字典等均未实现（见开发手册 §9.6）。
 */

/** 星期（1 = 周一 … 7 = 周日；与 JS `Date.getDay()` 的 0 = 周日不同，见 `weekdayOf`） */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

/** 一节课（一个班的某天某个节次） */
export interface Lesson {
  id: string
  weekday: Weekday
  /** 节次（第几节，从 1 起） */
  period: number
  /** 科目，如「数学」 */
  subject: string
  /** 上课班级，如「高一9班」 */
  className: string
  /** 上课地点（可选），如「A 栋 302」 */
  location?: string
}
