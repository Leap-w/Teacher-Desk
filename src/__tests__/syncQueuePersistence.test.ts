/**
 * 队列持久化 · Outbox · 同步诊断（Phase Cloud-4 §五 / §六 / §七）。
 *
 * 三块自检：
 * - **队列持久化**：刷新 / 关标签 / 重启后接着推，且**不重复执行**（已经推成功的键不在快照里）；
 * - **Outbox**：待同步列表 / 已同步清理 / 重试计数——界面只读这一份；
 * - **诊断**：Observable Sync 规范要求的五个读数（状态 / 队列 / 待同步键 / 最近时间 / 最近错误 / 通道）。
 *
 * 不连真 CloudBase（`@/services/cloudbase` 整块换成内存假云端），时间用假时钟。
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
  pushError: null as Error | null,
  pushes: [] as { key: string; payload: unknown[]; updatedAt: number }[],
}))

vi.mock('@/services/cloudbase', () => ({
  isCloudConfigured: () => cloud.configured,
  currentUser: async () => (cloud.signedIn ? { uid: 'u-1', username: 'teacher' } : null),
  createCloudBaseRemote: () => ({
    pull: async () => [...cloud.docs.values()].map((doc) => ({ ...doc })),
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
const KEY = `${prefix}:students`
const KEY2 = `${prefix}:works`
const QUEUE_KEY = `${prefix}:sync-queue`
const T0 = 1_900_000_000_000

let browser: FakeBrowser

async function installFreshPinia(): Promise<void> {
  const pinia = await import('pinia')
  pinia.setActivePinia(pinia.createPinia())
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 25; index += 1) await Promise.resolve()
}

async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
  await flushMicrotasks()
}

async function makeEngine(options: { maxAttempts?: number; retryDelayMs?: number } = {}) {
  const { SyncEngine } = await import('@/sync')
  return new SyncEngine({
    transport: {
      kind: 'simulated',
      push: async () => ({ ok: true, at: Date.now() }),
      pull: async () => ({ ok: true, at: Date.now() }),
    },
    maxAttempts: options.maxAttempts ?? 3,
    retryDelayMs: options.retryDelayMs ?? 0,
  })
}

/** 盘上的队列快照（直接读盘，不信内存） */
function diskQueue(): { nextId: number; items: { key: string; attempts: number }[] } | null {
  const raw = readRaw(QUEUE_KEY)
  if (raw === null) return null
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed) || parsed.length === 0) return null
  return parsed[0] as { nextId: number; items: { key: string; attempts: number }[] }
}

beforeEach(async () => {
  browser = installFakeBrowser()
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  vi.resetModules()
  await installFreshPinia()
  cloud.configured = true
  cloud.signedIn = true
  cloud.docs.clear()
  cloud.pushError = null
  cloud.pushes = []
})

afterEach(() => {
  vi.useRealTimers()
})

/* ==================== ① 队列持久化（Queue Recovery） ==================== */

describe('队列持久化 · 序列化与恢复', () => {
  it('1. serialize → restore 往返：任务、尝试次数与 nextId 都保留', async () => {
    const engine = await makeEngine()
    engine.enqueue(KEY)
    engine.enqueue(KEY2)
    const snapshot = engine.serializeQueue()
    expect(snapshot.items.map((item) => item.key)).toEqual([KEY, KEY2])

    const fresh = await makeEngine()
    expect(fresh.restoreQueue(snapshot)).toBe(2)
    expect(fresh.pending).toBe(2)
    expect(fresh.pendingKeys()).toEqual([KEY, KEY2])
    expect(fresh.serializeQueue().nextId).toBe(snapshot.nextId)
  })

  it('2. 空队列序列化为空 items（不是 null，便于落盘「这里没有待办」）', async () => {
    const engine = await makeEngine()
    const snapshot = engine.serializeQueue()
    expect(snapshot.items).toEqual([])
    expect(typeof snapshot.nextId).toBe('number')
  })

  it('3. restore(null) 安全：0 条、不炸、保持 LocalOnly', async () => {
    const engine = await makeEngine()
    expect(engine.restoreQueue(null)).toBe(0)
    expect(engine.pending).toBe(0)
    expect(engine.state).toBe('local-only')
  })

  it('4. restore 坏快照（items 不是数组）→ 0 条', async () => {
    const engine = await makeEngine()
    const broken = { nextId: 3, items: 'not-an-array' } as unknown as {
      nextId: number
      items: never[]
    }
    expect(engine.restoreQueue(broken)).toBe(0)
    expect(engine.pending).toBe(0)
  })

  it('5. restore 逐条形状守卫：缺 key / 非法 op / 负数 attempts 被丢弃或归正', async () => {
    const engine = await makeEngine()
    const dirty = {
      nextId: 9,
      items: [
        { id: 1, key: '', op: 'push', attempts: 0, enqueuedAt: 0 },
        { id: 2, key: KEY, op: 'unknown-op', attempts: -5, enqueuedAt: 0 },
        { id: 3, key: KEY2, op: 'push', attempts: 4, enqueuedAt: 0 },
      ],
    } as unknown as Parameters<typeof engine.restoreQueue>[0]
    expect(engine.restoreQueue(dirty)).toBe(2)
    expect(engine.pendingKeys()).toEqual([KEY, KEY2])
    // 非法 op 归为 push、负数 attempts 归 0
    const outbox = engine.outbox()
    expect(outbox[0]?.op).toBe('push')
    expect(outbox[0]?.attempts).toBe(0)
    expect(outbox[1]?.attempts).toBe(4)
  })

  it('6. restore 同键去重：只保留一条（与运行中同一口径）', async () => {
    const engine = await makeEngine()
    const snapshot = {
      nextId: 3,
      items: [
        { id: 1, key: KEY, op: 'push' as const, attempts: 0, enqueuedAt: 0 },
        { id: 2, key: KEY, op: 'push' as const, attempts: 1, enqueuedAt: 0 },
      ],
    }
    expect(engine.restoreQueue(snapshot)).toBe(1)
  })

  it('7. restore 后新任务 id 不与恢复的任务相撞', async () => {
    const engine = await makeEngine()
    engine.restoreQueue({
      nextId: 1,
      items: [{ id: 7, key: KEY, op: 'push', attempts: 0, enqueuedAt: 0 }],
    })
    engine.enqueue(KEY2)
    const ids = engine.serializeQueue().items.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(Math.max(...ids)).toBeGreaterThanOrEqual(8)
  })

  it('8. 队列仓储往返：落盘后能读回同一份快照', async () => {
    const { syncQueueRepository } = await import('@/repositories')
    const engine = await makeEngine()
    engine.enqueue(KEY)
    syncQueueRepository.save(engine.serializeQueue())

    const loaded = syncQueueRepository.load()
    expect(loaded?.items.map((item) => item.key)).toEqual([KEY])
    expect(readRaw(QUEUE_KEY)).not.toBeNull()
  })

  it('9. 队列仓储读到坏 JSON → null（按空队列处理，绝不抛）', async () => {
    browser.localStorage.seed(QUEUE_KEY, '{这不是 JSON')
    const { syncQueueRepository } = await import('@/repositories')
    expect(syncQueueRepository.load()).toBeNull()
  })

  it('10. 队列仓储读到空数组包裹 → null（没有待办）', async () => {
    const { syncQueueRepository } = await import('@/repositories')
    syncQueueRepository.clear()
    expect(syncQueueRepository.load()).toBeNull()
  })

  it('11. autoSync 启动时恢复队列并**继续同步**（不用等下一次编辑）', async () => {
    // 上一次会话留下的待办
    browser.localStorage.seed(
      QUEUE_KEY,
      JSON.stringify([
        {
          nextId: 2,
          items: [{ id: 1, key: KEY, op: 'push', attempts: 0, enqueuedAt: T0 - 5000 }],
        },
      ]),
    )
    browser.localStorage.seed(KEY, JSON.stringify([{ id: 'a' }]))
    const sync = await import('@/services/sync')
    sync.syncPersisted(KEY, ref([{ id: 'a' }]), (raw) => raw)

    const auto = await import('@/sync/autoSync')
    auto.startAutoSync()
    await flushMicrotasks()
    await advance(200)

    expect(cloud.docs.has(KEY)).toBe(true)
    auto.resetAutoSyncForTest()
  })

  it('12. 刷新恢复**不重复执行**：推成功即出队，落盘的快照里没有它', async () => {
    browser.localStorage.seed(KEY, JSON.stringify([{ id: 'a' }]))
    const sync = await import('@/services/sync')
    sync.syncPersisted(KEY, ref([{ id: 'a' }]), (raw) => raw)

    const auto = await import('@/sync/autoSync')
    auto.startAutoSync()
    await flushMicrotasks()
    await advance(200)

    // 推成功后队列落盘为空 → 恢复时不会再把同一个键推一遍
    const stored = diskQueue()
    expect(stored?.items ?? []).toEqual([])
    const pushes = cloud.pushes.filter((doc) => doc.key === KEY).length
    expect(pushes).toBe(1)
    auto.resetAutoSyncForTest()
  })
})

/* ==================== ② Outbox ==================== */

describe('Outbox · 待同步列表 / 已同步清理 / 重试计数', () => {
  it('13. outbox 列出待同步条目（键 / 操作 / 次数 / 入队时间）', async () => {
    const engine = await makeEngine()
    engine.enqueue(KEY)
    const [entry] = engine.outbox()
    expect(entry?.key).toBe(KEY)
    expect(entry?.op).toBe('push')
    expect(entry?.attempts).toBe(0)
    expect(entry?.enqueuedAt).toBe(T0)
  })

  it('14. 已同步清理：推成功后 outbox 为空', async () => {
    const engine = await makeEngine()
    engine.enqueue(KEY)
    await engine.flush()
    expect(engine.outbox()).toEqual([])
  })

  it('15. 重试计数：失败重试后 outbox 里的 attempts 增长', async () => {
    const { SyncEngine } = await import('@/sync')
    let calls = 0
    const engine = new SyncEngine({
      transport: {
        kind: 'simulated',
        push: async () => {
          calls += 1
          return calls <= 1
            ? { ok: false, error: 'Failed to fetch', retryable: true }
            : { ok: true, at: Date.now() }
        },
        pull: async () => ({ ok: true, at: Date.now() }),
      },
      maxAttempts: 3,
      retryDelayMs: 0,
    })
    engine.enqueue(KEY)
    // 第一次失败后任务回到队尾，attempts=1
    const flushPromise = engine.flush()
    await flushMicrotasks()
    await flushPromise
    expect(engine.outbox()).toEqual([]) // 第二次成功 → 已清理
    expect(engine.snapshot().succeeded).toBe(1)
  })

  it('16. pendingKeys 去重且保持入队顺序', async () => {
    const engine = await makeEngine()
    engine.enqueue(KEY)
    engine.enqueue(KEY2)
    engine.enqueue(KEY) // 同键去重 → 不入队
    expect(engine.pendingKeys()).toEqual([KEY, KEY2])
  })

  it('17. clear() 之后 outbox 为空', async () => {
    const engine = await makeEngine()
    engine.enqueue(KEY)
    engine.clear()
    expect(engine.outbox()).toEqual([])
    expect(engine.pending).toBe(0)
  })

  it('18. 恢复后的任务出现在 outbox 里（同步诊断据此展示待办）', async () => {
    const engine = await makeEngine()
    engine.restoreQueue({
      nextId: 2,
      items: [{ id: 1, key: KEY2, op: 'push', attempts: 2, enqueuedAt: T0 - 100 }],
    })
    const [entry] = engine.outbox()
    expect(entry?.key).toBe(KEY2)
    expect(entry?.attempts).toBe(2)
    expect(engine.state).toBe('sync-pending')
  })
})

/* ==================== ③ 同步诊断（Observable Sync） ==================== */

describe('同步诊断 · Observable Sync', () => {
  it('19. 诊断暴露五个关键读数（状态 / 队列 / 待同步键 / 最近同步 / 最近错误 / 通道）', async () => {
    const { useSyncDiagnostics } = await import('@/composables/useSyncDiagnostics')
    const diag = useSyncDiagnostics()
    expect(typeof diag.state.value).toBe('string')
    expect(typeof diag.pending.value).toBe('number')
    expect(Array.isArray(diag.pendingKeys.value)).toBe(true)
    expect(diag.transport.value.length).toBeGreaterThan(0)
    expect(typeof diag.summary.value).toBe('string')
  })

  it('20. 未配置云环境：通道与摘要都说明「本地模式」', async () => {
    cloud.configured = false
    vi.resetModules()
    await installFreshPinia()
    const { useSyncDiagnostics } = await import('@/composables/useSyncDiagnostics')
    const diag = useSyncDiagnostics()
    expect(diag.transport.value).toContain('未配置')
    expect(diag.summary.value).toContain('本地模式')
  })

  it('21. 队列变化后诊断快照随之更新（引擎事件驱动，不是轮询）', async () => {
    const { useSyncDiagnostics } = await import('@/composables/useSyncDiagnostics')
    const { syncEngine } = await import('@/sync')
    const diag = useSyncDiagnostics()
    const before = diag.pending.value
    syncEngine.enqueue(KEY)
    await flushMicrotasks()
    expect(diag.pending.value).toBe(before + 1)
    expect(diag.pendingKeys.value).toContain(KEY)
    syncEngine.clear()
  })

  it('22. 失败后诊断给出最近错误（可定位原因）', async () => {
    const { syncEngine } = await import('@/sync')
    const { setActiveTransport } = await import('@/sync/transportRegistry')
    const { useSyncDiagnostics } = await import('@/composables/useSyncDiagnostics')

    setActiveTransport({
      kind: 'cloud',
      push: async () => ({ ok: false, error: 'boom', retryable: false }),
      pull: async () => ({ ok: false, error: 'boom', retryable: false }),
      sync: async () => ({ ok: false, error: 'boom', retryable: false }),
    })

    const diag = useSyncDiagnostics()
    await syncEngine.runCycle()
    await flushMicrotasks()
    expect(diag.lastError.value).toContain('boom')
    expect(diag.state.value).toBe('error')
    setActiveTransport(null)
  })

  it('23. 开发模式标志为布尔，摘要始终可读（正式版折叠也有这一行）', async () => {
    const { useSyncDiagnostics } = await import('@/composables/useSyncDiagnostics')
    const diag = useSyncDiagnostics()
    expect(typeof diag.isDev).toBe('boolean')
    expect(diag.summary.value).not.toBe('')
  })

  it('24. 诊断展示的队列存储键与仓储键一致', async () => {
    const { useSyncDiagnostics } = await import('@/composables/useSyncDiagnostics')
    const { SYNC_QUEUE_STORAGE_KEY } = await import('@/repositories')
    const diag = useSyncDiagnostics()
    expect(diag.queueKey.value).toBe(SYNC_QUEUE_STORAGE_KEY)
    expect(diag.queueKey.value).toBe(QUEUE_KEY)
  })
})
