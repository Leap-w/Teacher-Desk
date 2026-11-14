/**
 * 违纪管理领域类型（v3.8.1 · Phase 3）。
 *
 * ## v3.8.1 的关键变化
 *
 * - **取消违纪类型分类**：业务字段只剩「违纪事件 + 严重程度」。旧记录里的 `category`
 *   允许读取但不再参与业务，新写入不再产出它（读时兼容、写时收敛）。
 * - **系统预设保持代码级配置**：`config/violationPresets.ts` 的 24 条（22 条原有真实事件 +
 *   「私藏手机」「宿舍卫生脏乱」），`presetId` / `defaultSeverity` 全部保持稳定。
 * - **自定义预设成为正式持久化数据**（`ViolationCustomPreset`）：独立 localStorage 键、
 *   Repository、Store、跨标签页广播、CloudBase bind、JSON 备份。首次保存事件时创建，
 *   事件用稳定 `presetId` 关联（`presetKind: 'custom'`），不用姓名或数组下标。
 *
 * ## 边界（与 v3.8.0 一致）
 *
 * - **一条记录 = 一次已经发生的违纪事实**。累计次数、排行、各等级数量一律由
 *   `utils/violationStats.ts` 从事件数组实时计算，**不落库、不写进学生模型、
 *   不维护独立计数器**。
 * - **严重程度只是分类标签**：不折算违纪次数、不扣分、不触发处分；每条事件恒计一次。
 * - 学生用 `Student.id` 关联；`studentName` 只是展示快照。
 * - 发生**日期**与**时间段**分别保存。
 *
 * 本文件**只有类型定义**：标签、枚举全集、校验、normalize 在 `utils/violation.ts`
 * 与 `utils/violationPreset.ts`，系统预设清单在 `config/violationPresets.ts`。
 */
import type { CoursePeriodId } from './timetable'

/**
 * 严重程度（三级）：
 * - `minor`    一般违纪
 * - `moderate` 较严重违纪
 * - `severe`   严重违纪
 *
 * **只分类、不加权**：统计里每条事件恒计一次（需求「严重程度不转换为违纪次数」）。
 */
export type ViolationSeverity = 'minor' | 'moderate' | 'severe'

/**
 * 事件关联的预设来源：
 * - `system`：`config/violationPresets.ts` 的系统预设；
 * - `custom`：教师自定义预设（持久化在 `teacherdesk:violationPresets`）。
 *
 * **历史记录可能没有这个字段**（v3.8.0 之前只有 `presetId`）：读取时按
 * 「能否解析为系统预设」推断，不修改历史数据。
 */
export type ViolationPresetKind = 'system' | 'custom'

/**
 * 发生时间段类型（固定枚举）。
 *
 * `period`（第 X 节课）复用 `types/timetable.ts` 的 `COURSE_PERIODS`；
 * `custom` 只用文本；其余六个是事实枚举。
 */
export type ViolationTimeSlotKind =
  'morning' | 'forenoon' | 'noon' | 'afternoon' | 'evening' | 'lights-out' | 'period' | 'custom'

/**
 * 一条违纪事件。**每条独立保存**，不合并、不累计、不覆盖历史。
 *
 * 可选字段的缺省约定：**空串一律不写这个键**（normalize / 写入路径都会把
 * `''` 折成「没有这个字段」）——同 `Student.idCardSuffix` 的口径。
 */
export interface ViolationEvent {
  /** 事件唯一 ID（`createId()` 生成；导入 / 跨端同步时保持原 ID） */
  id: string
  /** 稳定学生 ID（`Student.id`）——唯一关联依据，绝不使用姓名 */
  studentId: string
  /** 学生姓名快照（写入时生成；学生改名后由 store 刷新，软删除后冻结） */
  studentName: string
  /** 发生日期（`YYYY-MM-DD`，本地日历日） */
  date: string
  /** 发生时间段类型 */
  timeSlotKind: ViolationTimeSlotKind
  /** `timeSlotKind === 'period'` 时的课表时段 id（复用 `COURSE_PERIODS`） */
  periodId?: CoursePeriodId
  /** 时段名称快照（课表日后调整不能改写历史记录） */
  periodLabel?: string
  /** 科目快照（只在 `period` 时有意义） */
  subject?: string
  /** `timeSlotKind === 'custom'` 时的自定义时间文本 */
  customTimeText?: string
  /** 命中的预设 id（系统预设或自定义预设）；缺省 = 无预设关联的历史自定义文本 */
  presetId?: string
  /**
   * 预设来源；历史记录可能缺失。
   * 缺失时读取路径按 `presetId` 能否解析为系统预设推断（见 `utils/violation.ts`）。
   */
  presetKind?: ViolationPresetKind
  /** 具体违纪行为文本快照（系统预设名 / 自定义预设名 / 教师自填文本） */
  behaviorLabel: string
  /**
   * 严重程度（每条独立保存，后续允许教师调整）。
   *
   * **写入永远只有这三个已知值**（严格校验）。读到未知值（更高版本新增的等级）时
   * **绝不折算**：整条记录进入隔离区原样保留，见 `ViolationQuarantinedRecord`。
   */
  severity: ViolationSeverity
  /** 事件描述（可空） */
  description?: string
  /** 教师备注（可空，与家长处理意见**分开保存**） */
  teacherNote?: string
  /** 家长处理意见（可空、多行、可后续补充修改；每条事件独立） */
  parentNote?: string
  /** 创建时间（ISO） */
  createdAt: string
  /** 更新时间（ISO） */
  updatedAt: string
}

/**
 * 新增 / 编辑违纪事件时的可写字段。
 * `id` / `studentName` / `createdAt` / `updatedAt` 由 store 维护，表单不产出。
 */
export type ViolationDraft = Omit<ViolationEvent, 'id' | 'studentName' | 'createdAt' | 'updatedAt'>

/**
 * 批量新增时每名学生共用的那一部分（学生 id 由调用方逐人补）。
 * 批量新增一次选择 N 名学生 = N 条独立事件，共用一个草稿。
 */
export type ViolationBatchDraft = Omit<ViolationDraft, 'studentId'>

/**
 * 一条**系统**违纪预设（代码级配置，见 `config/violationPresets.ts`）。
 *
 * v3.8.1 起不再有分类字段；严重程度由系统自动带出，教师可改单条事件但不改预设。
 */
export interface ViolationPreset {
  /** 稳定预设 id（落进 `ViolationEvent.presetId`，**改 id 等于让历史记录失去预设关联**） */
  id: string
  /** 展示文案（同时也作为 `behaviorLabel` 的快照来源） */
  label: string
  /** 新增记录时的**初始**严重程度；只是初值，教师可改本次记录 */
  defaultSeverity: ViolationSeverity
}

/**
 * 一条**自定义**违纪预设（v3.8.1 新增；正式持久化业务数据）。
 *
 * - `label`：教师**首次输入时的原文**（后续展示都用它，不被匹配键覆盖）；
 * - `labelKey`：匹配键（trim、连续空白合并、ASCII 忽略大小写；见
 *   `utils/violationPreset.ts` 的 `normalizeViolationLabelKey`）；
 * - `defaultSeverity`：首次保存事件时教师选择的严重程度；之后只有**显式更新**才会改；
 * - 与历史事件用稳定 `id` 关联（`ViolationEvent.presetId` + `presetKind: 'custom'`）。
 */
export interface ViolationCustomPreset {
  /** 稳定唯一 ID，形如 `custom-<uuid>` */
  id: string
  /** 首次创建时的原始事件名称（展示用，不改写） */
  label: string
  /** 规范化后的匹配键（去重 / 查找用） */
  labelKey: string
  /** 默认严重程度（首次绑定；显式更新才改） */
  defaultSeverity: ViolationSeverity
  createdAt: string
  updatedAt: string
}

/**
 * **被隔离的盘上违纪记录**：无法安全规范化、但绝不能丢的原始记录。
 *
 * 当前唯一来源是「未知严重程度」——未来版本可能把三级扩展成四级（如 `critical`），
 * 旧版本读到它时**不允许**折算成已知等级：那会把新版本的事实静默降级，并顺着
 * 「写回 → 云同步 → 备份」传播。因此这类记录以原始对象原样存放于同一存储数组：
 * 不进入 UI、统计、编辑、新增流程；任何一次写盘 / 广播 / 同步 / 备份都原样带出。
 */
export type ViolationQuarantinedRecord = Record<string, unknown>

/**
 * 存储数组里可能出现的两种条目：
 * - `ViolationEvent`：本版本能安全规范化的合法事件（唯一进入业务的数据）；
 * - `ViolationQuarantinedRecord`：被隔离的原始记录（只保数据，不参与业务）。
 */
export type ViolationStoredRecord = ViolationEvent | ViolationQuarantinedRecord

/**
 * 自定义预设的隔离记录：未知 `defaultSeverity` 等无法安全规范化的原始对象。
 * 与事件隔离同一口径——旧版本看不懂就不动，绝不折算成已知等级。
 */
export type ViolationCustomPresetQuarantinedRecord = Record<string, unknown>

/** 自定义预设存储数组：合法预设 + 被隔离的原始对象 */
export type ViolationPresetStoredRecord =
  ViolationCustomPreset | ViolationCustomPresetQuarantinedRecord
