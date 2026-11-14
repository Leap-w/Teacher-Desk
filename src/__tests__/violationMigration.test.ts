/**
 * 违纪历史数据兼容 / 迁移自检（v3.8.1 · Phase 3）。
 *
 * 本文件只钉「取消分类不能丢历史」这一类事实：
 * - 旧记录带 category / 缺 category 都能读；
 * - 旧 `other-custom` 记录保留原始 behaviorLabel 与 severity；
 * - 编辑写回时 category 收敛消失，但学生关联 / 时间 / 教师备注 / 家长处理意见 / severity 不变；
 * - 未知 severity 原始记录继续隔离、原样保留；
 * - 历史 severity 不按新预设重算。
 */
import { nextTick } from 'vue'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { installFakeBrowser, type FakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import { useStudentStore } from '@/stores/student'
import { useViolationStore } from '@/stores/violation'
import {
  findViolationPresetById,
  isLegacyCustomPresetEvent,
  isQuarantinedViolationRecord,
  presetKindOfEvent,
} from '@/utils/violation'

const prefix = appConfig.storageKeyPrefix
const STUDENTS_KEY = `${prefix}:students`
const VIOLATIONS_KEY = `${prefix}:violations`

let browser: FakeBrowser

beforeEach(() => {
  browser = installFakeBrowser()
  setActivePinia(createPinia())
  browser.localStorage.seed(
    STUDENTS_KEY,
    JSON.stringify([{ id: 's1', name: '安琪', studentNo: '', gender: 'female' }]),
  )
})

function seedViolations(records: Record<string, unknown>[]): void {
  browser.localStorage.seed(VIOLATIONS_KEY, JSON.stringify(records))
}

/** v3.8.0 的一条旧记录（带 category） */
function legacyRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'v-old',
    studentId: 's1',
    studentName: '安琪（旧快照）',
    date: '2026-11-03',
    timeSlotKind: 'forenoon',
    category: 'routine',
    presetId: 'other-custom',
    behaviorLabel: '课堂上擅自离开座位',
    severity: 'moderate',
    teacherNote: '已提醒',
    parentNote: '家长已知悉',
    createdAt: '2026-11-03T01:00:00.000Z',
    updatedAt: '2026-11-03T01:00:00.000Z',
    ...overrides,
  }
}

function storedRecords(): Record<string, unknown>[] {
  return JSON.parse(browser.localStorage.getItem(VIOLATIONS_KEY)!) as Record<string, unknown>[]
}

describe('旧 data category / other-custom 兼容', () => {
  it('旧 category 记录能读取；内存事件不再带 category', async () => {
    seedViolations([legacyRecord({ id: 'v-cat', category: 'hygiene' })])
    const store = useViolationStore()
    await nextTick()

    expect(store.events).toHaveLength(1)
    expect('category' in store.events[0]!).toBe(false)
    expect(store.events[0]?.behaviorLabel).toBe('课堂上擅自离开座位')
    expect(store.events[0]?.severity).toBe('moderate')
  })

  it('缺少 category 的合法记录也能读取（新数据不再要求分类）', () => {
    seedViolations([
      legacyRecord({
        id: 'v-no-cat',
        category: undefined,
        presetId: 'routine-late',
        behaviorLabel: '迟到',
        severity: 'minor',
      }),
    ])
    const store = useViolationStore()
    expect(store.events).toHaveLength(1)
    expect(store.events[0]?.id).toBe('v-no-cat')
    expect(store.events[0]?.severity).toBe('minor')
  })

  it('other-custom 历史记录：保留原始 behaviorLabel / severity / 备注 / 家长意见', async () => {
    seedViolations([legacyRecord()])
    const store = useViolationStore()
    await nextTick()
    const event = store.events[0]!

    expect(event.behaviorLabel).toBe('课堂上擅自离开座位')
    expect(event.behaviorLabel).not.toBe('其他自定义事件')
    expect(event.severity).toBe('moderate')
    expect(event.teacherNote).toBe('已提醒')
    expect(event.parentNote).toBe('家长已知悉')
    expect(event.studentId).toBe('s1')
    expect(event.date).toBe('2026-11-03')
    expect(isLegacyCustomPresetEvent(event)).toBe(true)
    expect(presetKindOfEvent(event)).toBe('custom')
  })

  it('历史 severity 优先：编辑其它字段/换预设关联都不按新系统映射重算', async () => {
    seedViolations([
      legacyRecord({
        id: 'v-history',
        presetId: 'routine-late',
        behaviorLabel: '迟到',
        severity: 'severe', // 历史事实：虽然系统预设默认 minor
      }),
    ])
    const store = useViolationStore()
    await nextTick()

    // 系统预设默认是 minor，但历史记录是 severe —— 读入不改
    expect(findViolationPresetById('routine-late')?.defaultSeverity).toBe('minor')
    expect(store.events[0]?.severity).toBe('severe')

    // 只改备注，不传 severity → 历史严重程度保持
    const updated = store.updateViolation('v-history', { teacherNote: '补充备注' })
    await nextTick()
    expect(updated?.severity).toBe('severe')
    expect(updated?.behaviorLabel).toBe('迟到')
  })

  it('编辑旧记录写回：category 收敛消失，事实字段完整保留', async () => {
    seedViolations([legacyRecord()])
    const store = useViolationStore()
    await nextTick()

    const updated = store.updateViolation('v-old', {
      presetId: 'custom-new-id',
      presetKind: 'custom',
      behaviorLabel: '课堂上擅自离开座位',
      severity: 'moderate',
      teacherNote: '已提醒（补充）',
      parentNote: '家长已回电',
    })
    expect(updated).toBeDefined()
    await nextTick()

    const [raw] = storedRecords()
    expect(raw).toBeDefined()
    // 写时收敛：新数据不再携带 category
    expect('category' in raw!).toBe(false)
    // 事实字段原样保留
    expect(raw).toMatchObject({
      id: 'v-old',
      studentId: 's1',
      studentName: '安琪',
      date: '2026-11-03',
      timeSlotKind: 'forenoon',
      behaviorLabel: '课堂上擅自离开座位',
      severity: 'moderate',
      teacherNote: '已提醒（补充）',
      parentNote: '家长已回电',
    })
    // 事件名称不会被替换成「其他自定义事件」
    expect(raw!.behaviorLabel).not.toBe('其他自定义事件')
  })

  it('未知 severity：继续隔离、不折算、写盘原样保留', async () => {
    seedViolations([
      legacyRecord({ id: 'future', severity: 'critical', behaviorLabel: '未来版本事件' }),
      legacyRecord({ id: 'normal' }),
    ])
    const store = useViolationStore()
    await nextTick()

    expect(store.events.map((event) => event.id)).toEqual(['normal'])
    expect(store.quarantinedCount).toBe(1)
    const quarantined = store.quarantinedRecords[0]!
    expect(quarantined.severity).toBe('critical')
    expect(quarantined.behaviorLabel).toBe('未来版本事件')

    // 任意一次正常编辑写盘：隔离记录原样带出（逐字段不变）
    store.updateViolation('normal', { teacherNote: '改一下' })
    await nextTick()
    const raw = storedRecords()
    const future = raw.find((item) => item.id === 'future')!
    expect(future).toMatchObject({
      id: 'future',
      severity: 'critical',
      behaviorLabel: '未来版本事件',
    })
    expect(isQuarantinedViolationRecord(future)).toBe(true)
  })

  it('旧预设已下线（unknown preset id）：事件不丢，按无预设历史文本处理', async () => {
    seedViolations([
      legacyRecord({
        id: 'v-gone-preset',
        presetId: 'removed-preset-id',
        behaviorLabel: '旧版本事件名',
        severity: 'minor',
      }),
    ])
    const store = useViolationStore()
    await nextTick()

    expect(store.events).toHaveLength(1)
    expect(store.events[0]?.presetId).toBe('removed-preset-id')
    expect(store.events[0]?.behaviorLabel).toBe('旧版本事件名')
    expect(presetKindOfEvent(store.events[0]!)).toBe('custom')
  })

  it('编辑历史记录时 studentId / 姓名快照随档案刷新，但历史事件不删除', async () => {
    seedViolations([legacyRecord()])
    const studentStore = useStudentStore()
    const store = useViolationStore()
    await nextTick()

    studentStore.updateStudent('s1', { name: '安琪（新）' })
    await nextTick()
    expect(store.events[0]?.studentName).toContain('安琪（新）')
    expect(store.events).toHaveLength(1)
  })
})
