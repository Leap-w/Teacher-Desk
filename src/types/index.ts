/* ========== 通用 UI 类型 ========== */

/** 下拉选项 */
export interface SelectOption<T extends string | number = string | number> {
  label: string
  value: T
  disabled?: boolean
}

/** 徽标外观 */
export type BadgeVariant = 'primary' | 'success' | 'warning' | 'danger' | 'neutral'

/** Toast 变体 */
export type ToastVariant = 'info' | 'success' | 'warning' | 'danger'

/** Toast 实例 */
export interface ToastItem {
  id: number
  message: string
  variant: ToastVariant
  duration: number
}

/* ========== 业务领域类型（仅类型定义，Phase 2 起逐步使用） ========== */

/** 性别 */
export type Gender = 'male' | 'female'

/**
 * 返家范围：按家庭所在地的行政区划归类（事实分类），
 * 不代表“是否允许回家”——是否批准返家属于后续周末管理模块的行为。
 */
export type FamilyScope = 'changdu-city' | 'changdu-county' | 'outside-changdu'

/** 家庭所在地行政区划 */
export interface FamilyLocation {
  /** 地级市/地区，如「昌都市」 */
  prefecture: string
  /** 县/区，如「卡若区」「江达县」 */
  county: string
  scope: FamilyScope
}

/** 学生档案 */
export interface Student {
  id: string
  name: string
  /**
   * 学号。**可为空**（Phase 5A：Excel 导入时学号是选填列；不编造占位值，教师后续自行补）。
   * 非空时全局唯一；**空值之间不查重**——空串不是一个可用的身份键，拿它互相判重会把
   * 「两个都还没填学号的学生」变成写入失败。
   */
  studentNo: string
  gender: Gender
  /**
   * 座位号。**Phase 5A 起已从界面移除、不再维护**，保留字段只因为座位方案的
   * 「开学初」播种与「＋ 新建方案」（`utils/seat.ts` 的 `buildOccupantMap`）仍按它自动就座。
   * 座位图上显示的第 N 号来自座椅行列几何位置（`seatOrdinal`），与这里无关。
   */
  seatNumber?: number
  /**
   * 宿舍。**Phase 5A 起为固定 8 间之一**（见 `utils/student.ts` 的 `DORMITORIES`），
   * 空 = 未分配；不在清单内的历史值由 `normalizeStudent` 收敛为空。
   * 全班统一住校，住校状态不入模型
   */
  dormitory?: string
  /** 班委职务；留空表示非班委 */
  cadreRole?: string
  /** 自定义标签 */
  tags?: string[]
  phone?: string
  remark?: string
  /** 家庭地址（完整文本，如「西藏自治区昌都市卡若区××乡××村」） */
  familyAddress?: string
  /** 家庭所在地行政区划；历史数据可能缺失（load 时经 normalizeStudent 补全） */
  familyLocation?: FamilyLocation
  /** 软删除时间（ISO）；非空表示已删除 */
  deletedAt?: string
}

/** 新增 / 更新学生时的可写字段 */
export type StudentInput = Omit<Student, 'id' | 'deletedAt'>

/** 班干部（预留：学生当前用 `cadreRole: string` 平铺，尚未使用该实体） */
export interface ClassCadre {
  id: string
  studentId: string
  /** 职务名称，如「班长」「学习委员」 */
  role: string
  /** 任期起始（ISO 日期） */
  since: string
}

/** 宿舍（预留：宿舍当前为 `Student.dormitory` 文本，尚未使用该实体） */
export interface Dormitory {
  id: string
  building: string
  room: string
  bedCount: number
}

/* 请假 / 离校模型见 `types/leave.ts`（Phase 5 起为独立领域文件，不再放在本文件） */
