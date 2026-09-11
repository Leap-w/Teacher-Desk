/**
 * 「日期 + 上午 / 下午」的时间点（半天粒度）——Phase 7A 从 `types/leave.ts` 抽出的公共件。
 *
 * 请假时段（Phase 5）与周末返家的离校 / 返校登记（Phase 7）用的是**同一个形状**：
 * 班主任日常说的是「请一上午」「周日晚上回来」，精确到时刻会抬高录入门槛，
 * 而登记离校 / 返校时也只记得住「哪天上午走的」。两个模块共用这一份定义，
 * 不再各写一套几乎一样的实现（Phase 7A 的抽取，见 docs/roadmap.md「Phase 7」）。
 *
 * 边界（§2.2）：这里只描述「某天的上半天或下半天」这个事实，
 * **不含任何「能否回家」的推导**——能否回家是教师对某一次申请的决定，不是时间的性质。
 */

/** 半天 */
export type HalfDay = 'am' | 'pm'

/**
 * 一个时间点：日期（YYYY-MM-DD）+ 上午 / 下午。
 * 请假起止与离校 / 返校登记**共用同一形状**——四者都是「某天的上半天或下半天」。
 */
export interface DayPoint {
  /** 日期键，如 `2026-09-11`（由 `formatDateKey` 从本地时间生成，不走 UTC） */
  date: string
  half: HalfDay
}

/** 登记方向：left = 离校，back = 返校 */
export type RegisterMode = 'left' | 'back'

/**
 * 一条记录上的两个登记端点（离校 / 返校）。
 * 请假（`LeaveRecord`）存这两个字段；Phase 7B 的周末返家记录按同一口径存
 * （尚未实现），因此「取某一端」「派生离校 / 返校状态」的公共件可以直接吃下整个记录对象。
 */
export interface RegisterEndpoints {
  /** 离校登记（记录实际离校时间） */
  leftSchool?: DayPoint
  /** 返校登记（需先登记离校，且不早于离校时间） */
  backToSchool?: DayPoint
}
