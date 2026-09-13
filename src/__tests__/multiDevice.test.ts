/**
 * 多设备验证 · 冲突 · 重试与网络恢复（Phase Cloud-4 §三 / §四 / §八 / §九）。
 *
 * **两台设备怎么模拟**：一台设备 = 一份 localStorage + 一份模块图（内存状态）。
 * 通过「快照 A 的存储 → 清空 → 写入 B 的存储 → `vi.resetModules()` 重建模块图」切换设备；
 * 云端（内存假云端）跨切换存活——这正是两台真机共用同一个云端账号的形状。
 *
 * 覆盖八个模块的键（学生 / 座位 / 请假 / 值日 / 周末 / 课表 / 工作清单 / 我的），
 * 每个模块至少验一次「A 新增 → B 同步看到」。
 */
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installFakeBrowser, type FakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import { readRaw } from '@/services/storage'

const cloud = vi.hoisted(() => ({
  configured: true,
  signedIn: true,
  docs: new Map<string, { key: string; payload: unknown[]; updatedAt: number }>(),
  pullError: null as Error | null,
  pushError: null as Error | null,
  pushes: [] as { key: string; payload: unknown[]; updatedAt: number }[],
}))

vi.mock('@/services/cloudbase', () => ({
  isCloudConfigured: () => cloud.configured,
  currentUser: async () => (cloud.signedIn ? { uid: 'u-1', username: 'teacher' } : null),
  createCloudBaseRemote: () => ({
    pull: async () => {
      if (cloud.pullError) throw cloud.pullError
      return [...cloud.docs.values()].map((doc) => ({ ...doc }))
    },
    push: async (doc: { key: string; payload: unknown[]; updatedAt: number }) => {
      if (cloud.pushError) throw cloud.pushError
      cloud.pushes.push({ ...doc })
      cloud.docs.set(doc.key, { ...doc })
    },
    remove: async (key: string) => {
      cloud.docs.delete(key)
    },
  }),
  signInWithUsername: async () => {
    cloud.signedIn = true
  },
  signInWithEmail: async () => {
    cloud.signedIn = true
  },
  signOutCloud: async () => {
    cloud.signedIn = false
  },
}))

const prefix = appConfig.storageKeyPrefix
const KEYS = {
  students: `${prefix}:students`,
  seats: `${prefix}:seatPlans`,
  leave: `${prefix}:leaves`,
  duty: `${prefix}:duty`,
  weekend: `${prefix}:weekendReturns`,
  schedule: `${prefix}:timetable`,
  tasks: `${prefix}:works`,
  profile: `${prefix}:profile`,
} as const

const T0 = 1_950_000_000_000
let browser: FakeBrowser

/* ---------- 设备模拟 ---------- */

type DeviceDump = Record<string, string>

function dumpStorage(): DeviceDump {
  const dump: DeviceDump = {}
  for (let index = 0; index < browser.localStorage.length; index += 1) {
    const key = browser.localStorage.key(index)
    if (key === null) continue
    const value = browser.localStorage.getItem(key)
    if (value !== null) dump[key] = value
  }
  return dump
}

/** 切到「另一台设备」：换一份盘上内容 + 重建模块图（内存态清空，等价于刷新/另一台机器） */
async function switchDevice(dump: DeviceDump): Promise<void> {
  vi.resetModules()
  const pinia = await import('pinia')
  pinia.setActivePinia(pinia.createPinia())
  browser.localStorage.clear()
  for (const [key, value] of Object.entries(dump)) browser.localStorage.setItem(key, value)
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 25; index += 1) await Promise.resolve()
}

/** 某台设备上跑一轮同步：注册这些键（与 store 同一条路径）→ 整轮对账 */
async function syncThisDevice(contents: Record<string, unknown[]>): Promise<void> {
  const sync = await import('@/services/sync')
  for (const [key, value] of Object.entries(contents)) {
    sync.syncPersisted(key, ref(value), (raw) => raw)
  }
  const { createCloudTransport } = await import('@/sync/CloudTransport')
  await createCloudTransport().sync()
  await flushMicrotasks()
}

function diskOf(key: string): unknown[] {
  const raw = readRaw(key)
  return raw === null ? [] : (JSON.parse(raw) as unknown[])
}

beforeEach(async () => {
  browser = installFakeBrowser()
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  vi.resetModules()
  const pinia = await import('pinia')
  pinia.setActivePinia(pinia.createPinia())
  cloud.configured = true
  cloud.signedIn = true
  cloud.docs.clear()
  cloud.pullError = null
  cloud.pushError = null
  cloud.pushes = []
})

afterEach(() => {
  vi.useRealTimers()
})

/* ==================== ① 双设备同步（八个模块） ==================== */

describe('双设备同步 · 八个模块「A 新增 → B 看到」', () => {
  const moduleFixtures: { name: string; key: string; a: unknown[]; b: unknown[] }[] = [
    { name: '学生档案', key: KEYS.students, a: [{ id: 's-1', name: '新增学生' }], b: [] },
    { name: '座位管理', key: KEYS.seats, a: [{ id: 'p-1', name: '开学初' }], b: [] },
    { name: '请假', key: KEYS.leave, a: [{ id: 'l-1', studentId: 's-1' }], b: [] },
    { name: '值日', key: KEYS.duty, a: [{ id: 'g-1', name: '第 1 组' }], b: [] },
    { name: '周末管理', key: KEYS.weekend, a: [{ id: 'w-1', studentId: 's-1' }], b: [] },
    { name: '课程表', key: KEYS.schedule, a: [{ id: 'c-1', subject: '数学' }], b: [] },
    { name: '工作清单', key: KEYS.tasks, a: [{ id: 't-1', title: '批改作业' }], b: [] },
    { name: '我的（资料）', key: KEYS.profile, a: [{ nickname: 'Gile' }], b: [] },
  ]

  moduleFixtures.forEach((fixture, index) => {
    it(`${index + 1}. ${fixture.name}：A 新增 → 同步 → B 看到同一份`, async () => {
      // 设备 A：本机有数据（写盘 + 注册）
      browser.localStorage.seed(fixture.key, JSON.stringify(fixture.a))
      const deviceA = dumpStorage()
      await syncThisDevice({ [fixture.key]: fixture.a })
      expect(cloud.docs.get(fixture.key)?.payload).toEqual(fixture.a)
      void deviceA

      // 设备 B：干净的盘（同一账号）
      await switchDevice({})
      await syncThisDevice({ [fixture.key]: fixture.b })
      expect(diskOf(fixture.key)).toEqual(fixture.a)
    })
  })

  it('9. B 修改后 A 同步：新值覆盖旧值（最后写入胜出）', async () => {
    const original = [{ id: 's-1', name: '原值' }]
    browser.localStorage.seed(KEYS.students, JSON.stringify(original))
    await syncThisDevice({ [KEYS.students]: original })
    const dumpA = dumpStorage() // 设备 A 的完整盘（含对齐记账）

    // 设备 B：同一账号的第二台设备，先对齐，再改成新值（时间更晚）
    await switchDevice({})
    await syncThisDevice({ [KEYS.students]: [] })
    const dumpB = dumpStorage()
    vi.setSystemTime(T0 + 60_000)
    const changed = [{ id: 's-1', name: 'B 改过的值' }]
    browser.localStorage.seed(KEYS.students, JSON.stringify(changed))
    await syncThisDevice({ [KEYS.students]: changed })
    expect(cloud.docs.get(KEYS.students)?.payload).toEqual(changed)
    void dumpB

    // A 带着自己的盘回来：本机没改 → 采纳云端
    await switchDevice(dumpA)
    await syncThisDevice({ [KEYS.students]: original })
    expect(diskOf(KEYS.students)).toEqual(changed)
  })

  it('10. B 清空后 A 同步：空列表同样会被采纳（不是「删除不传播」的静默）', async () => {
    const initial = [{ id: 't-1' }]
    browser.localStorage.seed(KEYS.tasks, JSON.stringify(initial))
    await syncThisDevice({ [KEYS.tasks]: initial })
    const dumpA = dumpStorage()

    // B 对齐后清空（更晚）
    await switchDevice({})
    await syncThisDevice({ [KEYS.tasks]: [] })
    vi.setSystemTime(T0 + 60_000)
    browser.localStorage.seed(KEYS.tasks, JSON.stringify([]))
    await syncThisDevice({ [KEYS.tasks]: [] })
    expect(cloud.docs.get(KEYS.tasks)?.payload).toEqual([])

    await switchDevice(dumpA)
    await syncThisDevice({ [KEYS.tasks]: initial })
    expect(diskOf(KEYS.tasks)).toEqual([])
  })
})

/* ==================== ② 冲突场景（Last Write Wins） ==================== */

describe('冲突场景 · 最后写入胜出与首次保护', () => {
  it('11. A 改、B 也改（B 更晚）→ B 的值最终两机一致', async () => {
    const base = [{ id: 's-1', v: 'A-旧' }]
    browser.localStorage.seed(KEYS.students, JSON.stringify(base))
    await syncThisDevice({ [KEYS.students]: base })
    const dumpA = dumpStorage()

    // B 对齐后改成 B 版（更晚）
    await switchDevice({})
    await syncThisDevice({ [KEYS.students]: [] })
    vi.setSystemTime(T0 + 30_000)
    const bValue = [{ id: 's-1', v: 'B-新' }]
    browser.localStorage.seed(KEYS.students, JSON.stringify(bValue))
    await syncThisDevice({ [KEYS.students]: bValue })

    // A 再同步 → 采纳 B（B 的 updatedAt 更新）
    await switchDevice(dumpA)
    await syncThisDevice({ [KEYS.students]: base })
    expect(diskOf(KEYS.students)).toEqual(bValue)
    expect(cloud.docs.get(KEYS.students)?.payload).toEqual(bValue)
  })

  it('12. A 改、B 未改 → A 的值被推上云并被 B 采纳', async () => {
    const initial = [{ id: 'l-1' }]
    browser.localStorage.seed(KEYS.leave, JSON.stringify(initial))
    await syncThisDevice({ [KEYS.leave]: initial })
    const dumpA = dumpStorage()

    // B 也来一趟（对齐，内容不变 → 不产生推送）
    await switchDevice({})
    const beforeB = cloud.pushes.length
    await syncThisDevice({ [KEYS.leave]: [] })
    await syncThisDevice({ [KEYS.leave]: [] })
    expect(cloud.pushes.length).toBe(beforeB)
    const dumpB = dumpStorage()

    // A 改动（更晚）→ 推上去
    await switchDevice(dumpA)
    vi.setSystemTime(T0 + 40_000)
    const aNew = [{ id: 'l-1' }, { id: 'l-2' }]
    browser.localStorage.seed(KEYS.leave, JSON.stringify(aNew))
    await syncThisDevice({ [KEYS.leave]: aNew })
    expect(cloud.docs.get(KEYS.leave)?.payload).toEqual(aNew)

    // B 再同步：采纳 A 的新值
    await switchDevice(dumpB)
    await syncThisDevice({ [KEYS.leave]: initial })
    expect(diskOf(KEYS.leave)).toEqual(aNew)
  })

  it('13. 首次同步「两边都有数据」：一个字都不动，列进待裁决', async () => {
    // 云端已有 B 版
    cloud.docs.set(KEYS.students, {
      key: KEYS.students,
      payload: [{ id: 'remote' }],
      updatedAt: T0 - 10_000,
    })
    // 本机是 A 版且**没有对齐记账**（= 这台设备第一次同步）
    browser.localStorage.seed(KEYS.students, JSON.stringify([{ id: 'local' }]))
    await syncThisDevice({ [KEYS.students]: [{ id: 'local' }] })

    const { cloudSyncState } = await import('@/services/cloudSync')
    expect(cloudSyncState.value.conflicts).toContain(KEYS.students)
    // 本机与云端两份都还在（谁都没被覆盖）
    expect(diskOf(KEYS.students)).toEqual([{ id: 'local' }])
    expect(cloud.docs.get(KEYS.students)?.payload).toEqual([{ id: 'remote' }])
  })

  it('14. 冲突时其它键照常同步（一个键的问题不阻塞整批）', async () => {
    cloud.docs.set(KEYS.students, {
      key: KEYS.students,
      payload: [{ id: 'remote' }],
      updatedAt: T0,
    })
    browser.localStorage.seed(KEYS.students, JSON.stringify([{ id: 'local' }]))
    browser.localStorage.seed(KEYS.tasks, JSON.stringify([{ id: 't-1' }]))
    await syncThisDevice({
      [KEYS.students]: [{ id: 'local' }],
      [KEYS.tasks]: [{ id: 't-1' }],
    })
    expect(cloud.docs.get(KEYS.tasks)?.payload).toEqual([{ id: 't-1' }])
  })

  it('15. 无死循环：冲突未处置时再同步一轮，两边仍不变、云端不新增推送', async () => {
    cloud.docs.set(KEYS.students, {
      key: KEYS.students,
      payload: [{ id: 'remote' }],
      updatedAt: T0,
    })
    browser.localStorage.seed(KEYS.students, JSON.stringify([{ id: 'local' }]))
    await syncThisDevice({ [KEYS.students]: [{ id: 'local' }] })
    const pushesAfterFirst = cloud.pushes.length

    await syncThisDevice({ [KEYS.students]: [{ id: 'local' }] })
    expect(cloud.pushes.length).toBe(pushesAfterFirst)
    expect(diskOf(KEYS.students)).toEqual([{ id: 'local' }])
  })

  it('16. 裁决「保留本机」：本机内容推上云，冲突清空', async () => {
    cloud.docs.set(KEYS.students, {
      key: KEYS.students,
      payload: [{ id: 'remote' }],
      updatedAt: T0,
    })
    browser.localStorage.seed(KEYS.students, JSON.stringify([{ id: 'local' }]))
    await syncThisDevice({ [KEYS.students]: [{ id: 'local' }] })

    const { resolveConflicts, cloudSyncState } = await import('@/services/cloudSync')
    await resolveConflicts('local')
    await flushMicrotasks()
    expect(cloud.docs.get(KEYS.students)?.payload).toEqual([{ id: 'local' }])
    expect(cloudSyncState.value.conflicts).toEqual([])
  })

  it('17. 裁决「保留云端」：云端那份落到本机，冲突清空', async () => {
    cloud.docs.set(KEYS.students, {
      key: KEYS.students,
      payload: [{ id: 'remote' }],
      updatedAt: T0,
    })
    browser.localStorage.seed(KEYS.students, JSON.stringify([{ id: 'local' }]))
    await syncThisDevice({ [KEYS.students]: [{ id: 'local' }] })

    const { resolveConflicts, cloudSyncState } = await import('@/services/cloudSync')
    await resolveConflicts('remote')
    await flushMicrotasks()
    expect(diskOf(KEYS.students)).toEqual([{ id: 'remote' }])
    expect(cloudSyncState.value.conflicts).toEqual([])
  })

  it('18. 两边都没变：整轮不写盘、不推送（幂等，不制造多余流量）', async () => {
    browser.localStorage.seed(KEYS.students, JSON.stringify([{ id: 's-1' }]))
    await syncThisDevice({ [KEYS.students]: [{ id: 's-1' }] })
    const writesBefore = browser.localStorage.writesFor(KEYS.students)
    const pushesBefore = cloud.pushes.length

    await syncThisDevice({ [KEYS.students]: [{ id: 's-1' }] })
    expect(browser.localStorage.writesFor(KEYS.students)).toBe(writesBefore)
    expect(cloud.pushes.length).toBe(pushesBefore)
  })
})

/* ==================== ③ 重试 / 超时 / 网络恢复 ==================== */

describe('重试 · 退避 · 超时 · 网络恢复', () => {
  async function makeEngine(overrides: {
    push: () => Promise<{ ok: boolean; error?: string; retryable?: boolean; at?: number }>
    retryDelayMs?: number
    timeoutMs?: number
    maxAttempts?: number
  }) {
    const { SyncEngine } = await import('@/sync')
    return new SyncEngine({
      transport: {
        kind: 'simulated',
        push: async () => overrides.push() as never,
        pull: async () => ({ ok: true, at: Date.now() }),
      },
      maxAttempts: overrides.maxAttempts ?? 3,
      retryDelayMs: overrides.retryDelayMs ?? 1000,
      timeoutMs: overrides.timeoutMs ?? 20_000,
    })
  }

  it('19. 指数退避 1s → 2s：请求间隔按 2 的幂增长', async () => {
    const moments: number[] = []
    const engine = await makeEngine({
      push: async () => {
        moments.push(Date.now())
        return { ok: false, error: 'Failed to fetch', retryable: true }
      },
      retryDelayMs: 1000,
      maxAttempts: 3,
    })
    engine.enqueue(KEYS.students)
    const flushPromise = engine.flush()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1200)
    await vi.advanceTimersByTimeAsync(2500)
    await flushPromise

    expect(moments.length).toBe(3)
    expect(moments[1]! - moments[0]!).toBe(1000)
    expect(moments[2]! - moments[1]!).toBe(2000)
  })

  it('20. 退避有上限（不超过 30s，网络长期不通时不会无限拉长）', async () => {
    const engine = await makeEngine({
      push: async () => ({ ok: false, error: 'Failed to fetch', retryable: true }),
      retryDelayMs: 20_000,
      maxAttempts: 3,
    })
    const retries: number[] = []
    engine.on((name, payload) => {
      if (name === 'sync:retry')
        retries.push(Number(/(\d+)ms/.exec(payload.message ?? '')?.[1] ?? 0))
    })
    engine.enqueue(KEYS.students)
    const flushPromise = engine.flush()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(25_000)
    await vi.advanceTimersByTimeAsync(35_000)
    await flushPromise
    expect(Math.max(...retries)).toBeLessThanOrEqual(30_000)
  })

  it('21. 超时按「可重试失败」处理（不会把界面挂在「同步中」）', async () => {
    const { SyncEngine } = await import('@/sync')
    const engine = new SyncEngine({
      transport: {
        kind: 'simulated',
        push: () => new Promise(() => {}), // 永不返回
        pull: async () => ({ ok: true, at: Date.now() }),
      },
      maxAttempts: 1,
      retryDelayMs: 0,
      timeoutMs: 500,
    })
    engine.enqueue(KEYS.students)
    const flushPromise = engine.flush()
    await vi.advanceTimersByTimeAsync(600)
    await flushPromise
    expect(engine.state).toBe('error')
    expect(engine.snapshot().lastError).toContain('超时')
  })

  it('22. 不可重试失败：只请求一次（不浪费退避时间）', async () => {
    let calls = 0
    const engine = await makeEngine({
      push: async () => {
        calls += 1
        return { ok: false, error: 'permission denied', retryable: false }
      },
      retryDelayMs: 1000,
    })
    engine.enqueue(KEYS.students)
    await engine.flush()
    expect(calls).toBe(1)
  })

  it('23. 断网期间队列保留（待同步不丢，状态可读）', async () => {
    let online = false
    const engine = await makeEngine({
      push: async () =>
        online
          ? { ok: true, at: Date.now() }
          : { ok: false, error: 'Failed to fetch', retryable: true },
      retryDelayMs: 0,
    })
    engine.enqueue(KEYS.students)
    await engine.flush()
    expect(engine.state).toBe('error')
    expect(engine.pending).toBe(0) // 重试耗尽后出队，但记账仍在（下次整轮会带上）
    expect(engine.snapshot().lastError).toContain('Failed to fetch')

    online = true
    engine.enqueue(KEYS.students)
    await engine.flush()
    expect(engine.state).toBe('synced')
    expect(engine.snapshot().lastError).toBeNull()
  })

  it('24. 网络恢复自动补推：online 事件触发的整轮把积压推上去', async () => {
    browser.setOnline(false)
    cloud.pullError = new Error('Failed to fetch')
    browser.localStorage.seed(KEYS.students, JSON.stringify([{ id: 's-1' }]))
    const sync = await import('@/services/sync')
    sync.syncPersisted(KEYS.students, ref([{ id: 's-1' }]), (raw) => raw)

    const auto = await import('@/sync/autoSync')
    auto.startAutoSync()
    await flushMicrotasks()
    expect(cloud.docs.has(KEYS.students)).toBe(false)

    cloud.pullError = null
    browser.setOnline(true) // 自带派发 online 事件（见 helpers/env 的说明）
    await flushMicrotasks()
    await flushMicrotasks()

    expect(cloud.docs.has(KEYS.students)).toBe(true)
    const { syncEngine } = await import('@/sync')
    expect(syncEngine.snapshot().lastError).toBeNull()
    auto.resetAutoSyncForTest()
  })

  it('25. 队列清空后状态回到已同步（网络恢复后不收在 Error）', async () => {
    browser.localStorage.seed(KEYS.tasks, JSON.stringify([{ id: 't-1' }]))
    const sync = await import('@/services/sync')
    sync.syncPersisted(KEYS.tasks, ref([{ id: 't-1' }]), (raw) => raw)
    const auto = await import('@/sync/autoSync')
    auto.startAutoSync()
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(300)

    const { syncEngine } = await import('@/sync')
    expect(syncEngine.state).toBe('synced')
    expect(syncEngine.pending).toBe(0)
    auto.resetAutoSyncForTest()
  })

  it('26. 并发 flush 不重复推：同一键在队列里只有一条', async () => {
    browser.localStorage.seed(KEYS.students, JSON.stringify([{ id: 's-1' }]))
    const sync = await import('@/services/sync')
    sync.syncPersisted(KEYS.students, ref([{ id: 's-1' }]), (raw) => raw)

    const auto = await import('@/sync/autoSync')
    auto.startAutoSync()
    await flushMicrotasks()
    const { syncEngine } = await import('@/sync')
    const baseline = cloud.pushes.filter((doc) => doc.key === KEYS.students).length
    syncEngine.enqueue(KEYS.students)
    syncEngine.enqueue(KEYS.students) // 同键去重 → 仍只有一条

    await Promise.all([syncEngine.flush(), syncEngine.flush()])
    await flushMicrotasks()
    const after = cloud.pushes.filter((doc) => doc.key === KEYS.students).length
    expect(after - baseline).toBe(1)
    auto.resetAutoSyncForTest()
  })
})
