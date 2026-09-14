/**
 * 统一操作锁（V2.3.1-rc · Phase RC-1 · RC-01）。
 *
 * **要解决的问题**：Excel 导入、批量修改这类「一口气写几百个座位 / 几十个学生」的操作，
 * 会和自动同步抢同一个键——导入写到一半，同步把中间态推上云；批次还没写完，
 * 队列已经跑了两轮。教师看到的结果是「云端是我改到一半的样子」。
 *
 * **做法**：任何长事务在开始时 `begin(name)`、结束时 `end(name)`；锁住期间自动同步
 * **不收脏键**，而是把它们记在 `deferKey()` 的待办里；最后一个操作结束时一次性
 * 交给调度层入队并冲刷（RC-02 的「导入完成自动同步」就是这条路径，不需要教师手动点）。
 *
 * 三条纪律：
 * 1. **可嵌套**：同名 / 不同名重复 `begin` 用计数，最后一个 `end` 才真正解锁——
 *    导入弹窗里再嵌一次批量修改也不会提前解锁；
 * 2. **不留脏锁**：调用方一律用 `composables/useOperationLock.ts` 的 `runLockedOperation()`
 *    包（内部 `try/finally`），漏写 `end` 不会把同步永久锁死；
 * 3. **不碰 UI**：锁是纯粹的调度信号，不弹窗、不禁用按钮、不阻塞界面。
 *
 * 本文件是**纯逻辑**（不 import Vue、不 import 引擎、不 import 云模块），
 * 因此能在 node 测试里直接构造与断言。
 */

/** 解锁时要处理的事情：待补推的键（去重、保持首次出现顺序） */
export type OperationUnlockListener = (deferredKeys: string[]) => void

export class OperationLock {
  /** 进行中的操作：名字 → 嵌套层数 */
  private readonly active = new Map<string, number>()
  /** 锁住期间被拦下的脏键（有顺序、不重复） */
  private readonly deferred = new Set<string>()
  private readonly listeners = new Set<OperationUnlockListener>()

  /** 是否有操作正在进行（同步在此期间应暂停） */
  get locked(): boolean {
    return this.active.size > 0
  }

  /** 进行中的操作名（诊断 / 测试用；顺序即 begin 顺序） */
  get names(): string[] {
    return [...this.active.keys()]
  }

  /** 待补推的键（只读快照） */
  get deferredKeys(): string[] {
    return [...this.deferred]
  }

  /** 开始一次操作；返回该操作的嵌套层数（1 = 最外层） */
  begin(name: string): number {
    const depth = (this.active.get(name) ?? 0) + 1
    this.active.set(name, depth)
    return depth
  }

  /**
   * 结束一次操作。返回是否**已完全解锁**。
   * 完全解锁时把待补推的键交给订阅者（调度层据此入队 + 冲刷）。
   * 对没锁过的名字调用是幂等的：不抛错，也不触发解锁通知。
   */
  end(name: string): boolean {
    const depth = this.active.get(name) ?? 0
    if (depth === 0) return !this.locked

    if (depth <= 1) this.active.delete(name)
    else this.active.set(name, depth - 1)

    if (this.locked) return false

    const keys = this.takeDeferred()
    for (const listener of [...this.listeners]) listener(keys)
    return true
  }

  /**
   * 锁住时把脏键记下来。返回 `true` = **已接管**（调用方不要再入队），
   * 未锁时返回 `false`（走的还是原来的快通道）。
   */
  deferKey(key: string): boolean {
    if (!this.locked) return false
    this.deferred.add(key)
    return true
  }

  /** 取出并清空待补推的键 */
  takeDeferred(): string[] {
    const keys = [...this.deferred]
    this.deferred.clear()
    return keys
  }

  /** 订阅「完全解锁」；返回退订函数 */
  onUnlock(listener: OperationUnlockListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 仅供测试：清空锁与订阅 */
  reset(): void {
    this.active.clear()
    this.deferred.clear()
    this.listeners.clear()
  }
}

/** 运行时单例：导入弹窗、批量修改与自动同步共用这一个 */
export const operationLock = new OperationLock()
