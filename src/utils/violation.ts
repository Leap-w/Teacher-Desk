/**
 * 违纪记录工具函数（v3.8.1 · Phase 3：取消分类、兼容旧 category、预设来源识别）。
 *
 * 这里只有**不碰浏览器、不碰存储**的纯逻辑：normalize / 校验 / 标签 / 排序 / 展示文本。
 *
 * ## 四类贯穿全文件的取舍
 *
 * ① **读路径三分：合法事件 / 隔离记录 / 丢弃**（v3.8.0 修正保留）。
 * ② **未知严重程度绝不折算**：原样隔离，写盘 / 广播 / 同步 / 备份都带出。
 * ③ **空串不写键**。
 * ④ **v3.8.1：旧 category 读时兼容、写时收敛**——`cleanViolationDraft` 不再要求 category，
 *    `isViolationEvent` 不再校验 category；读入旧记录后重建对象时自然不再输出该字段。
 *    **不为了删 category 去重建全部历史事件**，只有教师正常编辑时才顺带收敛。
 */
import { LEGACY_CUSTOM_PRESET_ID, findViolationPreset } from '@/config/violationPresets'
import { formatMonthDay, isDateKey } from '@/utils/date'
import { createId } from '@/utils/id'
import { isPlainObject } from '@/utils/object'
import { refreshStudentNames } from '@/utils/student'
import { isValidPeriodId, periodLabelOf } from '@/utils/timetable'
import type { Student } from '@/types'
import type { CoursePeriodId } from '@/types/timetable'
import type {
  ViolationDraft,
  ViolationEvent,
  ViolationPresetKind,
  ViolationQuarantinedRecord,
  ViolationSeverity,
  ViolationStoredRecord,
  ViolationTimeSlotKind,
} from '@/types/violation'

/* ========== 枚举全集与中文文案（界面/导出/统计共用，禁止各写一份） ========== */

/** 全部合法严重程度（由轻到重） */
export const KNOWN_VIOLATION_SEVERITIES: readonly ViolationSeverity[] = [
  'minor',
  'moderate',
  'severe',
]

/** 全部合法时间段类型（日期与时间段分开保存，这里只有「时间段」那一半） */
export const KNOWN_VIOLATION_TIME_SLOT_KINDS: readonly ViolationTimeSlotKind[] = [
  'morning',
  'forenoon',
  'noon',
  'afternoon',
  'evening',
  'lights-out',
  'period',
  'custom',
]

/** 严重程度中文文案（列表徽标 / 统计 / 详情共用） */
export const VIOLATION_SEVERITY_LABELS: Record<ViolationSeverity, string> = {
  minor: '一般违纪',
  moderate: '较严重违纪',
  severe: '严重违纪',
}

/** 时间段类型中文文案（列表 / 详情共用；`period` / `custom` 的具体值另算） */
export const VIOLATION_TIME_SLOT_LABELS: Record<ViolationTimeSlotKind, string> = {
  morning: '早上',
  forenoon: '上午',
  noon: '中午',
  afternoon: '下午',
  evening: '晚上',
  'lights-out': '熄灯后',
  period: '第 X 节课',
  custom: '自定义',
}

/**
 * 严重程度的数值次序（1 最轻 / 3 最重）。
 * **只用于排序与展示分组**，不参与任何计次或折算（严重程度不转换为违纪次数）。
 */
export const VIOLATION_SEVERITY_ORDER: Record<ViolationSeverity, number> = {
  minor: 1,
  moderate: 2,
  severe: 3,
}

/* ========== 类型守卫 ========== */

export function isViolationPresetKind(value: unknown): value is ViolationPresetKind {
  return value === 'system' || value === 'custom'
}

export function isViolationSeverity(value: unknown): value is ViolationSeverity {
  return (
    typeof value === 'string' && (KNOWN_VIOLATION_SEVERITIES as readonly string[]).includes(value)
  )
}

export function isViolationTimeSlotKind(value: unknown): value is ViolationTimeSlotKind {
  return (
    typeof value === 'string' &&
    (KNOWN_VIOLATION_TIME_SLOT_KINDS as readonly string[]).includes(value)
  )
}

/** 日期合法性（`YYYY-MM-DD` 且这一天真实存在；口径同请假 / 假期，复用 `isDateKey`） */
export function isValidViolationDate(value: unknown): value is string {
  return isDateKey(value)
}

/* ========== 时间段 ========== */

/** 已经过校验时间段（`resolveTimeSlot` 的产出；字段与 `ViolationDraft` 的那几项同形） */
interface ResolvedTimeSlot {
  timeSlotKind: ViolationTimeSlotKind
  periodId?: CoursePeriodId
  periodLabel?: string
  subject?: string
  customTimeText?: string
}

/** 取「去首尾空白的字符串」；非字符串 → 空串（调用方据此判断「没填」） */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 解析并校验时间段（读路径与写路径**共用这一份**）。
 *
 * 规则：
 * - `period`（第 X 节课）：节次 id 认得出 → 必须带名称快照（没给就用 `periodLabelOf` 派生的
 *   官方名称，保证历史记录日后一定读得懂）；节次 id 认不出但教师填了名称快照 → **保留名称**、
 *   丢掉认不出的 id（不因为一个字段坏掉就丢掉整条事实）；两者都没有 → 这条记录没有时间段，
 *   返回 `null`（由调用方丢弃并告警）。
 * - `custom`（自定义）：**必须有文本**，空文本等于没有时间段 → `null`。
 * - 其余六种事实枚举：不带附加字段（即使脏数据里带着 periodId / customTimeText 也剔掉，
 *   避免「早上」的记录里挂着「第3节」这种自相矛盾的数据）。
 */
function resolveTimeSlot(raw: Record<string, unknown>): ResolvedTimeSlot | null {
  const kind = raw.timeSlotKind
  if (!isViolationTimeSlotKind(kind)) return null

  if (kind === 'period') {
    const labelInput = textOf(raw.periodLabel)
    const subject = textOf(raw.subject)
    if (isValidPeriodId(raw.periodId)) {
      return {
        timeSlotKind: kind,
        periodId: raw.periodId,
        // 名称快照优先用教师/历史给的那份，缺失时由课表定义派生（不写死「第3节」这类文案）
        periodLabel: labelInput || periodLabelOf(raw.periodId),
        ...(subject ? { subject } : {}),
      }
    }
    if (labelInput) {
      return { timeSlotKind: kind, periodLabel: labelInput, ...(subject ? { subject } : {}) }
    }
    return null
  }

  if (kind === 'custom') {
    const customTimeText = textOf(raw.customTimeText)
    return customTimeText ? { timeSlotKind: kind, customTimeText } : null
  }

  return { timeSlotKind: kind }
}

/* ========== 写入路径的严格校验 ========== */

/**
 * 把「教师提交的草稿」清洗成合法 `ViolationDraft`；任何必填项不合法 → `null`（拒绝写入）。
 *
 * **不做兜底猜测**：严重程度认不出就是 `null`（而不是悄悄改成「一般」）；
 * 行为文本为空就是 `null`（而不是拿预设名顶上）。写路径上的猜会变成教师没同意过的数据。
 */
export function cleanViolationDraft(raw: unknown): ViolationDraft | null {
  if (!isPlainObject(raw)) return null

  const studentId = textOf(raw.studentId)
  if (!studentId) return null

  const date = raw.date
  if (!isValidViolationDate(date)) return null

  const slot = resolveTimeSlot(raw)
  if (!slot) return null

  const severity = raw.severity
  if (!isViolationSeverity(severity)) return null

  const behaviorLabel = textOf(raw.behaviorLabel)
  if (!behaviorLabel) return null

  const presetId = textOf(raw.presetId)
  // v3.8.1：presetKind 可选（历史记录没有）；给了就必须是合法值，不做猜测
  const presetKind = raw.presetKind
  if (presetKind !== undefined && !isViolationPresetKind(presetKind)) return null
  const description = textOf(raw.description)
  const teacherNote = textOf(raw.teacherNote)
  const parentNote = textOf(raw.parentNote)

  return {
    studentId,
    date,
    ...slot,
    ...(presetId ? { presetId } : {}),
    ...(presetKind ? { presetKind } : {}),
    behaviorLabel,
    severity,
    ...(description ? { description } : {}),
    ...(teacherNote ? { teacherNote } : {}),
    ...(parentNote ? { parentNote } : {}),
  }
}

/* ========== 读路径：合法事件 / 隔离记录 / 丢弃 ========== */

/** ISO 时间文本：非字符串 / 空串用兜底值（历史数据可能没有这两个字段） */
function timestampOf(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

/** 单条盘上记录的解析结果（`parseViolationRecord` 的产出） */
export type ViolationParseResult =
  | { kind: 'event'; event: ViolationEvent }
  /**
   * 无法安全规范化、但绝不能丢的原始记录。当前唯一来源是**未知严重程度**。
   * `raw` 就是 `JSON.parse` 出来的那个对象本身（不克隆、不包装），后续写盘原样带出。
   */
  | { kind: 'quarantined'; raw: ViolationQuarantinedRecord; reason: 'unknown-severity' }
  /** 认不出的条目：非对象 / 连 id 都没有 / 严重程度之外还有必填项缺失 */
  | { kind: 'invalid'; reason: 'not-an-object' | 'no-id' | 'invalid-fields' }

/** 用已校验的草稿 + 原始身份字段拼出一条可进入业务的事件 */
function buildEventFromRaw(raw: Record<string, unknown>, draft: ViolationDraft): ViolationEvent {
  const createdAt = timestampOf(raw.createdAt, new Date().toISOString())
  return {
    id: textOf(raw.id) || createId(),
    studentName: textOf(raw.studentName),
    ...draft,
    createdAt,
    updatedAt: timestampOf(raw.updatedAt, createdAt),
  }
}

/**
 * 解析单条盘上记录（load / 跨标签页同步 / 云端采纳 / 备份导入共用这一份）。
 *
 * **三分逻辑**：
 * 1. **未知严重程度 → 隔离**（`kind: 'quarantined'`，原对象原样保留）。
 *    绝不折算成 `minor` / `preset` 默认等级 / 任何已知等级：折算会把新版本的事实降级，
 *    而旧版本的**下一次写盘 / 云推送 / 备份**会把这个降级值传播出去（见文件头 ②）。
 *    只有连 `id` 都没有的条目无法参与按 id 的合并与追溯，才只能丢弃。
 * 2. **严重程度合法 → 严格规范化**：其余必填项缺失仍按既有口径丢弃（`invalid`）。
 * 3. 非对象 → 丢弃。
 */
export function parseViolationRecord(raw: unknown): ViolationParseResult {
  if (!isPlainObject(raw)) return { kind: 'invalid', reason: 'not-an-object' }

  if (!isViolationSeverity(raw.severity)) {
    if (!textOf(raw.id)) return { kind: 'invalid', reason: 'no-id' }
    return { kind: 'quarantined', raw, reason: 'unknown-severity' }
  }

  const draft = cleanViolationDraft(raw)
  if (!draft) return { kind: 'invalid', reason: 'invalid-fields' }
  return { kind: 'event', event: buildEventFromRaw(raw, draft) }
}

/**
 * 运行期类型守卫：这个条目是不是本版本能安全使用的合法事件。
 *
 * 刻意**不**复用 `cleanViolationDraft`（那会重建对象、也无法用 `instanceof` 之类区分）：
 * 混合数组里合法事件与隔离记录必须能分开，否则统计/编辑会把隔离记录当成正常数据。
 * 隔离记录必然带未知严重程度 → 这里第一个判据就能把它挡住。
 */
export function isViolationEvent(value: unknown): value is ViolationEvent {
  if (!isPlainObject(value)) return false
  if (!isViolationSeverity(value.severity)) return false
  if (!isViolationTimeSlotKind(value.timeSlotKind)) return false
  if (!isValidViolationDate(value.date)) return false
  if (value.presetKind !== undefined && !isViolationPresetKind(value.presetKind)) return false
  if (!textOf(value.id)) return false
  if (!textOf(value.studentId)) return false
  if (!textOf(value.behaviorLabel)) return false
  return true
}

/** 运行期类型守卫：隔离记录（混合数组里的另一半） */
export function isQuarantinedViolationRecord(value: unknown): value is ViolationQuarantinedRecord {
  return isPlainObject(value) && !isViolationEvent(value)
}

/**
 * 把盘上的原始列表规范成**混合数组**：合法事件 + 原样保留的隔离记录（保持原顺序）。
 *
 * 为什么不能只返回合法事件：Repository / Store 的单一数据源就是这份数组，
 * 写盘时把它序列化回存储。少一条 = 下一次任意编辑就把那条记录从盘上删掉，
 * 再顺着跨标签页广播与云同步传播出去——正是本次修正要避免的数据丢失。
 *
 * 同一 id 的合法事件只保留首条（重复 id 会让统计多数一次）；
 * 隔离记录不做去重（无法安全读懂它的身份，宁可原样保留）。
 * 丢弃 / 隔离都只告警，**不动盘上原文**。
 */
export function reviveViolationRecords(raw: unknown[]): ViolationStoredRecord[] {
  const seenIds = new Set<string>()
  const records: ViolationStoredRecord[] = []
  let invalid = 0
  let quarantined = 0
  for (const item of raw) {
    const parsed = parseViolationRecord(item)
    if (parsed.kind === 'invalid') {
      invalid += 1
      continue
    }
    if (parsed.kind === 'quarantined') {
      quarantined += 1
      records.push(parsed.raw)
      continue
    }
    if (seenIds.has(parsed.event.id)) {
      invalid += 1
      continue
    }
    seenIds.add(parsed.event.id)
    records.push(parsed.event)
  }
  if (quarantined > 0) {
    console.warn(
      `[violation] 隔离 ${quarantined} 条无法安全规范化的记录（严重程度未知，原样保留、未折算等级）`,
    )
  }
  if (invalid > 0) {
    console.warn(`[violation] 丢弃 ${invalid} 条不合法的违纪记录（缓存原文保留）`)
  }
  return records
}

/* ========== 快照 / 转换 ========== */

/**
 * 姓名快照刷新（**合法事件数组**版）：学生改名 / 补学号后按档案刷新；学生被软删除后其
 * 快照冻结在原姓名（软删记录仍在 `students` 数组里，`refreshStudentNames` 读到的就是
 * 删除那一刻的姓名）。与请假 / 假期登记共用同一份实现（`utils/student.ts`）。
 *
 * ⚠️ 存储链路请用 `refreshViolationStoredRecords`：这个函数吃的是纯事件数组，
 * 对混合数组（含隔离记录）用它会丢掉隔离记录。
 */
export function refreshViolationStudentNames(
  records: ViolationEvent[],
  students: Student[],
): ViolationEvent[] {
  return refreshStudentNames(records, students)
}

/**
 * 姓名快照刷新（**混合存储数组**版，Store 用这一份）：
 * 只改合法事件的 `studentName`，隔离记录**一个字节都不动**（连引用都不换）。
 *
 * 为什么不能先 `filter(合法)` 再整体替换：`refreshStudentNames` 在「学生查无且快照为空」
 * 时会丢弃该条；存储路径不能丢数据，所以这里对被丢弃的情况保留原记录（不替换），
 * 最坏只是姓名快照旧一点，绝不会让一条记录消失。
 *
 * 没有任何实际变化时返回**原数组引用**——`writeJSON` 的幂等因此生效，不会产生无谓写盘。
 */
export function refreshViolationStoredRecords(
  records: ViolationStoredRecord[],
  students: Student[],
): ViolationStoredRecord[] {
  if (!records.some(isViolationEvent)) return records
  const events = records.filter(isViolationEvent)
  const refreshed = refreshStudentNames(events, students)
  const byId = new Map(refreshed.map((event) => [event.id, event]))
  let changed = false
  const next = records.map((record) => {
    if (!isViolationEvent(record)) return record
    const updated = byId.get(record.id)
    if (!updated || updated === record) return record
    changed = true
    return updated
  })
  return changed ? next : records
}

/** 事件 → 可写字段（编辑时与补丁合并用；不带 id / 快照 / 时间戳） */
export function draftOfViolation(event: ViolationEvent): ViolationDraft {
  const draft: ViolationDraft = {
    studentId: event.studentId,
    date: event.date,
    timeSlotKind: event.timeSlotKind,
    behaviorLabel: event.behaviorLabel,
    severity: event.severity,
  }
  if (event.periodId) draft.periodId = event.periodId
  if (event.periodLabel) draft.periodLabel = event.periodLabel
  if (event.subject) draft.subject = event.subject
  if (event.customTimeText) draft.customTimeText = event.customTimeText
  if (event.presetId) draft.presetId = event.presetId
  if (event.presetKind) draft.presetKind = event.presetKind
  if (event.description) draft.description = event.description
  if (event.teacherNote) draft.teacherNote = event.teacherNote
  if (event.parentNote) draft.parentNote = event.parentNote
  return draft
}

/* ========== 预设查找（utils 这一侧的唯一入口，页面不要直接 import config） ========== */

/** 按 id 查预设（历史 id 可能已被下线 → 返回 `undefined`，调用方必须能处理） */
export function findViolationPresetById(id: string | undefined) {
  return findViolationPreset(id)
}

/** 事件是否命中某条仍有效的系统预设 */
export function violationPresetOf(event: Pick<ViolationEvent, 'presetId'>) {
  return findViolationPreset(event.presetId)
}

/**
 * 事件的预设来源：
 * - 有 `presetKind` 就直接用（新写入路径）；
 * - 历史记录没有该字段：`presetId` 能解析为系统预设 → `system`；否则（含已下线 id /
 *   `other-custom` / 自定义预设 id）→ `custom`；
 * - 没有 `presetId` → `undefined`（纯历史文本，编辑时回填到自定义输入框）。
 *
 * **只用于展示与编辑回填，不触发任何严重程度重算**。
 */
export function presetKindOfEvent(
  event: Pick<ViolationEvent, 'presetId' | 'presetKind'>,
): ViolationPresetKind | undefined {
  if (event.presetKind) return event.presetKind
  if (!event.presetId) return undefined
  return findViolationPreset(event.presetId) ? 'system' : 'custom'
}

/** 是否 v3.8.0 的「其他自定义事件」哨兵记录（历史兼容用；不再作为系统预设展示） */
export function isLegacyCustomPresetEvent(event: Pick<ViolationEvent, 'presetId'>): boolean {
  return event.presetId === LEGACY_CUSTOM_PRESET_ID
}

/* ========== 展示文本 ========== */

/**
 * 时间段展示文本：
 * - `period` → 「第3节 · 数学」（名称快照优先；科目快照有才拼）
 * - `custom` → 教师填的文本
 * - 其余 → 固定中文文案
 */
export function formatViolationTimeSlot(
  event: Pick<
    ViolationEvent,
    'timeSlotKind' | 'periodId' | 'periodLabel' | 'subject' | 'customTimeText'
  >,
): string {
  if (event.timeSlotKind === 'period') {
    const label =
      event.periodLabel ||
      (event.periodId ? periodLabelOf(event.periodId) : '') ||
      VIOLATION_TIME_SLOT_LABELS.period
    return event.subject ? `${label} · ${event.subject}` : label
  }
  if (event.timeSlotKind === 'custom') {
    return event.customTimeText || VIOLATION_TIME_SLOT_LABELS.custom
  }
  return VIOLATION_TIME_SLOT_LABELS[event.timeSlotKind]
}

/** 「9月11日 第3节 · 数学」——列表与个人档案共用的一句时间读法 */
export function formatViolationOccurredAt(
  event: Pick<
    ViolationEvent,
    'date' | 'timeSlotKind' | 'periodId' | 'periodLabel' | 'subject' | 'customTimeText'
  >,
): string {
  return `${formatMonthDay(event.date)} ${formatViolationTimeSlot(event)}`
}

/* ========== 排序 ========== */

/**
 * 违纪记录排序（**返回新数组，不改入参**）：按发生日期**倒序**（最近发生的在前），
 * 同一天按创建时间倒序，最后用 id 兜底，保证顺序确定、刷新不变
 * （同 `sortLeaveRecords` 的口径：没有三级兜底时同秒创建的两条会在两次渲染里换位置）。
 */
export function sortViolationEvents<T extends ViolationEvent>(events: readonly T[]): T[] {
  return [...events].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1
    if (a.id === b.id) return 0
    return a.id < b.id ? -1 : 1
  })
}
