/**
 * 同步队列（V2.2.1-alpha · Phase Cloud-2）。
 *
 * 纯数据结构：FIFO + 重试计数 + 清空。**不做 IO、不认识传输层**——
 * 引擎（SyncEngine）负责取任务、跑传输、按结果决定重排或丢弃。
 *
 * 为什么单独成件：以后 CloudBase 的多键批量、优先级、持久化队列都要在这里长，
 * 引擎只依赖这四个能力（enqueue/dequeue/retry/clear）即可完成全部编排。
 */
import type { SerializedQueue, SyncOp, SyncTask } from './types'

export class SyncQueue {
  private nextId = 1
  private items: SyncTask[] = []

  /** 入队（FIFO 追加）；返回新任务（id 由队列分配，便于日志与断言） */
  enqueue(key: string, op: SyncOp = 'push', payload?: unknown, at = 0): SyncTask {
    const task: SyncTask = {
      id: this.nextId++,
      key,
      op,
      enqueuedAt: at,
      attempts: 0,
      payload,
    }
    this.items.push(task)
    return task
  }

  /** 出队（取最早入队的一条；空队列 → undefined） */
  dequeue(): SyncTask | undefined {
    return this.items.shift()
  }

  /**
   * 重试：把一条任务放回**队尾**并累加尝试次数（而不是插回队首）。
   * 插回队首会在持续失败时把后面正常的键全部饿死；放队尾则让其它键先走一轮。
   */
  retry(task: SyncTask): SyncTask {
    const next: SyncTask = { ...task, attempts: task.attempts + 1 }
    this.items.push(next)
    return next
  }

  /** 清空队列（返回被丢弃的任务数，便于日志与断言） */
  clear(): number {
    const dropped = this.items.length
    this.items = []
    return dropped
  }

  /** 队首任务（不取出；诊断用） */
  peek(): SyncTask | undefined {
    return this.items[0]
  }

  /** 当前排队数 */
  get size(): number {
    return this.items.length
  }

  /** 是否为空 */
  get isEmpty(): boolean {
    return this.items.length === 0
  }

  /** 队列快照（只读拷贝；测试与诊断用，避免外部改到内部数组） */
  toArray(): SyncTask[] {
    return this.items.map((task) => ({ ...task }))
  }

  /** 序列化（Cloud-4 队列持久化）：刷新 / 关标签 / 重启后据此接着推 */
  serialize(): SerializedQueue {
    return { nextId: this.nextId, items: this.items.map((task) => ({ ...task })) }
  }

  /**
   * 从快照恢复（Cloud-4）：
   * - 逐条做**形状守卫**（坏数据宁可丢掉也不能让队列带着脏条目跑）；
   * - 同一个键**只保留一条**（恢复时与运行中同一口径：一份数据推两次没有意义）；
   * - `nextId` 取「快照值」与「已有最大 id + 1」的较大者，保证新任务 id 不撞。
   */
  restore(snapshot: SerializedQueue | null): number {
    this.items = []
    this.nextId = 1
    if (!snapshot || !Array.isArray(snapshot.items)) return 0

    const seen = new Set<string>()
    for (const raw of snapshot.items) {
      const task = normalizeTask(raw)
      if (!task) continue
      const identity = `${task.op}:${task.key}`
      if (seen.has(identity)) continue
      seen.add(identity)
      this.items.push(task)
    }
    const maxId = this.items.reduce((max, task) => Math.max(max, task.id), 0)
    this.nextId = Math.max(snapshot.nextId ?? 1, maxId + 1)
    return this.items.length
  }
}

/** 恢复时的形状守卫：键名 / 操作 / 尝试次数都得像话，否则丢掉这条 */
function normalizeTask(raw: unknown): SyncTask | null {
  if (!raw || typeof raw !== 'object') return null
  const task = raw as Partial<SyncTask>
  if (typeof task.key !== 'string' || !task.key) return null
  const op: SyncOp = task.op === 'pull' ? 'pull' : 'push'
  const attempts = typeof task.attempts === 'number' && task.attempts >= 0 ? task.attempts : 0
  return {
    id: typeof task.id === 'number' && task.id > 0 ? task.id : 0,
    key: task.key,
    op,
    enqueuedAt: typeof task.enqueuedAt === 'number' ? task.enqueuedAt : 0,
    attempts,
    payload: task.payload,
  }
}
