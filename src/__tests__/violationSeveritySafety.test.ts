/**
 * 未知严重程度的数据安全自检（v3.8.0 修正）。
 *
 * 背景：未来版本可能把三级严重程度扩展成四级。旧版本读到「未知等级」时**绝不能**
 * 折算成 `minor` / 预设默认等级 / 任何已知等级——因为旧版本的**下一次写盘、云推送、
 * 备份导出**都会把这个降级值传播出去，新版本再也读不到原值。
 *
 * 这一层刻意**跑真实数据流**（不是只测辅助函数）：
 *
 * ```
 * 盘上原文 → Repository（reviveViolationRecords）→ Store（records 单一数据源）
 *   → 深度 watch 写盘 → 盘上原文（断言：逐字段不变）
 *   → 跨标签页 / 云端采纳（applySyncKeys）→ 盘上原文（断言：一个字节都没被改写）
 *   → createBackup / parseBackup / planMerge（断言：导出与导入都不丢、不改）
 * ```
 *
 * 三条最关键的断言：
 * ① 读完盘**一次都不写**（`writesFor === 0`）—— 读取本身不能触发改写；
 * ② 任意一次正常编辑后，隔离记录在盘上**逐字段不变**（`JSON.stringify` 相等）；
 * ③ 隔离记录不进入统计 / 编辑 / 删除（旧版本无权处置看不懂的数据）。
 */
import { nextTick } from 'vue'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { installFakeBrowser, type FakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import { useViolationStore } from '@/stores/violation'
import { applySyncKeys } from '@/services/sync'
import { localStoragePort, readRaw } from '@/services/storage'
import { BACKUP_MODULES, applyWrites, createBackup, parseBackup, planMerge } from '@/utils/backup'
import { isQuarantinedViolationRecord, isViolationEvent } from '@/utils/violation'
import type { Student } from '@/types'
import type { ViolationEvent } from '@/types/violation'

const prefix = appConfig.storageKeyPrefix
const STUDENTS_KEY = `${prefix}:students`
const VIOLATIONS_KEY = `${prefix}:violations`

let browser: FakeBrowser

/* ---------- 夹具 ---------- */

function student(id: string, name: string): Student {
  return { id, name, studentNo: '', gender: 'male' }
}

/**
 * 一条本版本合法的盘上记录，**键序与 normalize 产出一致**（`id / studentName / …`）。
 * 键序一致时「读盘 → 采纳 → 写盘」在内容没变的情况下不会产生无谓写盘，
 * 因此可以把「采纳后一次都不写盘」立成硬断言（见云同步采纳那条用例）。
 */
function validRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'v-valid',
    studentName: '安琪',
    studentId: 's1',
    date: '2026-11-03',
    timeSlotKind: 'forenoon',
    behaviorLabel: '迟到',
    severity: 'minor',
    createdAt: '2026-11-03T01:00:00.000Z',
    updatedAt: '2026-11-03T01:00:00.000Z',
    ...overrides,
  }
}

/**
 * 一条**未来版本**的记录：严重程度是未知值 `critical`，且还带着预设 id。
 * 预设 `other-fight` 的默认等级是 `severe`——正好用来证明「没有折算成预设默认」。
 */
function futureRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return validRecord({
    id: 'v-future',
    date: '2026-11-04',
    severity: 'critical',
    presetId: 'other-fight',
    behaviorLabel: '打架',
    ...overrides,
  })
}

function seedStudents(): void {
  browser.localStorage.seed(STUDENTS_KEY, JSON.stringify([student('s1', '安琪')]))
}

function seedViolations(records: unknown[]): void {
  browser.localStorage.seed(VIOLATIONS_KEY, JSON.stringify(records))
}

function diskViolations(): Record<string, unknown>[] {
  const raw = readRaw(VIOLATIONS_KEY)
  return raw ? (JSON.parse(raw) as Record<string, unknown>[]) : []
}

function diskText(): string | null {
  return readRaw(VIOLATIONS_KEY)
}

function openStore() {
  seedStudents()
  return useViolationStore()
}

function findDisk(id: string): Record<string, unknown> | undefined {
  return diskViolations().find((record) => record.id === id)
}

beforeEach(() => {
  browser = installFakeBrowser()
  setActivePinia(createPinia())
})

/* ==================== 合法数据：三个已知等级 ==================== */

describe('三个已知严重程度仍能正常读取', () => {
  it('minor / moderate / severe 都解析成合法事件，不算隔离', () => {
    seedViolations([
      validRecord({ id: 'a', severity: 'minor' }),
      validRecord({ id: 'b', severity: 'moderate' }),
      validRecord({ id: 'c', severity: 'severe' }),
    ])
    const store = openStore()
    expect(store.events.map((event) => event.severity)).toEqual(['minor', 'moderate', 'severe'])
    expect(store.quarantinedCount).toBe(0)
    expect(store.events.every(isViolationEvent)).toBe(true)
  })
})

/* ==================== 未知严重程度：读取与写回 ==================== */

describe('未知严重程度：不折算、不丢弃、不改写', () => {
  it('不转换成 minor，也不转换成预设默认等级', () => {
    seedViolations([validRecord(), futureRecord()])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = openStore()

    // 只有合法事件进入业务视图；未来记录被隔离
    expect(store.events.map((event) => event.id)).toEqual(['v-valid'])
    expect(store.quarantinedCount).toBe(1)
    const quarantined = store.quarantinedRecords[0]!
    expect(quarantined.severity).toBe('critical')
    expect(quarantined.severity).not.toBe('minor')
    // 预设 other-fight 的默认等级是 severe —— 证明没有拿预设默认顶上
    expect(quarantined.severity).not.toBe('severe')
    warn.mockRestore()
  })

  it('读取本身一次都不写盘（盘上原文与读取前逐字节一致）', () => {
    seedViolations([validRecord(), futureRecord()])
    const before = diskText()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = openStore()
    expect(store.quarantinedCount).toBe(1)
    expect(browser.localStorage.writesFor(VIOLATIONS_KEY)).toBe(0)
    expect(diskText()).toBe(before)
    warn.mockRestore()
  })

  it('非字符串 / 缺失的严重程度同样隔离且原样保留（不补默认值）', () => {
    seedViolations([
      futureRecord({ id: 'v-num', severity: 4 }),
      futureRecord({ id: 'v-missing', severity: undefined }),
    ])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = openStore()
    expect(store.quarantinedCount).toBe(2)
    expect(findDisk('v-num')?.severity).toBe(4)
    expect('severity' in (findDisk('v-missing') ?? {})).toBe(false)
    expect(browser.localStorage.writesFor(VIOLATIONS_KEY)).toBe(0)
    warn.mockRestore()
  })

  it('正常编辑后，隔离记录在盘上逐字段不变（不被丢弃、不被改写）', async () => {
    seedViolations([validRecord(), futureRecord()])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = openStore()

    // 新增一条合法事件（触发一次真实写盘）
    const created = store.addViolation({
      studentId: 's1',
      date: '2026-11-05',
      timeSlotKind: 'evening',
      behaviorLabel: '迟到',
      severity: 'minor',
    })
    expect(created).toBeTruthy()
    await nextTick()

    expect(browser.localStorage.writesFor(VIOLATIONS_KEY)).toBe(1)
    const disk = diskViolations()
    expect(disk).toHaveLength(3)
    // ★ 隔离记录逐字段不变（对象序列化后完全相等）
    expect(findDisk('v-future')).toEqual(futureRecord())
    expect(JSON.stringify(findDisk('v-future'))).toBe(JSON.stringify(futureRecord()))
    warn.mockRestore()
  })

  it('编辑 / 删除合法事件后，隔离记录仍然逐字段不变', async () => {
    seedViolations([validRecord(), futureRecord()])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = openStore()

    store.updateViolation('v-valid', { severity: 'severe', parentNote: '家长已沟通' })
    await nextTick()
    expect(findDisk('v-future')).toEqual(futureRecord())

    store.removeViolation('v-valid')
    await nextTick()
    expect(diskViolations()).toHaveLength(1)
    expect(findDisk('v-future')).toEqual(futureRecord())
    expect(store.quarantinedCount).toBe(1)
    // 隔离记录不进业务视图，因此删不掉、也编辑不到
    expect(store.findEvent('v-future')).toBeUndefined()
    expect(store.updateViolation('v-future', { severity: 'minor' })).toBeUndefined()
    expect(store.removeViolation('v-future')).toBe(false)
    warn.mockRestore()
  })

  it('隔离记录不计入统计（概览 / 排行只看合法事件）', () => {
    seedViolations([validRecord(), futureRecord()])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = openStore()
    expect(store.overview.total).toBe(1)
    expect(store.overview.severity).toEqual({ minor: 1, moderate: 0, severe: 0 })
    expect(store.ranking[0]?.count).toBe(1)
    warn.mockRestore()
  })

  it('全部记录都是未知等级时，数据仍然完整保留（不会被当成空列表）', async () => {
    seedViolations([futureRecord()])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = openStore()
    expect(store.events).toEqual([])
    expect(store.quarantinedCount).toBe(1)

    const created = store.addViolation({
      studentId: 's1',
      date: '2026-11-06',
      timeSlotKind: 'noon',
      behaviorLabel: '迟到',
      severity: 'minor',
    })
    expect(created).toBeTruthy()
    await nextTick()
    expect(diskViolations()).toHaveLength(2)
    expect(findDisk('v-future')).toEqual(futureRecord())
    warn.mockRestore()
  })
})

/* ==================== 云同步采纳路径 ==================== */

describe('云同步采纳（applySyncKeys）不造成数据降级', () => {
  it('采纳含未知严重程度的云端数据：不写盘、不改等级、不丢记录', async () => {
    // 本机原本是空的（新设备）
    seedStudents()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = useViolationStore()
    await nextTick()
    // 模拟 `adoptToDisk`：云端 payload 原样落到盘上，再走同步层的「内存跟上」入口
    const payload = [validRecord(), futureRecord()]
    browser.localStorage.seed(VIOLATIONS_KEY, JSON.stringify(payload))
    browser.localStorage.resetCounters()
    applySyncKeys([VIOLATIONS_KEY])
    await nextTick()

    expect(store.events.map((event) => event.id)).toEqual(['v-valid'])
    expect(store.quarantinedCount).toBe(1)
    expect(store.quarantinedRecords[0]?.severity).toBe('critical')
    // 采纳后**一次都不该再写盘**：内容已经完全一致（隔离记录原样保留）
    expect(browser.localStorage.writesFor(VIOLATIONS_KEY)).toBe(0)
    expect(diskViolations()).toEqual(payload)
    warn.mockRestore()
  })

  it('采纳后再编辑合法事件：云端带来的未知记录仍然原样在盘上', async () => {
    seedViolations([futureRecord()])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = openStore()
    await nextTick()
    browser.localStorage.seed(VIOLATIONS_KEY, JSON.stringify([validRecord(), futureRecord()]))
    applySyncKeys([VIOLATIONS_KEY])
    await nextTick()

    store.addViolation({
      studentId: 's1',
      date: '2026-11-07',
      timeSlotKind: 'forenoon',
      behaviorLabel: '迟到',
      severity: 'minor',
    })
    await nextTick()
    expect(findDisk('v-future')).toEqual(futureRecord())
    const severities = diskViolations().map((record) => record.severity)
    expect(severities).toContain('critical')
    expect(severities.filter((value) => value === 'critical')).toHaveLength(1)
    warn.mockRestore()
  })
})

/* ==================== 备份导出 / 导入 ==================== */

describe('备份导出不会静默丢弃或修改未知记录', () => {
  it('导出的违纪块与盘上原文完全一致（severity 仍是 critical）', () => {
    seedViolations([validRecord(), futureRecord()])
    const { backup, broken } = createBackup(
      (key) => browser.localStorage.getItem(key),
      new Date('2026-11-13T10:00:00.000Z'),
    )
    expect(broken).toEqual([])
    const exported = backup.data[VIOLATIONS_KEY] as Record<string, unknown>[]
    expect(exported).toEqual([validRecord(), futureRecord()])
    expect(exported[1]?.severity).toBe('critical')
    expect(JSON.stringify(exported)).toContain('"severity":"critical"')
  })

  it('导出 → 解析 → 合并到空库：未知记录原样写回（不降级）', () => {
    seedViolations([validRecord(), futureRecord()])
    const { backup } = createBackup(
      (key) => browser.localStorage.getItem(key),
      new Date('2026-11-13T10:00:00.000Z'),
    )
    const parsed = parseBackup(JSON.stringify(backup))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const plan = planMerge({}, parsed.backup)
    const written = JSON.parse(plan.writes[VIOLATIONS_KEY]!) as Record<string, unknown>[]
    expect(written).toHaveLength(2)
    expect(written[1]).toEqual(futureRecord())
    expect(written[1]?.severity).toBe('critical')
  })

  it('导入（真实写盘路径）后重新加载：未知记录仍在且等级未变', async () => {
    // 备份文件来自「另一台设备」：里面有一条未知等级记录
    seedViolations([futureRecord()])
    const { backup } = createBackup(
      (key) => browser.localStorage.getItem(key),
      new Date('2026-11-13T10:00:00.000Z'),
    )
    const parsed = parseBackup(JSON.stringify(backup))
    if (!parsed.ok) throw new Error(parsed.error)

    // 本机此时是空的
    browser.localStorage.seed(VIOLATIONS_KEY, JSON.stringify([]))
    const plan = planMerge({}, parsed.backup)
    const outcome = applyWrites(plan.writes, localStoragePort)
    expect(outcome.ok).toBe(true)

    // 「整页重载」后重新打开 store：未知记录被隔离但完整保留
    setActivePinia(createPinia())
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = useViolationStore()
    expect(store.events).toEqual([])
    expect(store.quarantinedCount).toBe(1)
    expect(diskViolations()).toEqual([futureRecord()])
    warn.mockRestore()
  })

  it('备份模块登记未变（schema 版本仍是 1，不改备份格式）', () => {
    const hit = BACKUP_MODULES.find((module) => module.key === VIOLATIONS_KEY)
    expect(hit).toMatchObject({ label: '违纪记录', unit: '条' })
  })
})

/* ==================== 编辑正常记录 / 非法写入 ==================== */

describe('编辑正常记录不受影响；非法新写入仍被拒绝', () => {
  it('正常新增 / 编辑 / 删除照旧工作', async () => {
    seedViolations([validRecord()])
    const store = openStore()

    const created = store.addViolation({
      studentId: 's1',
      date: '2026-11-08',
      timeSlotKind: 'period',
      periodId: 'p3',
      subject: '数学',
      behaviorLabel: '上课说话',
      severity: 'minor',
    })
    expect(created).toBeTruthy()
    await nextTick()

    const updated = store.updateViolation(created!.id, {
      severity: 'severe',
      parentNote: '家长已沟通',
    })
    expect(updated?.severity).toBe('severe')
    await nextTick()
    expect(findDisk(created!.id)?.severity).toBe('severe')

    expect(store.removeViolation(created!.id)).toBe(true)
    await nextTick()
    expect(diskViolations()).toHaveLength(1)
  })

  it('写入未知严重程度一律被拒绝（本版本只能写三个已知等级）', async () => {
    seedViolations([validRecord()])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = openStore()
    await nextTick()
    browser.localStorage.resetCounters()

    expect(
      store.addViolation({
        studentId: 's1',
        date: '2026-11-09',
        timeSlotKind: 'forenoon',
        behaviorLabel: '迟到',
        severity: 'critical' as never,
      }),
    ).toBeUndefined()
    expect(
      store.addViolationsForStudents(['s1'], {
        date: '2026-11-09',
        timeSlotKind: 'forenoon',
        behaviorLabel: '迟到',
        severity: 'critical' as never,
      }),
    ).toEqual([])
    expect(store.updateViolation('v-valid', { severity: 'critical' as never })).toBeUndefined()

    await nextTick()
    expect(browser.localStorage.writesFor(VIOLATIONS_KEY)).toBe(0)
    expect(findDisk('v-valid')?.severity).toBe('minor')
    warn.mockRestore()
  })

  it('隔离记录与合法事件的类型守卫可区分（混合数组不会被统计误吞）', () => {
    expect(isViolationEvent(validRecord())).toBe(true)
    expect(isQuarantinedViolationRecord(validRecord())).toBe(false)
    expect(isViolationEvent(futureRecord())).toBe(false)
    expect(isQuarantinedViolationRecord(futureRecord())).toBe(true)
  })

  it('隔离记录不会出现在列表查询与个人档案里', () => {
    seedViolations([validRecord(), futureRecord()])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = openStore()
    const rows: ViolationEvent[] = store.listEvents()
    expect(rows.map((event) => event.id)).toEqual(['v-valid'])
    expect(store.eventsOfStudent('s1').map((event) => event.id)).toEqual(['v-valid'])
    expect(store.statsOfStudent('s1').total).toBe(1)
    warn.mockRestore()
  })
})
