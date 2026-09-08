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

/* ========== 路由 / 布局 ========== */

/** 侧边栏导航项 */
export interface NavItem {
  path: string
  title: string
  icon: string
}

/** 首页仪表盘卡片 */
export interface DashboardCard {
  key: 'schedule' | 'todo' | 'leave' | 'class'
  title: string
  icon: string
  description: string
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
  studentNo: string
  gender: Gender
  seatNumber?: number
  /** 宿舍（展示用，如「3 号楼 412」；后续可迁移为实体 ID）。全班统一住校，住校状态不入模型 */
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

/** 班干部 */
export interface ClassCadre {
  id: string
  studentId: string
  /** 职务名称，如「班长」「学习委员」 */
  role: string
  /** 任期起始（ISO 日期） */
  since: string
}

/** 宿舍 */
export interface Dormitory {
  id: string
  building: string
  room: string
  bedCount: number
}

/** 待办事项 */
export interface TodoItem {
  id: string
  title: string
  done: boolean
  /** 截止日期（ISO 日期） */
  dueDate?: string
}

/** 请假类型 */
export type LeaveType = 'sick' | 'personal' | 'other'

/** 请假状态 */
export type LeaveStatus = 'pending' | 'approved' | 'rejected'

/** 请假记录 */
export interface LeaveRecord {
  id: string
  studentId: string
  type: LeaveType
  /** 请假开始 / 结束（ISO 日期时间） */
  startAt: string
  endAt: string
  reason: string
  status: LeaveStatus
  createdAt: string
}
