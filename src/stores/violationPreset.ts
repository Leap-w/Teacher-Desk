/**
 * 违纪自定义预设 Store（v3.8.1 · Phase 3）。
 *
 * ## 数据流（与其余模块完全一致）
 *
 * ```
 * records（ref，混合数组：合法自定义预设 + 未知 severity 隔离记录）
 *   → violationPresetRepository.bind()
 *     → localStorage 写盘 + 跨标签页广播 + CloudBase 同步注册
 * presets（computed，只含合法预设）  ← UI / 匹配 / 默认严重程度
 * ```
 *
 * ## 启动时预注册（重要）
 *
 * 违纪页面是懒加载的：如果只在 `useViolationStore()` 里实例化本 Store，那么「应用启动后
 * 从未打开过违纪页」的设备就不会把 `teacherdesk:violationPresets` 注册进同步表，
 * 导致自定义预设永远不参与云端同步（而界面上完全看不出来）。
 *
 * 因此 `main.ts` 在 `startAutoSync()` **之前**调用 `startViolationPresetSync(pinia)`，
 * 只实例化本 Store（= 完成 Repository.bind），不依赖违纪页面。这是最小方案：
 * 不新增同步引擎、不改协议、不提前实例化整个违纪事件 Store。
 *
 * ## 与事件的关系
 *
 * - 事件只保存稳定 `presetId` + `presetKind: 'custom'`，不依赖姓名 / 数组下标；
 * - 删除预设：本阶段**不提供删除入口**（需求未要求；历史事件靠 `behaviorLabel` 快照
 *   仍可读，但删预设会让编辑回填失去目标，故不做）。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Pinia } from 'pinia'

import { violationPresetRepository } from '@/repositories'
import {
  buildViolationCustomPreset,
  findCustomPresetById,
  findCustomPresetByLabel,
  isViolationCustomPreset,
  matchViolationEventName,
  reviveViolationCustomPresets,
  withUpdatedDefaultSeverity,
} from '@/utils/violationPreset'
import type {
  ViolationCustomPreset,
  ViolationCustomPresetQuarantinedRecord,
  ViolationPreset,
  ViolationPresetStoredRecord,
  ViolationSeverity,
} from '@/types/violation'

/** 名称解析结果：系统预设 / 已有自定义预设 / 本次新建的自定义预设 */
export type ViolationPresetResolution =
  | {
      kind: 'system'
      labelKey: string
      preset: ViolationPreset
      created: false
    }
  | {
      kind: 'custom'
      labelKey: string
      preset: ViolationCustomPreset
      /** true = 本次保存时新建；false = 复用了已有预设 */
      created: boolean
    }

export const useViolationPresetStore = defineStore('violationPreset', () => {
  /** 单一数据源（混合数组，整体写盘；写操作不得过滤掉隔离记录） */
  const records = ref<ViolationPresetStoredRecord[]>(violationPresetRepository.load())

  // 写盘 + 跨标签页广播 + 云端同步（既有机制，一行接入）
  violationPresetRepository.bind(records, (raw) => reviveViolationCustomPresets(raw))

  /** 合法自定义预设（UI / 匹配只用它） */
  const presets = computed(() => records.value.filter(isViolationCustomPreset))

  /** 被隔离的未知 severity 原始记录（本阶段无 UI；保留诊断能力） */
  const quarantinedRecords = computed<ViolationCustomPresetQuarantinedRecord[]>(() =>
    records.value.filter(
      (record): record is ViolationCustomPresetQuarantinedRecord =>
        !isViolationCustomPreset(record),
    ),
  )
  const quarantinedCount = computed(() => quarantinedRecords.value.length)

  /** 按 id 找自定义预设 */
  function findById(id: string | undefined): ViolationCustomPreset | undefined {
    return findCustomPresetById(presets.value, id)
  }

  /** 按名称（匹配键）找已有自定义预设 */
  function findByLabel(label: string): ViolationCustomPreset | undefined {
    return findCustomPresetByLabel(presets.value, label)
  }

  /**
   * 解析教师输入/选择的事件名称：
   * **系统预设优先 → 已有自定义 → 新建自定义**（去重规则唯一入口）。
   *
   * 新建时把本次选择的严重程度绑定为 `defaultSeverity`；已有自定义**不因本次选择
   * 自动改默认值**（显式更新走 `updateDefaultSeverity`）。
   */
  function resolveForSave(label: string, severity: ViolationSeverity): ViolationPresetResolution {
    const matched = matchViolationEventName(label, presets.value)
    if (matched.kind === 'system') {
      return { kind: 'system', labelKey: matched.labelKey, preset: matched.preset, created: false }
    }
    if (matched.kind === 'custom') {
      return {
        kind: 'custom',
        labelKey: matched.labelKey,
        preset: matched.preset,
        created: false,
      }
    }
    const preset = buildViolationCustomPreset({ label, defaultSeverity: severity })
    // 追加到混合数组末尾：隔离记录原样保留
    records.value = [...records.value, preset]
    return { kind: 'custom', labelKey: preset.labelKey, preset, created: true }
  }

  /**
   * **显式**更新自定义预设的默认严重程度（只改长期默认，不改任何历史事件）。
   *
   * - 只接受合法自定义预设；系统预设没有 id 可传进来，天然不可改；
   * - 值没有变化时不写盘（避免无意义广播）；
   * - 返回更新后的预设；找不到返回 `undefined`。
   */
  function updateDefaultSeverity(
    presetId: string,
    severity: ViolationSeverity,
  ): ViolationCustomPreset | undefined {
    const index = records.value.findIndex(
      (record) => isViolationCustomPreset(record) && record.id === presetId,
    )
    if (index === -1) return undefined
    const current = records.value[index]
    if (!current || !isViolationCustomPreset(current)) return undefined
    if (current.defaultSeverity === severity) return current
    const updated = withUpdatedDefaultSeverity(current, severity)
    records.value = [...records.value.slice(0, index), updated, ...records.value.slice(index + 1)]
    return updated
  }

  return {
    presets,
    quarantinedRecords,
    quarantinedCount,
    findById,
    findByLabel,
    resolveForSave,
    updateDefaultSeverity,
  }
})

/**
 * 启动时预注册自定义预设的同步键（`main.ts` 在 `startAutoSync()` 之前调用）。
 * 幂等：重复调用拿到的是同一个 Store 实例。
 */
export function startViolationPresetSync(pinia?: Pinia): void {
  useViolationPresetStore(pinia)
}
