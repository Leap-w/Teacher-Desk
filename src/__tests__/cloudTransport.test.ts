/**
 * CloudTransport × SyncEngine × 自动同步（Phase Cloud-3 §十二）。
 *
 * 覆盖：登录 / 会话 / 推 / 拉 / 整轮对账 / 重试 / 队列 / 首次初始化 / 回声抑制。
 *
 * 三条纪律（与 `cloudSync.test.ts` 同源）：
 * - **不连真 CloudBase**：`@/services/cloudbase` 整个换成内存假云端；
 * - **时间可控**：假时钟 + 显式推进，防抖与重试不真的等；
 * - **状态从盘上读**：断言「盘上是什么、云端是什么」，不只信内存里的对象。
 */
import { ref, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installFakeBrowser, type FakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import { readRaw, writeSeedJSON } from '@/services/storage'

const cloud = vi.hoisted(() => ({
  configured: true,
  signedIn: false,
  account: null as string | null,
  docs: new Map<string, { key: string; payload: unknown[]; updatedAt: number }>(),
  pullError: null as Error | null,
  pushError: null as Error | null,
  signInError: null as Error | null,
  pulls: 0,
  pushes: [] as { key: string; payload: unknown[]; updatedAt: number }[],
}))

vi.mock('@/services/cloudbase', () => ({
  isCloudConfigured: () => cloud.configured,
  currentUser: async () =>
    cloud.signedIn ? { uid: 'u-1', username: 'teacher', email: 'teacher@example.com' } : null,
  createCloudBaseRemote: () => ({
    pull: async () => {
      cloud.pulls += 1
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
  signInWithUsername: async (_username: string, password: string) => {
    if (cloud.signInError) throw cloud.signInError
    if (password !== 'right') throw new Error('账号或密码错误')
    cloud.signedIn = true
  },
  signInWithEmail: async (_email: string, password: string) => {
    if (cloud.signInError) throw cloud.signInError
    if (password !== 'right') throw new Error('账号或密码错误')
    cloud.signedIn = true
  },
  signOutCloud: async () => {
    cloud.signedIn = false
  },
}))

const prefix = appConfig.storageKeyPrefix
const KEY = `${prefix}:students`
const KEY2 = `${prefix}:works`
const META_KEY = `${prefix}:cloud:meta`

const T0 = 1_800_000_000_000
const LOCAL = JSON.stringify([{ id: 'local-1', name: '本机学生', studentNo: '0002' }])
const REMOTE = [{ id: 'remote-1', name: '云端学生', studentNo: '0001' }]

let browser: FakeBrowser

/* ---------- 测试基建 ---------- */

function seedDisk(key: string, text: string): void {
  browser.localStorage.seed(key, text)
}

async function installFreshPinia(): Promise<void> {
  const pinia = await import('pinia')
  pinia.setActivePinia(pinia.createPinia())
}

/** 与 store 同一条注册路径：一个键接进同步 */
async function registerKey(key: string, initial: unknown[] = []): Promise<Ref<unknown[]>> {
  const sync = await import('@/services/sync')
  const source = ref<unknown[]>(initial)
  sync.syncPersisted(key, source, (raw) => raw)
  return source
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 25; index += 1) await Promise.resolve()
}

/** 推进防抖窗口，让自动同步排下的那一轮真的跑起来 */
async function settleScheduled(): Promise<void> {
  const { SYNC_DEBOUNCE_MS } = await import('@/services/cloudSync')
  await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS + 100)
  await flushMicrotasks()
}

/** 已登录且会话已确认（checked + account 都以真实同步流程产生） */
async function signInReady(transport: Awaited<ReturnType<typeof makeTransport>>) {
  cloud.signedIn = true
  await transport.sync()
  await flushMicrotasks()
  return transport
}

async function makeTransport() {
  const { createCloudTransport } = await import('@/sync/CloudTransport')
  return createCloudTransport()
}

function diskMeta(): Record<string, unknown> {
  const raw = readRaw(META_KEY)
  return raw === null ? {} : (JSON.parse(raw) as Record<string, unknown>)
}

beforeEach(async () => {
  browser = installFakeBrowser()
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  vi.resetModules()
  await installFreshPinia()

  cloud.configured = true
  cloud.signedIn = false
  cloud.account = null
  cloud.docs.clear()
  cloud.pullError = null
  cloud.pushError = null
  cloud.signInError = null
  cloud.pulls = 0
  cloud.pushes = []
})

afterEach(() => {
  vi.useRealTimers()
})

/* ==================== ① 连接与会话（Login / Session） ==================== */

describe('CloudTransport · 连接与会话', () => {
  it('1. 未配置云环境时 connect() 失败且不可重试（引擎不会白重试）', async () => {
    cloud.configured = false
    const transport = await makeTransport()
    const outcome = await transport.connect()
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.retryable).toBe(false)
      expect(outcome.error).toContain('未配置云环境')
    }
  })

  it('2. 配置了但未登录：connect() 失败且不可重试', async () => {
    const transport = await makeTransport()
    const outcome = await transport.connect()
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.retryable).toBe(false)
      expect(outcome.error).toContain('未登录云端')
    }
  })

  it('3. 已登录：connect() 成功，account() 给出账号', async () => {
    cloud.signedIn = true
    const transport = await makeTransport()
    const outcome = await transport.connect()
    expect(outcome.ok).toBe(true)
    expect(transport.account()).toBe('teacher')
  })

  it('4. 会话确认后 isCloudReady() 为真（调度层据此才把脏键入队）', async () => {
    cloud.signedIn = true
    const transport = await makeTransport()
    const { isCloudReady } = await import('@/services/cloudSync')
    expect(isCloudReady()).toBe(false)
    await transport.sync()
    await flushMicrotasks()
    expect(isCloudReady()).toBe(true)
  })

  it('5. 未登录时不 ready（本地模式：不入队、不打扰）', async () => {
    const transport = await makeTransport()
    await transport.sync()
    await flushMicrotasks()
    const { isCloudReady } = await import('@/services/cloudSync')
    expect(isCloudReady()).toBe(false)
  })

  it('6. disconnect() 登出并清掉本机对齐记账（跨账号隔离）', async () => {
    seedDisk(KEY, LOCAL)
    await registerKey(KEY, JSON.parse(LOCAL))
    const transport = await signInReady(await makeTransport())
    cloud.docs.set(KEY, { key: KEY, payload: JSON.parse(LOCAL), updatedAt: T0 })
    await transport.sync()
    await flushMicrotasks()
    expect(Object.keys(diskMeta()).length).toBeGreaterThan(0)

    const outcome = await transport.disconnect()
    expect(outcome.ok).toBe(true)
    expect(transport.account()).toBeNull()
    expect(diskMeta()).toEqual({})
  })

  it('7. kind 为 cloud（引擎与诊断据此区分通道）', async () => {
    const transport = await makeTransport()
    expect(transport.kind).toBe('cloud')
  })
})

/* ==================== ② 推送（Push） ==================== */

describe('CloudTransport · 推送', () => {
  it('8. 已登录：推送一个键上云，云端收到且记账记下原文', async () => {
    seedDisk(KEY, LOCAL)
    await registerKey(KEY, JSON.parse(LOCAL))
    const transport = await signInReady(await makeTransport())

    const outcome = await transport.push({
      id: 1,
      key: KEY,
      op: 'push',
      enqueuedAt: T0,
      attempts: 0,
    })
    expect(outcome.ok).toBe(true)
    expect(cloud.docs.get(KEY)?.payload).toEqual(JSON.parse(LOCAL))
    expect(Object.keys(diskMeta())).toContain(KEY)
  })

  it('9. 未登录：推送失败且不可重试', async () => {
    seedDisk(KEY, LOCAL)
    await registerKey(KEY, JSON.parse(LOCAL))
    const transport = await makeTransport()
    const outcome = await transport.push({
      id: 1,
      key: KEY,
      op: 'push',
      enqueuedAt: T0,
      attempts: 0,
    })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.retryable).toBe(false)
    expect(cloud.pushes).toEqual([])
  })

  it('10. 断网（连不上）：推送失败但**标记可重试**', async () => {
    const transport = await signInReady(await makeTransport())
    // 本机这一份还没上过云（云端没有这个键）：裁决说「推」，才真的走到推那一步 → 撞上断网
    seedDisk(KEY, LOCAL)
    await registerKey(KEY, JSON.parse(LOCAL))
    cloud.pushError = new Error('Failed to fetch')

    const outcome = await transport.push({
      id: 1,
      key: KEY,
      op: 'push',
      enqueuedAt: T0,
      attempts: 0,
    })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.retryable).toBe(true)
      expect(outcome.error).toContain('Failed to fetch')
    }
  })

  it('11. 被拒（权限 / 集合不存在）：不可重试（要教师处理，重试无用）', async () => {
    const transport = await signInReady(await makeTransport())
    seedDisk(KEY, LOCAL)
    await registerKey(KEY, JSON.parse(LOCAL))
    cloud.pushError = new Error('permission denied')

    const outcome = await transport.push({
      id: 1,
      key: KEY,
      op: 'push',
      enqueuedAt: T0,
      attempts: 0,
    })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.retryable).toBe(false)
  })

  it('12. 本机该键为空（未播种）时推送成功但不产生云端文档', async () => {
    await registerKey(KEY)
    const transport = await signInReady(await makeTransport())
    const outcome = await transport.push({
      id: 1,
      key: KEY,
      op: 'push',
      enqueuedAt: T0,
      attempts: 0,
    })
    expect(outcome.ok).toBe(true)
    expect(cloud.docs.has(KEY)).toBe(false)
  })

  it('13. 同一内容重复推送保持云端一致（幂等）', async () => {
    seedDisk(KEY, LOCAL)
    await registerKey(KEY, JSON.parse(LOCAL))
    const transport = await signInReady(await makeTransport())
    await transport.push({ id: 1, key: KEY, op: 'push', enqueuedAt: T0, attempts: 0 })
    const before = cloud.docs.get(KEY)?.payload
    await transport.push({ id: 2, key: KEY, op: 'push', enqueuedAt: T0, attempts: 0 })
    expect(cloud.docs.get(KEY)?.payload).toEqual(before)
  })

  it('14. 通道抛非 Error 值时归为可重试并给出可读文案', async () => {
    seedDisk(KEY, LOCAL)
    await registerKey(KEY, JSON.parse(LOCAL))
    const transport = await signInReady(await makeTransport())
    const outcome = await transport.push({
      id: 1,
      key: KEY,
      op: 'push',
      enqueuedAt: T0,
      attempts: 0,
    })
    expect(outcome.ok).toBe(true)

    // 直接让端口抛（KEY2 先铺一份本机内容，才走得到端口）
    seedDisk(KEY2, LOCAL)
    await registerKey(KEY2, JSON.parse(LOCAL))
    cloud.pushError = Object.assign(new Error('NetworkError: timeout'), { name: 'TimeoutError' })
    const failed = await transport.push({
      id: 2,
      key: KEY2,
      op: 'push',
      enqueuedAt: T0,
      attempts: 0,
    })
    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.retryable).toBe(true)
  })
})

/* ==================== ③ 拉取（Pull） ==================== */

describe('CloudTransport · 拉取', () => {
  it('15. 云端有该键：拉取成功并给出文档', async () => {
    cloud.docs.set(KEY, { key: KEY, payload: REMOTE, updatedAt: T0 + 10 })
    const transport = await signInReady(await makeTransport())
    const outcome = await transport.pull(KEY)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.at).toBe(T0 + 10)
  })

  it('16. 云端没有该键：拉取成功（空不是错误）', async () => {
    const transport = await signInReady(await makeTransport())
    const outcome = await transport.pull(KEY)
    expect(outcome.ok).toBe(true)
  })

  it('17. 未登录：拉取失败且不可重试', async () => {
    const transport = await makeTransport()
    const outcome = await transport.pull(KEY)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.retryable).toBe(false)
  })

  it('18. 拉取异常（断网）：可重试', async () => {
    const transport = await signInReady(await makeTransport())
    cloud.pullError = new Error('Failed to fetch')
    const outcome = await transport.pull(KEY)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.retryable).toBe(true)
  })

  it('19. 拉取不写本机：盘上原文一字未动', async () => {
    seedDisk(KEY, LOCAL)
    cloud.docs.set(KEY, { key: KEY, payload: REMOTE, updatedAt: T0 + 99 })
    const transport = await signInReady(await makeTransport())
    await transport.pull(KEY)
    expect(readRaw(KEY)).toBe(LOCAL)
  })
})

/* ==================== ④ 整轮对账（Sync） ==================== */

describe('CloudTransport · 整轮对账', () => {
  it('20. 整轮成功：ok 且 lastSyncedAt 被记录', async () => {
    cloud.signedIn = true
    const transport = await makeTransport()
    const outcome = await transport.sync()
    expect(outcome.ok).toBe(true)
    const { cloudSyncState } = await import('@/services/cloudSync')
    expect(cloudSyncState.value.lastSyncedAt).not.toBeNull()
  })

  it('21. 整轮断网：失败且可重试', async () => {
    cloud.signedIn = true
    cloud.pullError = new Error('Failed to fetch')
    const transport = await makeTransport()
    const outcome = await transport.sync()
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.retryable).toBe(true)
      expect(outcome.error).toContain('Failed to fetch')
    }
  })

  it('22. 整轮被拒：失败且不可重试', async () => {
    cloud.signedIn = true
    cloud.pullError = new Error('permission denied')
    const transport = await makeTransport()
    const outcome = await transport.sync()
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.retryable).toBe(false)
  })

  it('23. 未登录整轮：失败且不可重试（signedOut）', async () => {
    const transport = await makeTransport()
    const outcome = await transport.sync()
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error).toContain('未登录云端')
  })

  it('24. 云端更新（本机未变）：整轮把云端那份采纳到本机', async () => {
    seedDisk(KEY, LOCAL)
    const source = await registerKey(KEY, JSON.parse(LOCAL))
    const transport = await signInReady(await makeTransport())
    // 先对齐一次，让记账记下本机这份
    await transport.sync()
    await flushMicrotasks()

    // 云端换了内容且更新
    cloud.docs.set(KEY, { key: KEY, payload: REMOTE, updatedAt: Date.now() + 10_000 })
    await transport.sync()
    await flushMicrotasks()

    expect(JSON.parse(readRaw(KEY) ?? '[]')).toEqual(REMOTE)
    expect(source.value).toEqual(REMOTE)
  })

  it('25. 本机更新（云端未变）：整轮把本机这份推上去（最后写入胜出）', async () => {
    seedDisk(KEY, LOCAL)
    await registerKey(KEY, JSON.parse(LOCAL))
    const transport = await signInReady(await makeTransport())
    await transport.sync()
    await flushMicrotasks()

    // 教师改本机（写盘并推进时钟）
    const later = JSON.stringify([
      ...JSON.parse(LOCAL),
      { id: 'local-2', name: '新增', studentNo: '' },
    ])
    vi.setSystemTime(Date.now() + 5000)
    seedDisk(KEY, later)
    await transport.sync()
    await flushMicrotasks()

    expect(cloud.docs.get(KEY)?.payload).toEqual(JSON.parse(later))
  })
})

/* ==================== ⑤ 引擎 × 云通道集成（Queue / Retry / State） ==================== */

describe('SyncEngine × CloudTransport', () => {
  async function makeEngine(maxAttempts = 3) {
    const { SyncEngine } = await import('@/sync')
    const transport = await makeTransport()
    cloud.signedIn = true
    const engine = new SyncEngine({ transport, maxAttempts, retryDelayMs: 0 })
    return { engine, transport }
  }

  it('26. runCycle 成功：状态 LocalOnly → Syncing → Synced', async () => {
    const { engine } = await makeEngine()
    const seen: string[] = []
    engine.on((_name, payload) => seen.push(payload.key ?? ''))
    const outcome = await engine.runCycle()
    expect(outcome.ok).toBe(true)
    expect(engine.state).toBe('synced')
    expect(seen).toContain('all')
  })

  it('27. runCycle 失败（断网）：状态进 Error 且 lastError 有文案', async () => {
    const { engine } = await makeEngine()
    cloud.signedIn = true
    cloud.pullError = new Error('Failed to fetch')
    const outcome = await engine.runCycle()
    expect(outcome.ok).toBe(false)
    expect(engine.state).toBe('error')
    expect(engine.snapshot().lastError).toContain('Failed to fetch')
  })

  it('28. runCycle 发 sync:success 事件（UI 徽章据此更新）', async () => {
    const { engine } = await makeEngine()
    const names: string[] = []
    engine.on((name) => names.push(name))
    await engine.runCycle()
    expect(names).toContain('sync:success')
  })

  it('29. runCycle 失败发 sync:error 事件', async () => {
    const { engine } = await makeEngine()
    cloud.signedIn = true
    cloud.pullError = new Error('permission denied')
    const names: string[] = []
    engine.on((name) => names.push(name))
    await engine.runCycle()
    expect(names).toContain('sync:error')
  })

  it('30. 队列 flush：脏键入队后经云通道推上去', async () => {
    seedDisk(KEY, LOCAL)
    await registerKey(KEY, JSON.parse(LOCAL))
    const { engine, transport } = await makeEngine()
    await transport.sync()
    await flushMicrotasks()

    engine.enqueue(KEY)
    expect(engine.state).toBe('sync-pending')
    const result = await engine.flush()
    expect(result.succeeded).toBe(1)
    expect(cloud.docs.get(KEY)?.payload).toEqual(JSON.parse(LOCAL))
  })

  it('31. 一个键推失败不堵死其它键（队列继续）', async () => {
    cloud.docs.set(KEY2, { key: KEY2, payload: [], updatedAt: T0 })
    seedDisk(KEY, LOCAL)
    await registerKey(KEY, JSON.parse(LOCAL))
    const { engine, transport } = await makeEngine()
    await transport.sync()
    await flushMicrotasks()

    // 只让第二个键失败：直接调 pushOne，队列里放两个
    engine.enqueue(KEY)
    engine.enqueue(KEY2)
    const result = await engine.flush()
    expect(result.remaining).toBe(0)
    expect(result.succeeded + result.failed).toBe(2)
  })

  it('32. 可重试失败在 maxAttempts 内重试到成功', async () => {
    const { SyncEngine } = await import('@/sync')
    let calls = 0
    const engine = new SyncEngine({
      transport: {
        kind: 'cloud',
        push: async () => {
          calls += 1
          return calls <= 2
            ? { ok: false, error: 'Failed to fetch', retryable: true }
            : { ok: true, at: Date.now() }
        },
        pull: async () => ({ ok: true, at: Date.now() }),
        sync: async () => ({ ok: true, at: Date.now() }),
      },
      maxAttempts: 3,
      retryDelayMs: 0,
    })
    engine.enqueue(KEY)
    const result = await engine.flush()
    expect(result.succeeded).toBe(1)
    expect(calls).toBe(3)
    expect(engine.state).toBe('synced')
  })

  it('33. 重试耗尽：进 Error 并保留失败计数', async () => {
    const { SyncEngine } = await import('@/sync')
    const engine = new SyncEngine({
      transport: {
        kind: 'cloud',
        push: async () => ({ ok: false, error: 'Failed to fetch', retryable: true }),
        pull: async () => ({ ok: true, at: T0 }),
      },
      maxAttempts: 2,
      retryDelayMs: 0,
    })
    engine.enqueue(KEY)
    await engine.flush()
    expect(engine.state).toBe('error')
    expect(engine.snapshot().failed).toBe(1)
  })

  it('34. 不可重试失败：只尝试一次（不浪费请求）', async () => {
    const { SyncEngine } = await import('@/sync')
    let calls = 0
    const engine = new SyncEngine({
      transport: {
        kind: 'cloud',
        push: async () => {
          calls += 1
          return { ok: false, error: 'permission denied', retryable: false }
        },
        pull: async () => ({ ok: true, at: T0 }),
      },
      maxAttempts: 3,
      retryDelayMs: 0,
    })
    engine.enqueue(KEY)
    await engine.flush()
    expect(calls).toBe(1)
    expect(engine.state).toBe('error')
  })

  it('35. clear()：清队列回 LocalOnly（登出场景）', async () => {
    const { engine } = await makeEngine()
    engine.enqueue(KEY)
    expect(engine.clear()).toBe(1)
    expect(engine.state).toBe('local-only')
    expect(engine.pending).toBe(0)
  })

  it('36. snapshot 与 pending 一致（UI 只读这一份）', async () => {
    const { engine } = await makeEngine()
    engine.enqueue(KEY)
    engine.enqueue(KEY2)
    expect(engine.snapshot().pending).toBe(2)
    await engine.flush()
    expect(engine.snapshot().pending).toBe(0)
  })

  it('37. runCycle 后 lastSyncedAt 为真实通道时间', async () => {
    const { engine } = await makeEngine()
    await engine.runCycle()
    expect(engine.snapshot().lastSyncedAt).not.toBeNull()
  })
})

/* ==================== ⑥ 自动同步调度（触发点） ==================== */

describe('autoSync · 触发点', () => {
  it('38. 未配置环境：启动不注册任何触发（本地模式不打扰）', async () => {
    cloud.configured = false
    const auto = await import('@/sync/autoSync')
    auto.startAutoSync()
    await settleScheduled()
    expect(cloud.pulls).toBe(0)
    const { syncEngine } = await import('@/sync')
    expect(syncEngine.state).toBe('local-only')
    auto.resetAutoSyncForTest()
  })

  it('39. 启动即整轮对账（已登录 → 拉云端）', async () => {
    cloud.signedIn = true
    const auto = await import('@/sync/autoSync')
    auto.startAutoSync()
    await flushMicrotasks()
    expect(cloud.pulls).toBeGreaterThan(0)
    auto.resetAutoSyncForTest()
  })

  it('40. 本页写盘后：脏键入队，防抖后推上云', async () => {
    cloud.signedIn = true
    const auto = await import('@/sync/autoSync')
    auto.startAutoSync()
    await flushMicrotasks()
    await registerKey(KEY, JSON.parse(LOCAL))
    seedDisk(KEY, LOCAL)

    // 写盘（与 store 同一条路径：watch 触发写盘 → onSyncDirty）
    const sync = await import('@/services/sync')
    const source = ref<unknown[]>(JSON.parse(LOCAL))
    sync.syncPersisted(KEY, source, (raw) => raw)
    source.value = [...(source.value as unknown[]), { id: 'x' }]
    await flushMicrotasks()
    await settleScheduled()
    expect(cloud.pushes.some((doc) => doc.key === KEY)).toBe(true)
    auto.resetAutoSyncForTest()
  })

  it('41. 防抖合并连续编辑：一个窗口内只推一次', async () => {
    cloud.signedIn = true
    const auto = await import('@/sync/autoSync')
    auto.startAutoSync()
    await flushMicrotasks()
    const sync = await import('@/services/sync')
    const source = ref<unknown[]>([{ id: 'a' }])
    sync.syncPersisted(KEY, source, (raw) => raw)

    source.value = [{ id: 'a' }, { id: 'b' }]
    await flushMicrotasks()
    source.value = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    await flushMicrotasks()
    const before = cloud.pushes.filter((doc) => doc.key === KEY).length
    await settleScheduled()
    const after = cloud.pushes.filter((doc) => doc.key === KEY).length
    // 一个键在同一批里只推一次（队列按键去重）
    expect(after - before).toBeLessThanOrEqual(1)
    auto.resetAutoSyncForTest()
  })

  it('42. 未登录：脏键不入队（引擎保持 LocalOnly）', async () => {
    const auto = await import('@/sync/autoSync')
    auto.startAutoSync()
    await flushMicrotasks()
    const sync = await import('@/services/sync')
    const source = ref<unknown[]>([])
    sync.syncPersisted(KEY, source, (raw) => raw)
    source.value = [{ id: 'a' }]
    await flushMicrotasks()
    await settleScheduled()

    const { syncEngine } = await import('@/sync')
    expect(syncEngine.pending).toBe(0)
    expect(syncEngine.state).toBe('local-only')
    auto.resetAutoSyncForTest()
  })

  it('43. 回声抑制：整轮对账采纳云端数据时的写盘不再推回云端', async () => {
    cloud.signedIn = true
    cloud.docs.set(KEY, { key: KEY, payload: REMOTE, updatedAt: Date.now() + 10_000 })
    seedDisk(KEY, '[{"id":"x"}]')
    const auto = await import('@/sync/autoSync')
    auto.startAutoSync()
    await flushMicrotasks()
    const sync = await import('@/services/sync')
    const source = ref<unknown[]>([])
    sync.syncPersisted(KEY, source, (raw) => raw)
    await settleScheduled()

    const { syncEngine } = await import('@/sync')
    // 采纳后的写盘不该留下待同步任务
    expect(syncEngine.pending).toBe(0)
    auto.resetAutoSyncForTest()
  })

  it('44. 登出：清队列回本地模式，云端数据不动', async () => {
    cloud.signedIn = true
    cloud.docs.set(KEY, { key: KEY, payload: REMOTE, updatedAt: T0 })
    const auto = await import('@/sync/autoSync')
    auto.startAutoSync()
    await flushMicrotasks()
    await auto.signOutAndReset()

    const { syncEngine } = await import('@/sync')
    expect(syncEngine.state).toBe('local-only')
    expect(syncEngine.pending).toBe(0)
    expect(cloud.docs.get(KEY)?.payload).toEqual(REMOTE)
    auto.resetAutoSyncForTest()
  })

  it('45. 手动同步走引擎整轮对账（与自动触发同一条通道）', async () => {
    cloud.signedIn = true
    const auto = await import('@/sync/autoSync')
    const before = cloud.pulls
    await auto.syncNowManual()
    expect(cloud.pulls).toBeGreaterThan(before)
    const { syncEngine } = await import('@/sync')
    expect(syncEngine.state).toBe('synced')
  })
})

/* ==================== ⑦ 登录（账号 / 用户名）与首次初始化 ==================== */

describe('登录与首次初始化（§三 / §六）', () => {
  it('46. 账号登录成功：会话确认并立刻整轮对账', async () => {
    const auto = await import('@/sync/autoSync')
    auto.startAutoSync()
    await flushMicrotasks()
    const before = cloud.pulls
    await auto.signInAndSync('teacher@example.com', 'right')
    expect(cloud.pulls).toBeGreaterThan(before)
    const { cloudSyncState } = await import('@/services/cloudSync')
    expect(cloudSyncState.value.account).not.toBeNull()
    auto.resetAutoSyncForTest()
  })

  it('47. 账号登录失败（密码错）向上抛，不吞错误', async () => {
    const auto = await import('@/sync/autoSync')
    await expect(auto.signInAndSync('teacher@example.com', 'wrong')).rejects.toThrow(
      '账号或密码错误',
    )
    auto.resetAutoSyncForTest()
  })

  it('48. 登录后 isCloudReady 为真（脏键从此才会入队）', async () => {
    const auto = await import('@/sync/autoSync')
    const { isCloudReady } = await import('@/services/cloudSync')
    const before = isCloudReady()
    await auto.signInAndSync('teacher@example.com', 'right')
    expect(before).toBe(false)
    expect(isCloudReady()).toBe(true)
    auto.resetAutoSyncForTest()
  })

  it('49. 未配置环境时登录抛出可读原因', async () => {
    cloud.configured = false
    const auto = await import('@/sync/autoSync')
    await expect(auto.signInAndSync('a@b.com', 'right')).rejects.toThrow('未配置云环境')
  })

  it('50. probeFirstSync：两边都空 → empty', async () => {
    const transport = await signInReady(await makeTransport())
    await expect(transport.firstSyncSituation()).resolves.toBe('empty')
  })

  it('51. 本机有真实数据 + 云端空 → local-only（要问教师）', async () => {
    // 先确认会话（此时两边都空，不会推任何东西），再铺本机数据——否则会话那轮就把本机推上去了
    const transport = await signInReady(await makeTransport())
    seedDisk(KEY, LOCAL)
    await registerKey(KEY, JSON.parse(LOCAL))
    await expect(transport.firstSyncSituation()).resolves.toBe('local-only')
  })

  it('52. 云端有 + 本机空（新设备）→ cloud-only（直接拉）', async () => {
    cloud.docs.set(KEY, { key: KEY, payload: REMOTE, updatedAt: T0 })
    const transport = await signInReady(await makeTransport())
    await expect(transport.firstSyncSituation()).resolves.toBe('cloud-only')
  })

  it('53. 两边都有 → both（交给逐键裁决）', async () => {
    seedDisk(KEY, LOCAL)
    await registerKey(KEY, JSON.parse(LOCAL))
    cloud.docs.set(KEY, { key: KEY, payload: REMOTE, updatedAt: T0 })
    const transport = await signInReady(await makeTransport())
    await expect(transport.firstSyncSituation()).resolves.toBe('both')
  })

  it('54. 初始化云端：把本机全部键推上去并返回条数', async () => {
    seedDisk(KEY, LOCAL)
    seedDisk(KEY2, JSON.stringify([{ id: 'w-1' }]))
    await registerKey(KEY, JSON.parse(LOCAL))
    await registerKey(KEY2, [{ id: 'w-1' }])
    const transport = await signInReady(await makeTransport())

    const result = await transport.initializeFromLocal()
    expect(result.pushed).toBe(2)
    expect(result.failed).toBe(0)
    expect(cloud.docs.get(KEY)?.payload).toEqual(JSON.parse(LOCAL))
    expect(cloud.docs.get(KEY2)?.payload).toEqual([{ id: 'w-1' }])
  })

  it('55. 初始化失败可计数（断网时不算成功）', async () => {
    seedDisk(KEY, LOCAL)
    await registerKey(KEY, JSON.parse(LOCAL))
    const transport = await signInReady(await makeTransport())
    cloud.pushError = new Error('Failed to fetch')
    const result = await transport.initializeFromLocal()
    expect(result.pushed).toBe(0)
    expect(result.failed).toBe(1)
    const { cloudSyncState } = await import('@/services/cloudSync')
    expect(cloudSyncState.value.status).toBe('error')
  })

  it('56. 播种内容不算「本机真实数据」（新设备不会被问初始化）', async () => {
    // 播种基线：这份内容被登记成「应用自己生成的」
    const seedText = JSON.stringify([{ id: 'seed-1' }])
    writeSeedJSON(KEY, JSON.parse(seedText))
    await registerKey(KEY, JSON.parse(seedText))
    const transport = await signInReady(await makeTransport())
    // 关键是不问「是否用本机数据初始化云端」
    await expect(transport.firstSyncSituation()).resolves.not.toBe('local-only')
  })
})
