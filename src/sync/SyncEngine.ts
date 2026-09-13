/**
 * 同步引擎（V2.2.1-alpha · Phase Cloud-2 核心）。
 *
 * 统一入口（**Sync Engine First**：CloudBase / Widget / 跨设备 / 定时同步都只调这里）：
 * - `enqueue(key)`  记一笔待同步；空闲态自动进入 SyncPending
 * - `flush()`       逐条执行队列（FIFO），失败按上限重试，成功计一次
 * - `sync()`        flush 的语义化别名（「把该推的推上去」）
 * - `snapshot()`    UI 只读快照
 *
 * **本阶段全部本地模拟**：传输层是注入的 `SyncTransport`（运行时用
 * `createSimulatedTransport`），引擎不认识 localStorage / CloudBase / fetch，
 * 也不碰任何 Store 与 Repository API。
 */
import { ConflictResolver } from './ConflictResolver'
import { SyncEvents } from './SyncEvents'
import { SyncQueue } from './SyncQueue'
import { SyncStateMachine } from './SyncState'
import {
  SyncState,
  type SyncEngineOptions,
  type SyncSnapshot,
  type SyncTask,
  type SyncTransport,
  type TransportOutcome,
} from './types'

const DEFAULT_MAX_ATTEMPTS = 3

export class SyncEngine {
  private readonly queue = new SyncQueue()
  private readonly machine = new SyncStateMachine()
  private readonly resolver: ConflictResolver
  private readonly events = new SyncEvents()
  private readonly transport: SyncTransport
  private readonly maxAttempts: number
  private readonly retryDelayMs: number
  private readonly now: () => number

  private lastSyncedAt: number | null = null
  private lastError: string | null = null
  private succeeded = 0
  private failed = 0

  constructor(options: SyncEngineOptions) {
    this.transport = options.transport
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
    this.retryDelayMs = options.retryDelayMs ?? 0
    this.now = options.now ?? (() => Date.now())
    this.resolver = new ConflictResolver(options.conflictStrategy ?? 'local-wins')
  }

  /** 事件总线（UI / 诊断订阅） */
  get on(): SyncEvents['on'] {
    return this.events.on.bind(this.events)
  }

  /** 冲突策略访问（Cloud-3 起可切换） */
  get conflicts(): ConflictResolver {
    return this.resolver
  }

  /** 当前状态（快捷读法） */
  get state(): SyncState {
    return this.machine.state
  }

  /** 排队中的任务数 */
  get pending(): number {
    return this.queue.size
  }

  /**
   * 记一笔待同步（幂等合并失败：同一个键已有待处理任务时不重复入队——
   * 同一份数据推两次没有意义，Cloud-1 的幂等写也是同一思路）。
   * 返回是否真的入了队。
   */
  enqueue(key: string): boolean {
    const duplicated = this.queue.toArray().some((task) => task.key === key && task.op === 'push')
    if (duplicated) return false
    const task = this.queue.enqueue(key, 'push', undefined, this.now())
    this.machine.transition(SyncState.SyncPending, `enqueue ${key}`)
    this.events.emit('sync:enqueue', { at: this.now(), task, key })
    return true
  }

  /**
   * 逐条执行队列（FIFO）。返回本次执行结果统计。
   * 中途某条任务重试耗尽 → 记 Error 并继续下一条（一个键坏掉不该堵死整条队列），
   * 全部处理完后：仍有排队任务 → SyncPending；全部成功且队列空 → Synced。
   */
  async flush(): Promise<{ succeeded: number; failed: number; remaining: number }> {
    if (this.queue.isEmpty) {
      return { succeeded: 0, failed: 0, remaining: 0 }
    }

    this.machine.transition(SyncState.Syncing, 'flush')
    let roundSucceeded = 0
    let roundFailed = 0

    const total = this.queue.size
    for (let index = 0; index < total; index += 1) {
      const task = this.queue.dequeue()
      if (!task) break
      const outcome = await this.runTask(task)
      if (outcome.ok) {
        roundSucceeded += 1
        this.succeeded += 1
        this.lastSyncedAt = outcome.at
        this.lastError = null
        this.events.emit('sync:success', { at: outcome.at, task, key: task.key })
        continue
      }
      roundFailed += 1
      this.failed += 1
      this.lastError = outcome.error
      this.events.emit('sync:error', {
        at: this.now(),
        task,
        key: task.key,
        message: outcome.error,
      })
    }

    this.settle()
    return { succeeded: roundSucceeded, failed: roundFailed, remaining: this.queue.size }
  }

  /** `sync()` = `flush()` 的语义化别名（对外只承诺「同步一次」这件事） */
  sync(): Promise<{ succeeded: number; failed: number; remaining: number }> {
    return this.flush()
  }

  /** 清空队列并回到本地模式（关闭同步 / 切换账号时用） */
  clear(): number {
    const dropped = this.queue.clear()
    this.machine.reset()
    this.lastError = null
    return dropped
  }

  /** UI 只读快照 */
  snapshot(): SyncSnapshot {
    return {
      state: this.machine.state,
      pending: this.queue.size,
      lastSyncedAt: this.lastSyncedAt,
      lastError: this.lastError,
      succeeded: this.succeeded,
      failed: this.failed,
    }
  }

  /* ---------- 内部 ---------- */

  /** 执行一条任务：失败且可重试、且未达上限 → 重排到队尾 */
  private async runTask(task: SyncTask): Promise<TransportOutcome> {
    let attempt = task.attempts
    let last: TransportOutcome = { ok: false, error: '未知错误', retryable: false }

    while (attempt < this.maxAttempts) {
      attempt += 1
      this.events.emit('sync:start', { at: this.now(), task, key: task.key })
      last = await this.transport.push({ ...task, attempts: attempt })
      if (last.ok) return last

      const exhausted = attempt >= this.maxAttempts
      if (!last.retryable || exhausted) return last

      this.events.emit('sync:retry', {
        at: this.now(),
        task,
        key: task.key,
        message: `第 ${attempt} 次失败：${last.error}，准备重试`,
      })
      if (this.retryDelayMs > 0) {
        await this.delay(this.retryDelayMs * attempt)
      }
    }

    return last
  }

  /** 一轮结束后收敛状态：队列空 → Synced / 仍有任务 → SyncPending / 有错 → Error 优先 */
  private settle(): void {
    if (this.lastError && this.queue.isEmpty) {
      this.machine.transition(SyncState.Error, '本轮有失败')
      return
    }
    if (!this.queue.isEmpty) {
      this.machine.transition(SyncState.SyncPending, '队列仍有任务')
      return
    }
    this.machine.transition(SyncState.Synced, '队列清空')
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

/**
 * 模拟传输（运行时默认）：延迟一小段后按 `failures` 剧本返回结果，
 * **不发任何网络请求**。测试与本地演示都用它；Cloud-3 起换成 CloudAdapter 实现。
 */
export interface SimulatedTransportOptions {
  /** 每次 push 的模拟耗时（毫秒；默认 0，测试友好） */
  latencyMs?: number
  /** 前 N 次 push 失败（用于演示重试链） */
  failuresBeforeSuccess?: number
  /** 失败是否标记为可重试（默认 true） */
  retryable?: boolean
  now?: () => number
}

export function createSimulatedTransport(options: SimulatedTransportOptions = {}): SyncTransport {
  const latency = options.latencyMs ?? 0
  const failures = options.failuresBeforeSuccess ?? 0
  const retryable = options.retryable ?? true
  const now = options.now ?? (() => Date.now())
  let calls = 0

  return {
    kind: 'simulated',
    async push(): Promise<TransportOutcome> {
      if (latency > 0) await new Promise((resolve) => setTimeout(resolve, latency))
      calls += 1
      if (calls <= failures) {
        return { ok: false, error: `模拟传输失败（第 ${calls} 次）`, retryable }
      }
      return { ok: true, at: now() }
    },
    async pull(): Promise<TransportOutcome> {
      // 本阶段没有远端快照：拉起一律成功但无内容
      return { ok: true, at: now() }
    },
  }
}

/** 运行时默认引擎：模拟传输、无延迟、不失败（本地模式下的空闲态） */
export const syncEngine = new SyncEngine({ transport: createSimulatedTransport() })
