/**
 * 同步状态机（V2.2.1-alpha · Phase Cloud-2）。
 *
 * 只做「状态 + 合法迁移判定 + 订阅通知」，不含任何业务动作——
 * 引擎（SyncEngine）在每个流程节点调用对应迁移方法，非法迁移**静默忽略并告警**
 * （同步是后台能力，不该因为一次重复通知把界面炸掉；但要留下痕迹便于诊断）。
 *
 * 合法迁移：
 *   LocalOnly  → SyncPending | Syncing | LocalOnly(reset)
 *   SyncPending→ Syncing | LocalOnly(清空队列) | SyncPending
 *   Syncing    → Synced | Error | SyncPending(还有任务) | Syncing
 *   Synced     → SyncPending(又有改动) | Syncing | LocalOnly
 *   Error      → SyncPending(重试) | Syncing | LocalOnly(重置)
 */
import { SyncState } from './types'

type Listener = (state: SyncState, previous: SyncState) => void

const ALLOWED: Record<SyncState, readonly SyncState[]> = {
  [SyncState.LocalOnly]: [SyncState.LocalOnly, SyncState.SyncPending, SyncState.Syncing],
  [SyncState.SyncPending]: [
    SyncState.SyncPending,
    SyncState.Syncing,
    SyncState.LocalOnly,
    SyncState.Error,
  ],
  [SyncState.Syncing]: [
    SyncState.Syncing,
    SyncState.Synced,
    SyncState.Error,
    SyncState.SyncPending,
    SyncState.LocalOnly,
  ],
  [SyncState.Synced]: [
    SyncState.Synced,
    SyncState.SyncPending,
    SyncState.Syncing,
    SyncState.LocalOnly,
    SyncState.Error,
  ],
  [SyncState.Error]: [
    SyncState.Error,
    SyncState.SyncPending,
    SyncState.Syncing,
    SyncState.LocalOnly,
    SyncState.Synced,
  ],
}

export class SyncStateMachine {
  private current: SyncState
  private readonly listeners = new Set<Listener>()

  constructor(initial: SyncState = SyncState.LocalOnly) {
    this.current = initial
  }

  get state(): SyncState {
    return this.current
  }

  get isIdle(): boolean {
    return this.current === SyncState.LocalOnly || this.current === SyncState.Synced
  }

  /** 迁移到目标状态；非法迁移忽略（告警）并返回 false */
  transition(next: SyncState, reason = ''): boolean {
    if (next === this.current) {
      this.notify(this.current)
      return true
    }
    if (!ALLOWED[this.current].includes(next)) {
      console.warn(`[sync] 非法状态迁移：${this.current} → ${next}${reason ? `（${reason}）` : ''}`)
      return false
    }
    const previous = this.current
    this.current = next
    this.notify(previous)
    return true
  }

  /** 重置回本地模式（清空队列 / 关闭同步时用） */
  reset(): void {
    const previous = this.current
    this.current = SyncState.LocalOnly
    if (previous !== SyncState.LocalOnly) this.notify(previous)
  }

  /** 订阅状态变化；返回取消订阅函数 */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(previous: SyncState): void {
    for (const listener of this.listeners) listener(this.current, previous)
  }
}
