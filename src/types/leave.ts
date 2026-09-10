/**
 * 请假 / 离校领域类型（Phase 5 引入）。
 *
 * 边界（开发手册 §2.2）：请假记录只描述「这一次请假的事实」——申请、审批结果、
 * 离校 / 返校登记；**不含任何「能否回家」的推导**，周末返家属 Phase 7 周末管理。
 *
 * 时间一律「日期 + 上午 / 下午」，不引入时刻：班主任日常说的是「请一上午」「请三天」，
 * 精确到时刻会抬高录入门槛（Phase 5 范围拍板口径）。
 */

/** 请假类型 */
export type LeaveType = 'sick' | 'personal' | 'other'

/** 审批状态：待处理 → 批准 / 驳回（驳回后不再流转，也无「销假」流程） */
export type LeaveStatus = 'pending' | 'approved' | 'rejected'

/** 半天 */
export type HalfDay = 'am' | 'pm'

/**
 * 一个时间点：日期（YYYY-MM-DD）+ 上午 / 下午。
 * 请假起止与离校 / 返校登记**共用同一形状**——四者都是「某天的上半天或下半天」。
 */
export interface LeavePoint {
  /** 日期键，如 `2026-09-11`（由 `formatDateKey` 从本地时间生成，不走 UTC） */
  date: string
  half: HalfDay
}

/** 一条请假记录 */
export interface LeaveRecord {
  id: string
  studentId: string
  /**
   * 学生姓名快照「姓名（学号后四位）」，写入时生成（同 SeatChangeLog 的做法）。
   * 学生被删除（软删）后记录保留，靠它仍能读出「这是谁的请假」；
   * 学生在档案中改名 / 补学号时，store 会按档案刷新该快照（见 stores/leave.ts）。
   */
  studentName: string
  type: LeaveType
  /** 请假开始（含半天） */
  start: LeavePoint
  /** 请假结束（含半天；不早于 start） */
  end: LeavePoint
  /** 请假原因 */
  reason: string
  status: LeaveStatus
  /** 提交时间（ISO） */
  createdAt: string
  /** 批准 / 驳回时间（ISO；未处理时为 undefined） */
  decidedAt?: string
  /** 审批说明（仅驳回时有意义，批准时不保存） */
  decisionNote?: string
  /** 离校登记（已批准后由教师登记实际离校时间） */
  leftSchool?: LeavePoint
  /** 返校登记（需先登记离校，且不早于离校时间） */
  backToSchool?: LeavePoint
}

/**
 * 新增 / 编辑请假记录的可写字段。
 * `id` / `studentName` / 状态 / 审批字段 / 离校与返校登记均由 store 维护，表单不产出。
 */
export interface LeaveInput {
  studentId: string
  type: LeaveType
  start: LeavePoint
  end: LeavePoint
  reason: string
}
