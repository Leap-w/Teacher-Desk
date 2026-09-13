/**
 * 同步引擎测试（V2.2.1-alpha · Phase Cloud-2）。
 *
 * 覆盖四块：SyncQueue（FIFO / 重试 / 清空）、SyncStateMachine（合法与非法迁移）、
 * SyncEvents（订阅 / 退订 / 隔离）、SyncEngine（enqueue / flush / 重试耗尽 / 冲突 /
 * 快照）。全部纯 TS，无 DOM、无网络。
 */
import { describe, expect, it, vi } from 'vitest'

import { ConflictResolver } from '@/sync/ConflictResolver'
import { SyncEngine, createSimulatedTransport } from '@/sync/SyncEngine'
import { SyncEvents } from '@/sync/SyncEvents'
import { SyncQueue } from '@/sync/SyncQueue'
import { SyncStateMachine } from '@/sync/SyncState'
import { SyncState } from '@/sync/types'
import type { TransportOutcome } from '@/sync/types'

/* ==================== SyncQueue ==================== */

describe('SyncQueue（队列：FIFO / 重试 / 清空）', () => {
  it('1. 入队按 FIFO 顺序出队', () => {
    const queue = new SyncQueue()
    queue.enqueue('a')
    queue.enqueue('b')
    queue.enqueue('c')
    expect([queue.dequeue()?.key, queue.dequeue()?.key, queue.dequeue()?.key]).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('2. 空队列出队返回 undefined，isEmpty 为真', () => {
    const queue = new SyncQueue()
    expect(queue.isEmpty).toBe(true)
    expect(queue.dequeue()).toBeUndefined()
    expect(queue.size).toBe(0)
  })

  it('3. 任务 id 自增且唯一', () => {
    const queue = new SyncQueue()
    const first = queue.enqueue('a')
    const second = queue.enqueue('a')
    expect(first.id).toBe(1)
    expect(second.id).toBe(2)
    expect(first.id).not.toBe(second.id)
  })

  it('4. retry 把任务放回队尾（不饿死后面的键）并累加尝试次数', () => {
    const queue = new SyncQueue()
    const first = queue.enqueue('a')
    queue.enqueue('b')
    queue.dequeue() // 取出 a（失败）
    const requeued = queue.retry(first)
    expect(requeued.attempts).toBe(1)
    expect(queue.toArray().map((task) => task.key)).toEqual(['b', 'a'])
  })

  it('5. clear 清空并返回被丢弃条数', () => {
    const queue = new SyncQueue()
    queue.enqueue('a')
    queue.enqueue('b')
    expect(queue.clear()).toBe(2)
    expect(queue.isEmpty).toBe(true)
    expect(queue.clear()).toBe(0)
  })

  it('6. peek 不取出任务，toArray 返回副本（外部修改不影响队列）', () => {
    const queue = new SyncQueue()
    queue.enqueue('a')
    expect(queue.peek()?.key).toBe('a')
    expect(queue.size).toBe(1)
    const copy = queue.toArray()
    copy[0]!.key = 'tampered'
    expect(queue.peek()?.key).toBe('a')
  })

  it('7. 支持 pull 操作入队', () => {
    const queue = new SyncQueue()
    const task = queue.enqueue('a', 'pull')
    expect(task.op).toBe('pull')
  })
})

/* ==================== SyncStateMachine ==================== */

describe('SyncStateMachine（状态机）', () => {
  it('8. 初始为 LocalOnly，isIdle 为真', () => {
    const machine = new SyncStateMachine()
    expect(machine.state).toBe(SyncState.LocalOnly)
    expect(machine.isIdle).toBe(true)
  })

  it('9. LocalOnly → SyncPending → Syncing → Synced 全链合法', () => {
    const machine = new SyncStateMachine()
    expect(machine.transition(SyncState.SyncPending)).toBe(true)
    expect(machine.transition(SyncState.Syncing)).toBe(true)
    expect(machine.transition(SyncState.Synced)).toBe(true)
    expect(machine.isIdle).toBe(true)
  })

  it('10. Syncing → Error 合法；Error → Synced 合法（重试成功后收敛）', () => {
    const machine = new SyncStateMachine()
    machine.transition(SyncState.SyncPending)
    machine.transition(SyncState.Syncing)
    expect(machine.transition(SyncState.Error)).toBe(true)
    expect(machine.transition(SyncState.Synced)).toBe(true)
  })

  it('11. Synced → SyncPending 合法（又出现本地改动）', () => {
    const machine = new SyncStateMachine(SyncState.Synced)
    expect(machine.transition(SyncState.SyncPending)).toBe(true)
  })

  it('12. 非法迁移被拒绝、状态不变并告警', () => {
    const machine = new SyncStateMachine(SyncState.LocalOnly)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // LocalOnly 不能直接跳到 Synced（必须先有排队任务）
    expect(machine.transition(SyncState.Synced)).toBe(false)
    expect(machine.state).toBe(SyncState.LocalOnly)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('13. reset 回到 LocalOnly 并通知订阅者', () => {
    const machine = new SyncStateMachine(SyncState.SyncPending)
    const seen: SyncState[] = []
    machine.subscribe((state) => seen.push(state))
    machine.reset()
    expect(machine.state).toBe(SyncState.LocalOnly)
    expect(seen).toEqual([SyncState.LocalOnly])
  })

  it('14. 订阅可取消，取消后不再收到通知', () => {
    const machine = new SyncStateMachine()
    let count = 0
    const off = machine.subscribe(() => {
      count += 1
    })
    machine.transition(SyncState.SyncPending)
    off()
    machine.transition(SyncState.Syncing)
    expect(count).toBe(1)
  })
})

/* ==================== SyncEvents ==================== */

describe('SyncEvents（事件总线）', () => {
  it('15. on 订阅后可收到 emit 的事件与载荷', () => {
    const events = new SyncEvents()
    const received: string[] = []
    events.on((name, payload) => received.push(`${name}:${payload.key ?? ''}`))
    events.emit('sync:start', { at: 1, key: 'a' })
    events.emit('sync:success', { at: 2, key: 'b' })
    expect(received).toEqual(['sync:start:a', 'sync:success:b'])
  })

  it('16. 取消订阅后不再收到事件；size 反映订阅数', () => {
    const events = new SyncEvents()
    let count = 0
    const off = events.on(() => {
      count += 1
    })
    expect(events.size).toBe(1)
    events.emit('sync:start', { at: 1 })
    off()
    events.emit('sync:start', { at: 2 })
    expect(count).toBe(1)
    expect(events.size).toBe(0)
  })

  it('17. 某个监听器抛错不影响其它监听器（隔离）', () => {
    const events = new SyncEvents()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let delivered = 0
    events.on(() => {
      throw new Error('boom')
    })
    events.on(() => {
      delivered += 1
    })
    events.emit('sync:error', { at: 1, message: 'x' })
    expect(delivered).toBe(1)
    warn.mockRestore()
  })

  it('18. clear 清空全部订阅', () => {
    const events = new SyncEvents()
    events.on(() => {})
    events.on(() => {})
    events.clear()
    expect(events.size).toBe(0)
  })
})

/* ==================== ConflictResolver ==================== */

describe('ConflictResolver（冲突：默认 Local Wins）', () => {
  it('19. 默认策略为 local-wins，裁决保留本地', () => {
    const resolver = new ConflictResolver()
    expect(resolver.currentStrategy).toBe('local-wins')
    const result = resolver.resolve({ key: 'a', localVersion: 5, remoteVersion: 9 })
    expect(result.winner).toBe('local')
    expect(resolver.keepsLocal({ key: 'a', localVersion: 5, remoteVersion: 9 })).toBe(true)
  })

  it('20. 可切换 cloud-wins，裁决改判远端', () => {
    const resolver = new ConflictResolver()
    resolver.setStrategy('cloud-wins')
    expect(resolver.resolve({ key: 'a', localVersion: 5, remoteVersion: 9 }).winner).toBe('cloud')
  })

  it('21. merge 未实现时仍不丢本地改动（占位返回 local）', () => {
    const resolver = new ConflictResolver('merge')
    const result = resolver.resolve({ key: 'a', localVersion: 1, remoteVersion: 2 })
    expect(result.winner).toBe('local')
    expect(result.reason).toContain('合并策略尚未实现')
  })
})

/* ==================== SyncEngine ==================== */

function makeEngine(options: Parameters<typeof createSimulatedTransport>[0] = {}) {
  const transport = createSimulatedTransport({ now: () => 1000, ...options })
  return new SyncEngine({ transport, now: () => 1000, retryDelayMs: 0 })
}

describe('SyncEngine（统一入口）', () => {
  it('22. enqueue 后进入 SyncPending，空队列时为 LocalOnly', async () => {
    const engine = makeEngine()
    expect(engine.state).toBe(SyncState.LocalOnly)
    expect(engine.enqueue('teacherdesk:students')).toBe(true)
    expect(engine.state).toBe(SyncState.SyncPending)
    expect(engine.pending).toBe(1)
    await engine.flush()
    expect(engine.state).toBe(SyncState.Synced)
    expect(engine.pending).toBe(0)
  })

  it('23. 同一个键重复 enqueue 合并为一条（幂等去重）', () => {
    const engine = makeEngine()
    expect(engine.enqueue('teacherdesk:works')).toBe(true)
    expect(engine.enqueue('teacherdesk:works')).toBe(false)
    expect(engine.pending).toBe(1)
  })

  it('24. flush 按 FIFO 顺序推送全部任务并统计成功数', async () => {
    const order: string[] = []
    const transport = {
      kind: 'simulated' as const,
      async push(task: { key: string }): Promise<TransportOutcome> {
        order.push(task.key)
        return { ok: true, at: 1 }
      },
      async pull(): Promise<TransportOutcome> {
        return { ok: true, at: 1 }
      },
    }
    const engine = new SyncEngine({ transport, now: () => 1 })
    engine.enqueue('a')
    engine.enqueue('b')
    engine.enqueue('c')
    const result = await engine.sync()
    expect(order).toEqual(['a', 'b', 'c'])
    expect(result).toEqual({ succeeded: 3, failed: 0, remaining: 0 })
    expect(engine.snapshot().succeeded).toBe(3)
    expect(engine.snapshot().lastSyncedAt).toBe(1)
  })

  it('25. 可重试失败会重试到成功（maxAttempts 内）', async () => {
    const engine = makeEngine({ failuresBeforeSuccess: 2 })
    engine.enqueue('a')
    const result = await engine.sync()
    expect(result.succeeded).toBe(1)
    expect(engine.state).toBe(SyncState.Synced)
    expect(engine.snapshot().failed).toBe(0)
  })

  it('26. 重试耗尽后进入 Error 并记录错误文案', async () => {
    const engine = makeEngine({ failuresBeforeSuccess: 99 })
    engine.enqueue('a')
    const result = await engine.sync()
    expect(result.failed).toBe(1)
    expect(engine.state).toBe(SyncState.Error)
    expect(engine.snapshot().lastError).toContain('模拟传输失败')
    expect(engine.snapshot().failed).toBe(1)
  })

  it('27. 不可重试失败立即放弃（不重试）', async () => {
    let calls = 0
    const transport = {
      kind: 'simulated' as const,
      async push(): Promise<TransportOutcome> {
        calls += 1
        return { ok: false, error: '凭据失效', retryable: false }
      },
      async pull(): Promise<TransportOutcome> {
        return { ok: true, at: 1 }
      },
    }
    const engine = new SyncEngine({ transport, maxAttempts: 3, now: () => 1 })
    engine.enqueue('a')
    await engine.sync()
    expect(calls).toBe(1)
    expect(engine.state).toBe(SyncState.Error)
  })

  it('28. 一个键失败不堵死其它键（继续处理队列剩余任务）', async () => {
    const transport = {
      kind: 'simulated' as const,
      async push(task: { key: string }): Promise<TransportOutcome> {
        return task.key === 'bad'
          ? { ok: false, error: '坏键', retryable: false }
          : { ok: true, at: 1 }
      },
      async pull(): Promise<TransportOutcome> {
        return { ok: true, at: 1 }
      },
    }
    const engine = new SyncEngine({ transport, now: () => 1 })
    engine.enqueue('bad')
    engine.enqueue('good')
    const result = await engine.sync()
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(1)
    expect(engine.pending).toBe(0)
  })

  it('29. 空队列 flush 不发请求、不改变状态', async () => {
    const engine = makeEngine()
    const result = await engine.flush()
    expect(result).toEqual({ succeeded: 0, failed: 0, remaining: 0 })
    expect(engine.state).toBe(SyncState.LocalOnly)
  })

  it('30. 事件序列：enqueue → start → success', async () => {
    const engine = makeEngine()
    const names: string[] = []
    engine.on((name) => names.push(name))
    engine.enqueue('a')
    await engine.sync()
    expect(names).toContain('sync:enqueue')
    expect(names).toContain('sync:start')
    expect(names).toContain('sync:success')
    expect(names.indexOf('sync:start')).toBeLessThan(names.indexOf('sync:success'))
  })

  it('31. 失败路径事件：start → retry → error', async () => {
    const engine = makeEngine({ failuresBeforeSuccess: 99 })
    const names: string[] = []
    engine.on((name) => names.push(name))
    engine.enqueue('a')
    await engine.sync()
    expect(names).toContain('sync:retry')
    expect(names).toContain('sync:error')
  })

  it('32. clear 清空队列并回到本地模式', async () => {
    const engine = makeEngine()
    engine.enqueue('a')
    engine.enqueue('b')
    expect(engine.clear()).toBe(2)
    expect(engine.pending).toBe(0)
    expect(engine.state).toBe(SyncState.LocalOnly)
    expect(engine.snapshot().lastError).toBeNull()
  })

  it('33. snapshot 反映累计成功 / 失败与快照字段完整', async () => {
    const engine = makeEngine({ failuresBeforeSuccess: 1 })
    engine.enqueue('a')
    await engine.sync()
    const snapshot = engine.snapshot()
    expect(Object.keys(snapshot).sort()).toEqual(
      ['failed', 'lastError', 'lastSyncedAt', 'pending', 'state', 'succeeded'].sort(),
    )
    expect(snapshot.succeeded + snapshot.failed).toBeGreaterThan(0)
  })

  it('34. 成功后再次 enqueue 回到 SyncPending（可反复同步）', async () => {
    const engine = makeEngine()
    engine.enqueue('a')
    await engine.sync()
    expect(engine.state).toBe(SyncState.Synced)
    engine.enqueue('b')
    expect(engine.state).toBe(SyncState.SyncPending)
    await engine.sync()
    expect(engine.state).toBe(SyncState.Synced)
    expect(engine.snapshot().succeeded).toBe(2)
  })

  it('35. 冲突策略可经引擎读取（Local Wins 兜底）', () => {
    const engine = makeEngine()
    expect(engine.conflicts.currentStrategy).toBe('local-wins')
    expect(engine.conflicts.resolve({ key: 'a', localVersion: 2, remoteVersion: 1 }).winner).toBe(
      'local',
    )
  })

  it('36. 模拟传输延迟与失败剧本可控（latencyMs 不阻塞正确性）', async () => {
    const engine = new SyncEngine({
      transport: createSimulatedTransport({ latencyMs: 1, now: () => 42 }),
      now: () => 42,
      retryDelayMs: 0,
    })
    engine.enqueue('a')
    const result = await engine.sync()
    expect(result.succeeded).toBe(1)
    expect(engine.snapshot().lastSyncedAt).toBe(42)
  })
})
