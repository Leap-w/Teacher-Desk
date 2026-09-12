/** 座位领域类型：Seat（单个座位）/ SeatPlan（座位方案）/ SeatChangeLog（换座日志，Phase 3B 起自动记录） */

/** 座位所属列块：由 ClassroomConfig.blocks 的累计宽度自动切分，不手工指定 */
export type SeatBlock = 'left' | 'center' | 'right'

/**
 * 教室视角（V1.1.2 Phase 1 起为完整 180° 旋转关系）：
 * - `teacher`：老师视角 = 真实教室平面（讲台在上、第 1 排紧随其后、列号左→右递增）；
 * - `student`：学生视角 = 同一份数据的 180° 旋转（前后翻转 + 左右翻转）。
 * **只影响渲染坐标，不改变任何座位数据**（见 `utils/seatView.ts`）。
 */
export type SeatView = 'teacher' | 'student'

/** 座位：教室网格中的固定位置（63 个），布局信息不随方案 / 视角变化 */
export interface Seat {
  /** 稳定座位标识 r{row}c{col}（如 r1c3）：跨方案、跨视角一致，供展示 / 选中 / 换座日志引用 */
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

/* ========== V1.1.2 Phase 1：排座约束（属于「座位方案」，不属于学生档案） ========== */

/** 不能同桌：两名学生不得处于同一桌（同排同列块，每桌 3 座：1/2/3、4/5/6、7/8/9） */
export interface SameDeskForbiddenRule {
  id: string
  /** 学生 A */
  studentA: string
  /** 学生 B */
  studentB: string
}

/** 三人不能相邻组：组内任意两人都不得相邻（四邻域：上下左右；不含对角、不含跨过道） */
export interface AdjacentGroupForbiddenRule {
  id: string
  /** 恰好三名学生 */
  students: [string, string, string]
}

/**
 * 方案的排座约束（Phase 1）。
 * - `sameDeskForbidden` / `adjacentGroupForbidden`：**较强约束**，违反记为错误（error）；
 * - `frontRowStudents` / `backRowStudents`：**排座偏好**，未满足只提醒（warning），
 *   **不阻止任何拖拽交换**；同一名学生不会被同时放进两份名单（store 侧保证）。
 */
export interface SeatPlanConstraints {
  sameDeskForbidden: SameDeskForbiddenRule[]
  adjacentGroupForbidden: AdjacentGroupForbiddenRule[]
  /** 应优先安排在前排（第 1~2 排）的学生 id */
  frontRowStudents: string[]
  /** 应优先安排在后排（第 5~7 排）的学生 id */
  backRowStudents: string[]
}

/** 座位方案：某一时点的整班座位编排快照 + 该方案的换座记录 + 排座约束 */
export interface SeatPlan {
  id: string
  /** 方案名，如「开学初」「第一次月考后」 */
  name: string
  /** 创建时间（ISO） */
  createdAt: string
  /** 最近内容更新时间（ISO，重命名 / 换座 / 保存调整时刷新） */
  updatedAt: string
  /** 是否为当前使用方案（同一时刻至多一个） */
  isCurrent: boolean
  /** 该方案的 63 个座位（含空位） */
  seats: Seat[]
  /** 换座记录归档（Phase 3B 起：拖拽 / 点击换座经「保存本次调整」提交后追加于此） */
  changeLogs: SeatChangeLog[]
  /**
   * 排座约束（V1.1.2 Phase 1 新增）。旧数据缺省 → 空约束（由 `normalizeSeatPlan` 补齐），
   * **升级不会导致既有方案丢失**。
   */
  constraints: SeatPlanConstraints
}

/**
 * 换座记录（Phase 3B 起自动写入）。
 * - 交换：两名学生各记一条；移动：记一条；拖回原位：不记录；
 * - from / to 为位置短文案（如「2排3列」，渲染时拼为「2排3列 → 5排1列」）；
 * - studentName 为发生时快照（姓名（学号后四位），不携带座位号——换座后原座位号即刻失真）。
 */
export interface SeatChangeLog {
  id: string
  /** 所属座位方案 id */
  planId: string
  studentId: string
  /** 换座发生时的学生显示名快照 */
  studentName: string
  from: string
  to: string
  /** 发生时间（ISO） */
  changedAt: string
}
