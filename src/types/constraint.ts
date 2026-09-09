/**
 * 座位约束领域类型（Phase 3C 引入）。
 * 3C 只落「关系型约束」（no-deskmate / no-adjacent，手工录入）与两类派生检查
 * （高个坐前排、班委集中——来自学生档案既有字段，不落库）；
 * back-row / front-row / same-block 为自动排座（后续阶段）预留的规则位，暂不产生数据。
 */

/** 约束类型 */
export type SeatConstraintType =
  'no-deskmate' | 'no-adjacent' | 'back-row' | 'front-row' | 'same-block'

/** 一条座位约束：以学生（可选第二位）为对象，只描述「不应当」，不做自动调整 */
export interface SeatConstraint {
  id: string
  /** 约束主体学生 id（必填） */
  studentA: string
  /** 关联学生 id（no-deskmate / no-adjacent 必填；规则型预留可缺省） */
  studentB?: string
  type: SeatConstraintType
  /** 是否参与检查（关闭 = 保留但忽略） */
  enabled: boolean
  /** 补充说明（可选，班主任备注） */
  reason?: string
}
