/**
 * 违纪记录备份接入自检（v3.8.0 · Phase 1A）。
 *
 * 备份是教师唯一的退路，所以这里只钉三件事：
 *
 * ① **登记**：`teacherdesk:violations` 出现在 `BACKUP_MODULES` 里（漏登记 = 这个模块
 *    不参与备份，而界面上完全看不出来——技术债 #9 那一类）。
 * ② **往返**：导出 → 解析 → 合并回空库 / 有数据的库，事件一条不少、按 id 对齐。
 * ③ **兼容**：本次**不改** `BACKUP_SCHEMA_VERSION`；旧备份（没有违纪键）导入时不写该键、
 *    不影响其它模块；更新版本的备份仍按既有规则拒绝。
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { FakeBrowser, installFakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import { VIOLATION_PRESETS_KEY, VIOLATIONS_KEY } from '@/repositories'
import {
  BACKUP_KIND,
  BACKUP_MODULES,
  BACKUP_SCHEMA_VERSION,
  createBackup,
  parseBackup,
  planMerge,
} from '@/utils/backup'
import {
  PHOTO_ARCHIVE_BACKUP_ENTRY,
  buildPhotoArchive,
  parsePhotoArchive,
} from '@/utils/photoArchive'
import { decodeZipStore } from '@/utils/zip'

const prefix = appConfig.storageKeyPrefix
const STUDENTS_KEY = `${prefix}:students`
const VIOLATION_KEY = `${prefix}:violations`
const PRESETS_KEY = `${prefix}:violationPresets`

let browser: FakeBrowser

/** 备份模块读盘用的读取器（与工具箱导出走同一个入口形状） */
const read = (key: string): string | null => browser.localStorage.getItem(key)

beforeEach(() => {
  browser = installFakeBrowser()
})

/** 一条盘上记录的原文（备份只认数组，条目内部字段由各 store 的 normalize 把关） */
function rawRecord(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    studentId: 's1',
    studentName: '安琪',
    date: '2026-11-03',
    timeSlotKind: 'forenoon',
    behaviorLabel: '迟到',
    severity: 'minor',
    createdAt: '2026-11-03T01:00:00.000Z',
    updatedAt: '2026-11-03T01:00:00.000Z',
    ...overrides,
  }
}

/* ==================== 登记 ==================== */

describe('备份模块登记', () => {
  it('违纪记录登记为「违纪记录 / 条」，键名与仓储一致', () => {
    const hit = BACKUP_MODULES.find((module) => module.key === VIOLATIONS_KEY)
    expect(hit, '违纪记录没登记进 BACKUP_MODULES').toMatchObject({
      label: '违纪记录',
      unit: '条',
    })
    expect(VIOLATIONS_KEY).toBe(VIOLATION_KEY)
  })

  it('违纪自定义预设登记为「违纪自定义事件 / 个」，键名与仓储一致', () => {
    const hit = BACKUP_MODULES.find((module) => module.key === VIOLATION_PRESETS_KEY)
    expect(hit, '违纪自定义预设没登记进 BACKUP_MODULES').toMatchObject({
      label: '违纪自定义事件',
      unit: '个',
    })
    expect(VIOLATION_PRESETS_KEY).toBe(PRESETS_KEY)
  })

  it('备份 schema 版本保持 1（本阶段不引入二进制 / 不改格式）', () => {
    expect(BACKUP_SCHEMA_VERSION).toBe(1)
  })
})

/* ==================== 导出 ==================== */

describe('导出：违纪键随备份一起导出', () => {
  it('盘上有违纪记录时，备份 data 里出现该键且条数一致', () => {
    browser.localStorage.seed(
      VIOLATION_KEY,
      JSON.stringify([rawRecord('v1'), rawRecord('v2', { behaviorLabel: '旷课' })]),
    )
    const { backup, broken } = createBackup(read, new Date('2026-11-13T10:00:00.000Z'))
    expect(broken).toEqual([])
    expect(backup.schemaVersion).toBe(BACKUP_SCHEMA_VERSION)
    expect(backup.kind).toBe(BACKUP_KIND)
    expect(backup.data[VIOLATION_KEY]).toHaveLength(2)
    expect(backup.data[VIOLATION_KEY]).toEqual([
      expect.objectContaining({ id: 'v1' }),
      expect.objectContaining({ id: 'v2', behaviorLabel: '旷课' }),
    ])
  })

  it('盘上没有违纪键时，备份里不出现该键（不补空数组）', () => {
    const { backup } = createBackup(read, new Date('2026-11-13T10:00:00.000Z'))
    expect(VIOLATION_KEY in backup.data).toBe(false)
  })

  it('不影响其它已登记模块（学生档案仍在同一份备份里）', () => {
    browser.localStorage.seed(STUDENTS_KEY, JSON.stringify([{ id: 's1', name: '安琪' }]))
    browser.localStorage.seed(VIOLATION_KEY, JSON.stringify([rawRecord('v1')]))
    const { backup } = createBackup(read, new Date('2026-11-13T10:00:00.000Z'))
    expect(backup.data[STUDENTS_KEY]).toHaveLength(1)
    expect(backup.data[VIOLATION_KEY]).toHaveLength(1)
  })
})

/* ==================== 解析 / 导入 ==================== */

describe('导入：往返与按 id 合并', () => {
  it('导出 → 解析回来，违纪块原样还在', () => {
    browser.localStorage.seed(VIOLATION_KEY, JSON.stringify([rawRecord('v1')]))
    const { backup } = createBackup(read, new Date('2026-11-13T10:00:00.000Z'))
    const parsed = parseBackup(JSON.stringify(backup))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.backup.data[VIOLATION_KEY]).toEqual(backup.data[VIOLATION_KEY])
    expect(parsed.unknownModules).toEqual([])
  })

  it('导入空库：违纪事件全部写回', () => {
    browser.localStorage.seed(
      VIOLATION_KEY,
      JSON.stringify([rawRecord('v1'), rawRecord('v2', { behaviorLabel: '打架' })]),
    )
    const { backup } = createBackup(read, new Date('2026-11-13T10:00:00.000Z'))
    const parsed = parseBackup(JSON.stringify(backup))
    if (!parsed.ok) throw new Error(parsed.error)

    const plan = planMerge({}, parsed.backup)
    const stat = plan.stats.find((item) => item.label === '违纪记录')
    expect(stat).toMatchObject({ added: 2, replaced: 0, kept: 0 })
    const written = JSON.parse(plan.writes[VIOLATION_KEY]!) as Record<string, unknown>[]
    expect(written.map((item) => item.id)).toEqual(['v1', 'v2'])
  })

  it('导入有数据的库：按 id 覆盖同一事件、追加新事件、保留本机独有事件', () => {
    browser.localStorage.seed(
      VIOLATION_KEY,
      JSON.stringify([
        rawRecord('both', { behaviorLabel: '迟到' }),
        rawRecord('backup-only'),
        rawRecord('new'),
      ]),
    )
    const { backup } = createBackup(read, new Date('2026-11-13T10:00:00.000Z'))
    const parsed = parseBackup(JSON.stringify(backup))
    if (!parsed.ok) throw new Error(parsed.error)

    // 本机现状：事件 both 的老师备注是本机版本，另有本机独有的 local-only
    const current = {
      [VIOLATION_KEY]: [
        rawRecord('both', { behaviorLabel: '迟到', teacherNote: '本机备注' }),
        rawRecord('local-only'),
      ],
    }
    const plan = planMerge(current, parsed.backup)
    const merged = JSON.parse(plan.writes[VIOLATION_KEY]!) as Record<string, unknown>[]
    expect(merged.map((item) => item.id)).toEqual(['both', 'local-only', 'backup-only', 'new'])
    // 「备份为准」：同一 id 用备份那条（覆盖本机备注）
    expect(merged[0]?.teacherNote).toBeUndefined()
    expect(plan.stats.find((item) => item.label === '违纪记录')).toMatchObject({
      added: 2,
      replaced: 1,
      kept: 1,
    })
  })
})

/* ==================== 兼容 ==================== */

describe('旧备份 / 新版本兼容', () => {
  it('旧备份（没有违纪键）导入：正常通过，且不写违纪键', () => {
    const legacy = {
      app: appConfig.name,
      kind: BACKUP_KIND,
      schemaVersion: 1,
      appVersion: '3.7.8',
      exportedAt: '2026-11-01T00:00:00.000Z',
      data: { [STUDENTS_KEY]: [{ id: 's1', name: '安琪' }] },
    }
    const parsed = parseBackup(JSON.stringify(legacy))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const plan = planMerge({}, parsed.backup)
    expect(VIOLATION_KEY in plan.writes).toBe(false)
    expect(plan.stats.some((item) => item.label === '违纪记录')).toBe(false)
  })

  it('更高 schemaVersion 的备份仍按既有规则拒绝（不会静默丢数据）', () => {
    const future = {
      app: appConfig.name,
      kind: BACKUP_KIND,
      schemaVersion: BACKUP_SCHEMA_VERSION + 1,
      appVersion: '9.9.9',
      exportedAt: '2026-11-01T00:00:00.000Z',
      data: {},
    }
    const parsed = parseBackup(JSON.stringify(future))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('升级')
  })

  it('违纪块不是数组时整份备份被拒绝（宁可不认，不可丢）', () => {
    const broken = {
      app: appConfig.name,
      kind: BACKUP_KIND,
      schemaVersion: 1,
      appVersion: '3.8.0',
      exportedAt: '2026-11-01T00:00:00.000Z',
      data: { [VIOLATION_KEY]: { not: 'an array' } },
    }
    const parsed = parseBackup(JSON.stringify(broken))
    expect(parsed.ok).toBe(false)
  })
})

/* ==================== 自定义预设 ==================== */

function rawPreset(
  id: string,
  label: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    label,
    labelKey: label,
    defaultSeverity: 'moderate',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('自定义预设：导出 / 导入 / 旧备份 / ZIP', () => {
  it('盘上有自定义预设时：JSON 备份包含该块，导出→解析原样保留', () => {
    browser.localStorage.seed(
      PRESETS_KEY,
      JSON.stringify([
        rawPreset('custom-a', '课堂上擅自离开座位'),
        rawPreset('custom-b', '在走廊追逐', { defaultSeverity: 'minor' }),
      ]),
    )
    const { backup } = createBackup(read, new Date('2026-11-14T00:00:00.000Z'))
    expect(backup.data[PRESETS_KEY]).toHaveLength(2)

    const parsed = parseBackup(JSON.stringify(backup))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.backup.data[PRESETS_KEY]).toHaveLength(2)
    expect(parsed.unknownModules).toEqual([])
  })

  it('导入合并：按 id 覆盖、追加新预设、保留本机独有预设', () => {
    browser.localStorage.seed(
      PRESETS_KEY,
      JSON.stringify([
        rawPreset('both', '同一事件', { defaultSeverity: 'minor' }),
        rawPreset('backup-only', '仅备份有'),
      ]),
    )
    const { backup } = createBackup(read, new Date('2026-11-14T00:00:00.000Z'))
    const parsed = parseBackup(JSON.stringify(backup))
    if (!parsed.ok) throw new Error(parsed.error)

    const plan = planMerge(
      {
        [PRESETS_KEY]: [
          rawPreset('both', '同一事件', { defaultSeverity: 'severe' }),
          rawPreset('local-only', '仅本机有'),
        ],
      },
      parsed.backup,
    )
    const merged = JSON.parse(plan.writes[PRESETS_KEY]!) as Record<string, unknown>[]
    expect(merged.map((item) => item.id)).toEqual(['both', 'local-only', 'backup-only'])
    // 备份为准
    expect(merged[0]).toMatchObject({ id: 'both', defaultSeverity: 'minor' })
  })

  it('旧 schema 1 备份缺少自定义预设块：正常导入，按空数组处理（不写该键）', () => {
    const legacy = {
      app: appConfig.name,
      kind: BACKUP_KIND,
      schemaVersion: 1,
      appVersion: '3.8.0',
      exportedAt: '2026-11-01T00:00:00.000Z',
      data: { [STUDENTS_KEY]: [{ id: 's1', name: '安琪' }] },
    }
    const parsed = parseBackup(JSON.stringify(legacy))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const plan = planMerge({}, parsed.backup)
    expect(PRESETS_KEY in plan.writes).toBe(false)
  })

  it('照片 ZIP 完整备份自动包含自定义预设块，且可被解析恢复', async () => {
    browser.localStorage.seed(VIOLATIONS_KEY, JSON.stringify([rawRecord('v1')]))
    browser.localStorage.seed(
      PRESETS_KEY,
      JSON.stringify([rawPreset('custom-zip', 'ZIP 里的事件')]),
    )
    const { backup } = createBackup(read, new Date('2026-11-14T00:00:00.000Z'))
    const archive = await buildPhotoArchive({
      backupJson: JSON.stringify(backup),
      appVersion: '3.8.1',
      exportedAt: '2026-11-14T00:00:00.000Z',
      photos: [],
      resolveBinary: async () => ({ ok: false, status: 'missing-local', reason: '没有照片' }),
    })

    // ZIP 内的 backup.json 与 JSON 备份同构，自然带着新块
    const entries = decodeZipStore(archive.zipBytes)
    const backupText = new TextDecoder().decode(
      entries.find((entry) => entry.name === PHOTO_ARCHIVE_BACKUP_ENTRY)!.data,
    )
    expect(backupText).toContain(PRESETS_KEY)
    expect(backupText).toContain('ZIP 里的事件')

    // 解析 ZIP → 合并计划里能看到自定义预设块
    const parsedArchive = parsePhotoArchive(archive.zipBytes)
    expect(parsedArchive.ok).toBe(true)
    if (!parsedArchive.ok) return
    const plan = planMerge({}, parsedArchive.contents.backup)
    expect(plan.writes[PRESETS_KEY]).toBeDefined()
    expect(JSON.parse(plan.writes[PRESETS_KEY]!)).toHaveLength(1)
  })

  it('未知 severity 的违纪原始记录仍随 JSON / ZIP 备份原样带出', async () => {
    browser.localStorage.seed(
      VIOLATIONS_KEY,
      JSON.stringify([rawRecord('future', { severity: 'critical', behaviorLabel: '未来事件' })]),
    )
    const { backup } = createBackup(read, new Date('2026-11-14T00:00:00.000Z'))
    expect((backup.data[VIOLATION_KEY] as Record<string, unknown>[])[0]).toMatchObject({
      id: 'future',
      severity: 'critical',
    })

    const archive = await buildPhotoArchive({
      backupJson: JSON.stringify(backup),
      appVersion: '3.8.1',
      exportedAt: '2026-11-14T00:00:00.000Z',
      photos: [],
      resolveBinary: async () => ({ ok: false, status: 'missing-local', reason: '没有照片' }),
    })
    const parsedArchive = parsePhotoArchive(archive.zipBytes)
    expect(parsedArchive.ok).toBe(true)
    if (!parsedArchive.ok) return
    const events = parsedArchive.contents.backup.data[VIOLATION_KEY] as Record<string, unknown>[]
    expect(events[0]).toMatchObject({ id: 'future', severity: 'critical' })
  })
})
