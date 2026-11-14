/**
 * 违纪自定义预设 / 事件名称匹配的纯逻辑（v3.8.1 · Phase 3）。
 *
 * ## 匹配规则（需求 D）
 *
 * 1. 先匹配**系统预设**（按 labelKey）；
 * 2. 系统不存在时匹配**已有自定义预设**（按 labelKey）；
 * 3. 都不存在才创建新自定义预设；
 * 4. `labelKey` 生成：去首尾空白 → 连续空白合并为一个空格 → ASCII A-Z 转小写；
 *    其它字符（中文、标点、全角字符）按原字符比较；
 * 5. **展示名称始终是首次创建时的原文**（`label`），不用 labelKey 覆盖。
 *
 * ## 未知严重程度隔离
 *
 * 与违纪事件同一口径：自定义预设读到未知 `defaultSeverity` 时**不折算**、不丢弃，
 * 原始对象原样留在存储数组里（`ViolationCustomPresetQuarantinedRecord`），
 * 只从业务视图里排除；写盘 / 同步 / 备份都原样带出。
 */
import { VIOLATION_PRESETS } from '@/config/violationPresets'
import { createId } from '@/utils/id'
import { isPlainObject } from '@/utils/object'
import type {
  ViolationCustomPreset,
  ViolationCustomPresetQuarantinedRecord,
  ViolationPreset,
  ViolationPresetStoredRecord,
  ViolationSeverity,
} from '@/types/violation'

/* ==================== 名称匹配键 ==================== */

/**
 * 自定义事件匹配键：
 * - `trim()` 去首尾空白；
 * - `[\s\u3000]+` 连续空白（含全角空格）合并为一个半角空格；
 * - **只把 ASCII A-Z 转小写**（`toLowerCase()` 会连带处理其他文字，不符合「其他字符按原字符比较」）。
 */
export function normalizeViolationLabelKey(label: string): string {
  return label
    .trim()
    .replace(/[\s\u3000]+/g, ' ')
    .replace(/[A-Z]/g, (char) => char.toLowerCase())
}

/** 系统预设按 labelKey 建索引（模块加载一次） */
const SYSTEM_PRESET_BY_LABEL_KEY: ReadonlyMap<string, ViolationPreset> = new Map(
  VIOLATION_PRESETS.map((preset) => [normalizeViolationLabelKey(preset.label), preset]),
)

/** 按名称找系统预设（匹配键口径）；找不到返回 undefined */
export function findSystemPresetByLabel(label: string): ViolationPreset | undefined {
  return SYSTEM_PRESET_BY_LABEL_KEY.get(normalizeViolationLabelKey(label))
}

/** 按名称找已有自定义预设（匹配键口径）；返回首个（去重后 labelKey 唯一） */
export function findCustomPresetByLabel(
  presets: readonly ViolationCustomPreset[],
  label: string,
): ViolationCustomPreset | undefined {
  const key = normalizeViolationLabelKey(label)
  if (!key) return undefined
  return presets.find((preset) => preset.labelKey === key)
}

/* ==================== 解析：系统 / 自定义 / 新建 ==================== */

export type ViolationEventNameMatch =
  | { kind: 'system'; labelKey: string; preset: ViolationPreset }
  | { kind: 'custom'; labelKey: string; preset: ViolationCustomPreset }
  /** 系统与已有自定义都没有同名事件；保存时需要创建自定义预设 */
  | { kind: 'new'; labelKey: string; label: string }

/**
 * 把教师输入/选择的名称解析成「系统预设 / 已有自定义 / 需要新建」。
 *
 * **系统预设优先**：即使教师手工输入了和系统事件同名的文字，也按系统处理，
 * 不创建同名自定义预设。
 */
export function matchViolationEventName(
  label: string,
  presets: readonly ViolationCustomPreset[],
): ViolationEventNameMatch {
  const labelKey = normalizeViolationLabelKey(label)
  const systemPreset = findSystemPresetByLabel(label)
  if (systemPreset) return { kind: 'system', labelKey, preset: systemPreset }
  const customPreset = findCustomPresetByLabel(presets, label)
  if (customPreset) return { kind: 'custom', labelKey, preset: customPreset }
  return { kind: 'new', labelKey, label }
}

/* ==================== 创建 / 更新 ==================== */

export interface BuildViolationCustomPresetInput {
  /** 教师原始输入（展示用原文；匹配键另行 trim / 合并空白） */
  label: string
  defaultSeverity: ViolationSeverity
  /** 便于测试固定时间 / id；生产不传 */
  now?: Date
  id?: string
}

/**
 * 生成一条新的自定义预设。
 *
 * **调用方必须先确认**：系统预设与已有自定义预设都没有同名事件——
 * 去重规则统一在 `matchViolationEventName`，不要在别处各写一套。
 */
export function buildViolationCustomPreset(
  input: BuildViolationCustomPresetInput,
): ViolationCustomPreset {
  const nowIso = (input.now ?? new Date()).toISOString()
  return {
    id: input.id ?? `custom-${createId()}`,
    label: input.label,
    labelKey: normalizeViolationLabelKey(input.label),
    defaultSeverity: input.defaultSeverity,
    createdAt: nowIso,
    updatedAt: nowIso,
  }
}

/**
 * 显式更新自定义预设的默认严重程度（**只改长期默认，不改任何历史事件**）。
 * 返回新对象；调用方负责落盘。
 */
export function withUpdatedDefaultSeverity(
  preset: ViolationCustomPreset,
  severity: ViolationSeverity,
  now: Date = new Date(),
): ViolationCustomPreset {
  return { ...preset, defaultSeverity: severity, updatedAt: now.toISOString() }
}

/* ==================== normalize / revive（含未知 severity 隔离） ==================== */

/** 自定义预设的解析结果：合法 / 隔离 / 丢弃 */
export type ViolationCustomPresetParseResult =
  | { kind: 'preset'; preset: ViolationCustomPreset }
  | {
      kind: 'quarantined'
      raw: ViolationCustomPresetQuarantinedRecord
      reason: 'unknown-severity'
    }
  | { kind: 'invalid'; reason: 'not-an-object' | 'no-id' | 'invalid-fields' }

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isKnownSeverity(value: unknown): value is ViolationSeverity {
  return value === 'minor' || value === 'moderate' || value === 'severe'
}

/** 单条自定义预设的健壮化（load / 跨标签页 / 云端采纳 / 备份导入共用） */
export function parseViolationCustomPreset(raw: unknown): ViolationCustomPresetParseResult {
  if (!isPlainObject(raw)) return { kind: 'invalid', reason: 'not-an-object' }
  const id = textOf(raw.id)
  if (!id) return { kind: 'invalid', reason: 'no-id' }

  if (!isKnownSeverity(raw.defaultSeverity)) {
    // 未知等级：原样隔离，绝不折算（同违纪事件口径）
    return { kind: 'quarantined', raw, reason: 'unknown-severity' }
  }

  const label = typeof raw.label === 'string' ? raw.label : ''
  if (!textOf(label)) return { kind: 'invalid', reason: 'invalid-fields' }
  const createdAt = textOf(raw.createdAt) || new Date().toISOString()
  const updatedAt = textOf(raw.updatedAt) || createdAt
  return {
    kind: 'preset',
    preset: {
      id,
      // 原文保留（含首尾空格）；labelKey 独立计算/读取
      label,
      labelKey: normalizeViolationLabelKey(label),
      defaultSeverity: raw.defaultSeverity,
      createdAt,
      updatedAt,
    },
  }
}

export function isViolationCustomPreset(value: unknown): value is ViolationCustomPreset {
  if (!isPlainObject(value)) return false
  if (!textOf(value.id)) return false
  if (!textOf(value.label)) return false
  if (!isKnownSeverity(value.defaultSeverity)) return false
  return true
}

/**
 * 把盘上的原始列表规范成**混合数组**：合法自定义预设 + 原样保留的隔离记录。
 *
 * 去重规则（确定性）：同一 id 只留首条；同一 `labelKey` 只留首条（保留首次创建的名称）。
 * 重复条目丢弃只告警，**不动盘上原文**。
 */
export function reviveViolationCustomPresets(raw: unknown[]): ViolationPresetStoredRecord[] {
  const seenIds = new Set<string>()
  const seenKeys = new Set<string>()
  const records: ViolationPresetStoredRecord[] = []
  let quarantined = 0
  let invalid = 0
  for (const item of raw) {
    const parsed = parseViolationCustomPreset(item)
    if (parsed.kind === 'invalid') {
      invalid += 1
      continue
    }
    if (parsed.kind === 'quarantined') {
      quarantined += 1
      records.push(parsed.raw)
      continue
    }
    if (seenIds.has(parsed.preset.id)) {
      invalid += 1
      continue
    }
    if (seenKeys.has(parsed.preset.labelKey)) {
      invalid += 1
      continue
    }
    seenIds.add(parsed.preset.id)
    seenKeys.add(parsed.preset.labelKey)
    records.push(parsed.preset)
  }
  if (quarantined > 0) {
    console.warn(
      `[violationPreset] 隔离 ${quarantined} 条未知默认严重程度的自定义预设（原样保留、未折算等级）`,
    )
  }
  if (invalid > 0) {
    console.warn(`[violationPreset] 丢弃 ${invalid} 条不合法的自定义预设（缓存原文保留）`)
  }
  return records
}

/** 按 id 找自定义预设（针对合法数组） */
export function findCustomPresetById(
  presets: readonly ViolationCustomPreset[],
  id: string | undefined,
): ViolationCustomPreset | undefined {
  if (!id) return undefined
  return presets.find((preset) => preset.id === id)
}
