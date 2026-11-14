/**
 * 违纪自定义预设自检（v3.8.1 · Phase 3）。
 *
 * 覆盖三块：
 * 1. **纯逻辑**：名称匹配键（trim / 连续空白合并 / ASCII 忽略大小写）、系统优先、
 *    去重、首次绑定默认严重程度、显式更新只改预设；
 * 2. **持久化 / 跨标签广播 / 同步键预注册**：独立 Repository、Store、启动时不等违纪页；
 * 3. **与历史事件的边界**：更新预设默认值不改变历史事件 severity。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { nextTick } from 'vue'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { installFakeBrowser, type FakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import { VIOLATION_PRESETS_KEY, VIOLATIONS_KEY } from '@/repositories'
import { applySyncKeys, syncedKeys } from '@/services/sync'
import { useViolationPresetStore, startViolationPresetSync } from '@/stores/violationPreset'
import { startViolationSync } from '@/stores/violation'
import { useViolationStore } from '@/stores/violation'
import {
  buildViolationCustomPreset,
  findCustomPresetByLabel,
  matchViolationEventName,
  normalizeViolationLabelKey,
  reviveViolationCustomPresets,
  withUpdatedDefaultSeverity,
} from '@/utils/violationPreset'
import type { ViolationCustomPreset, ViolationDraft } from '@/types/violation'

const prefix = appConfig.storageKeyPrefix
const STUDENTS_KEY = `${prefix}:students`

let browser: FakeBrowser

beforeEach(() => {
  browser = installFakeBrowser()
  setActivePinia(createPinia())
})

function preset(label: string, severity: 'minor' | 'moderate' | 'severe'): ViolationCustomPreset {
  return buildViolationCustomPreset({
    label,
    defaultSeverity: severity,
    now: new Date('2026-11-14T00:00:00.000Z'),
    id: `custom-${label}`,
  })
}

function seedStudent(): void {
  browser.localStorage.seed(
    STUDENTS_KEY,
    JSON.stringify([{ id: 's1', name: '安琪', studentNo: '', gender: 'female' }]),
  )
}

/* ==================== 纯逻辑：匹配键 ==================== */

describe('自定义事件匹配键', () => {
  it('去首尾空白、连续空白合并为一个空格', () => {
    expect(normalizeViolationLabelKey('  课堂上   擅自离开座位  ')).toBe('课堂上 擅自离开座位')
    // 全角空格也按空白处理
    expect(normalizeViolationLabelKey('宿舍\u3000\u3000喧哗')).toBe('宿舍 喧哗')
  })

  it('ASCII 字母忽略大小写；非 ASCII 字符按原字符比较', () => {
    expect(normalizeViolationLabelKey('Late  For  Class')).toBe('late for class')
    // 全角字母 / 中文不被改写
    expect(normalizeViolationLabelKey('ＡＢＣ 迟到')).toBe('ＡＢＣ 迟到')
  })

  it('空输入返回空键（调用方据此拒绝保存空事件）', () => {
    expect(normalizeViolationLabelKey('   ')).toBe('')
    expect(normalizeViolationLabelKey('')).toBe('')
  })
})

/* ==================== 纯逻辑：系统优先 / 去重 / 默认值 ==================== */

describe('系统预设优先与自定义去重', () => {
  const existing = preset('课堂上  擅自离开座位', 'moderate')

  it('输入与系统事件同名（含空白差异）→ 命中系统预设，不创建自定义', () => {
    const matched = matchViolationEventName('  迟到  ', [existing])
    expect(matched.kind).toBe('system')
    if (matched.kind !== 'system') return
    expect(matched.preset.id).toBe('routine-late')
    expect(matched.preset.defaultSeverity).toBe('minor')
  })

  it('系统没有同名事件 → 命中已有自定义（匹配键口径）', () => {
    const matched = matchViolationEventName(' 课堂上 擅自离开座位 ', [existing])
    expect(matched.kind).toBe('custom')
    if (matched.kind !== 'custom') return
    expect(matched.preset.id).toBe(existing.id)
  })

  it('都没有 → 需要新建', () => {
    const matched = matchViolationEventName('在走廊追逐', [existing])
    expect(matched.kind).toBe('new')
    if (matched.kind !== 'new') return
    expect(matched.label).toBe('在走廊追逐')
  })

  it('展示名称保留首次创建时的原文，不被匹配键覆盖', () => {
    const named = buildViolationCustomPreset({
      label: '  Late  For  Class ',
      defaultSeverity: 'minor',
      id: 'custom-x',
      now: new Date('2026-11-14T00:00:00.000Z'),
    })
    expect(named.label).toBe('  Late  For  Class ')
    expect(named.labelKey).toBe('late for class')
    expect(findCustomPresetByLabel([named], 'late for class')?.label).toBe('  Late  For  Class ')
  })

  it('显式更新只改 defaultSeverity 与 updatedAt，label/labelKey/id 不变', () => {
    const updated = withUpdatedDefaultSeverity(
      existing,
      'severe',
      new Date('2026-11-15T00:00:00.000Z'),
    )
    expect(updated).toMatchObject({
      id: existing.id,
      label: existing.label,
      labelKey: existing.labelKey,
      defaultSeverity: 'severe',
      createdAt: existing.createdAt,
      updatedAt: '2026-11-15T00:00:00.000Z',
    })
  })

  it('revive：同名 labelKey 只留首条；重复 id 丢弃；未知 severity 隔离保留', () => {
    const raw = [
      { ...existing, id: 'custom-a' },
      { ...existing, id: 'custom-b' }, // 同 labelKey → 丢
      {
        id: 'custom-c',
        label: '另一个事件',
        labelKey: '另一个事件',
        defaultSeverity: 'minor',
        createdAt: 'x',
        updatedAt: 'x',
      },
      { id: 'custom-future', label: '未来事件', defaultSeverity: 'critical' }, // 未知 severity → 隔离
      { label: '缺 id', defaultSeverity: 'minor' },
    ]
    const records = reviveViolationCustomPresets(raw)
    expect(records).toHaveLength(3)
    expect(records[0]).toMatchObject({ id: 'custom-a', label: existing.label })
    expect(records[2]).toEqual(raw[3])
  })
})

/* ==================== Store：持久化 / 广播 / 启动注册 ==================== */

describe('Store：持久化与同步注册', () => {
  it('启动预注册：不打开违纪页面也同时注册事件键与自定义预设键', () => {
    // 注意：这里没有打开违纪页面（没有在页面里实例化 useViolationStore）
    expect(syncedKeys()).not.toContain(VIOLATIONS_KEY)
    expect(syncedKeys()).not.toContain(VIOLATION_PRESETS_KEY)
    startViolationSync()
    startViolationPresetSync()
    expect(syncedKeys()).toContain(VIOLATIONS_KEY)
    expect(syncedKeys()).toContain(VIOLATION_PRESETS_KEY)
  })

  it('main.ts 在启动云同步对账之前预注册两个违纪键（违纪页懒加载）', () => {
    const main = readFileSync(resolve(process.cwd(), 'src/main.ts'), 'utf8')
    // 只看真正的调用行，避免命中注释里的函数名
    const violationLine = main
      .split('\n')
      .findIndex((line) => /^\s*startViolationSync\(pinia\)\s*$/.test(line))
    const presetLine = main
      .split('\n')
      .findIndex((line) => /^\s*startViolationPresetSync\(pinia\)\s*$/.test(line))
    const autoSyncLine = main
      .split('\n')
      .findIndex((line) => /^\s*startAutoSync\(\)\s*$/.test(line))
    expect(violationLine).toBeGreaterThan(-1)
    expect(presetLine).toBeGreaterThan(-1)
    expect(autoSyncLine).toBeGreaterThan(-1)
    expect(violationLine).toBeLessThan(autoSyncLine)
    expect(presetLine).toBeLessThan(autoSyncLine)
  })

  it('首次创建绑定 defaultSeverity；再次同名复用不重复创建', async () => {
    const store = useViolationPresetStore()
    const first = store.resolveForSave('课堂上擅自离开座位', 'moderate')
    expect(first.kind).toBe('custom')
    if (first.kind !== 'custom') return
    expect(first.created).toBe(true)
    expect(first.preset.defaultSeverity).toBe('moderate')

    const again = store.resolveForSave('  课堂上擅自离开座位  ', 'severe')
    expect(again.kind).toBe('custom')
    if (again.kind !== 'custom') return
    expect(again.created).toBe(false)
    expect(again.preset.id).toBe(first.preset.id)
    // 单次选择不覆盖预设默认值
    expect(again.preset.defaultSeverity).toBe('moderate')
    await nextTick()
    expect(store.presets).toHaveLength(1)
  })

  it('与系统预设同名时不创建自定义预设', async () => {
    const store = useViolationPresetStore()
    const resolved = store.resolveForSave('  迟到 ', 'severe')
    expect(resolved.kind).toBe('system')
    await nextTick()
    expect(store.presets).toHaveLength(0)
    expect(browser.localStorage.getItem(VIOLATION_PRESETS_KEY)).toBeNull()
  })

  it('写入 localStorage 后重新加载仍在（Repository 持久化）', async () => {
    const store = useViolationPresetStore()
    store.resolveForSave('在走廊追逐', 'moderate')
    await nextTick()
    const stored = JSON.parse(browser.localStorage.getItem(VIOLATION_PRESETS_KEY)!) as unknown[]
    expect(stored).toHaveLength(1)

    setActivePinia(createPinia())
    const reloaded = useViolationPresetStore()
    expect(reloaded.presets).toHaveLength(1)
    expect(reloaded.presets[0]?.label).toBe('在走廊追逐')
    expect(reloaded.presets[0]?.defaultSeverity).toBe('moderate')
  })

  it('跨标签页广播：另一入口写入后本页 Store 跟随更新', async () => {
    const store = useViolationPresetStore()
    store.resolveForSave('在走廊追逐', 'minor')
    await nextTick()

    const external = preset('另一台设备的事件', 'severe')
    browser.localStorage.seed(VIOLATION_PRESETS_KEY, JSON.stringify([...store.presets, external]))
    applySyncKeys([VIOLATION_PRESETS_KEY])
    await nextTick()

    expect(store.presets.map((item) => item.label)).toEqual(['在走廊追逐', '另一台设备的事件'])
  })

  it('显式更新预设默认值：后续解析使用新值，但历史事件 severity 不变', async () => {
    seedStudent()
    const presetStore = useViolationPresetStore()
    const resolved = presetStore.resolveForSave('课堂上擅自离开座位', 'moderate')
    if (resolved.kind !== 'custom') throw new Error('expected custom preset')
    await nextTick()

    // 先存一条历史事件（severity = moderate）
    const violationStore = useViolationStore()
    const draft: ViolationDraft = {
      studentId: 's1',
      date: '2026-11-03',
      timeSlotKind: 'forenoon',
      presetId: resolved.preset.id,
      presetKind: 'custom',
      behaviorLabel: resolved.preset.label,
      severity: 'moderate',
    }
    const saved = violationStore.addViolation(draft)
    expect(saved).toBeDefined()
    await nextTick()

    // 显式更新预设默认值为 severe
    presetStore.updateDefaultSeverity(resolved.preset.id, 'severe')
    await nextTick()
    expect(presetStore.findById(resolved.preset.id)?.defaultSeverity).toBe('severe')
    // 历史事件严重程度不受影响
    expect(violationStore.events[0]?.severity).toBe('moderate')
    // 下次选择使用新默认值
    const next = presetStore.resolveForSave('课堂上擅自离开座位', 'minor')
    if (next.kind !== 'custom') throw new Error('expected custom preset')
    expect(next.created).toBe(false)
    expect(next.preset.defaultSeverity).toBe('severe')
  })
})
