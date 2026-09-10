/**
 * 座位约束领域类型（Phase 3C 引入，Phase 3D 扩展为五类全部可录入）。
 * - 关系型 no-deskmate / no-adjacent：**硬约束**，自动排座必须满足，违反即冲突；
 * - 规则型 back-row / front-row / same-block：**软规则**，自动排座尽量满足、未满足逐条报告
 *   （3C 预留的三个类型位在 3D 落地）；
 * - 检查器对五类一律只读，不做自动调整。
 */

/** 约束类型 */
export type SeatConstraintType =
  'no-deskmate' | 'no-adjacent' | 'back-row' | 'front-row' | 'same-block'

/** 一条座位约束：以学生（可选第二位）为对象，只描述「不应当」，不做自动调整 */
export interface SeatConstraint {
  id: string
  /** 约束主体学生 id（必填） */
  studentA: string
  /** 关联学生 id（no-deskmate / no-adjacent / same-block 必填；back-row / front-row 缺省） */
  studentB?: string
  type: SeatConstraintType
  /** 是否参与检查与自动排座（关闭 = 保留但忽略） */
  enabled: boolean
  /** 补充说明（可选，班主任备注） */
  reason?: string
}
