/** 座位领域类型：Seat（单个座位）/ SeatPlan（座位方案）/ SeatChangeLog（换座日志，Phase 3B 预留） */

/** 座位所属列块：由 ClassroomConfig.blocks 的累计宽度自动切分，不手工指定 */
export type SeatBlock = 'left' | 'center' | 'right'

/** 座位：教室网格中的固定位置（63 个），布局信息不随方案 / 视角变化 */
export interface Seat {
  /** 稳定座位标识 r{row}c{col}（如 r1c3）：跨方案、跨视角一致，供展示 / 选中 / 未来换座日志引用 */
  id: string
  /** 排号：1~7（第 1 排最靠近讲台） */
  row: number
  /** 列号：1~9（从左到右） */
  col: number
  /** 所属列块（自动计算，不持久化信任） */
  block: SeatBlock
  /** 就座学生 id；缺省 = 空位 */
  studentId?: string
}

/** 座位方案：某一时点的整班座位编排快照（未来支持开学初 / 月考后 / 家长会版等多方案并存） */
export interface SeatPlan {
  id: string
  /** 方案名，如「开学初」「第一次月考后」 */
  name: string
  /** 创建时间（ISO） */
  createdAt: string
  /** 最近内容更新时间（ISO，重命名 / 换座时刷新） */
  updatedAt: string
  /** 是否为当前使用方案（同一时刻至多一个） */
  isCurrent: boolean
  /** 该方案的 63 个座位（含空位） */
  seats: Seat[]
}

/**
 * 换座记录（Phase 3B 拖拽换座时写入；本阶段仅建立数据结构，不自动记录）。
 * from / to 为 Seat.id（r{row}c{col} 形式）。
 */
export interface SeatChangeLog {
  studentId: string
  from: string
  to: string
}
