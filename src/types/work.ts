/**
 * 工作清单领域类型（V1.1.3 新增，「工作管理」的第二个板块）。
 *
 * 定位是**班主任 + 任课教师的日常任务**（收请假条 / 批改作业 / 家长沟通 / 班会准备…），
 * **不是项目管理系统**：字段刻意保持扁平，不做子任务、依赖、看板与审批流。
 */

/** 任务状态：待完成 / 进行中 / 已完成 */
export type WorkStatus = 'todo' | 'in-progress' | 'done'

/** 优先级：普通 / 重要 / 紧急 */
export type WorkPriority = 'normal' | 'important' | 'urgent'

/** 分类预设（固定三项；导入时认不出的分类归入「其他」并给出提示） */
export const WORK_CATEGORIES = ['班主任', '教学', '其他'] as const

export type WorkCategory = (typeof WORK_CATEGORIES)[number]

/**
 * 一条工作。
 * `date` 是**归属日期**（YYYY-MM-DD，「今日 / 本周」按它分组），`deadline` 是当天的截止时间（HH:mm，可选）。
 * 两者分开：`18:00 前交材料` 这类信息不该把日期撑成一个时间戳（也让日期排序简单可靠）。
 */
export interface WorkItem {
  id: string
  /** 工作名称（必填，如「收齐学生请假条」） */
  title: string
  /** 补充说明（可选） */
  description?: string
  /** 归属日期 YYYY-MM-DD */
  date: string
  /** 当天截止时间 HH:mm（可选） */
  deadline?: string
  status: WorkStatus
  priority: WorkPriority
  category: WorkCategory
  /** 创建时间（ISO） */
  createdAt: string
  /** 最近更新时间（ISO） */
  updatedAt: string
}

/** 新增 / 编辑工作时的可写字段（id 与时间戳由 store 生成） */
export type WorkInput = Omit<WorkItem, 'id' | 'createdAt' | 'updatedAt'>

/** 状态中文标签（列表分组、筛选按钮、导入预览共用） */
export const WORK_STATUS_LABELS: Record<WorkStatus, string> = {
  todo: '待完成',
  'in-progress': '进行中',
  done: '已完成',
}

/** 优先级中文标签 */
export const WORK_PRIORITY_LABELS: Record<WorkPriority, string> = {
  normal: '普通',
  important: '重要',
  urgent: '紧急',
}

/** 列表筛选（「全部 / 待完成 / 进行中 / 已完成」——与需求给出的四项一致） */
export type WorkFilter = 'all' | WorkStatus
