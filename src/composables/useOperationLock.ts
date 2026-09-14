/**
 * 长事务调用入口（V2.3.1-rc · Phase RC-1）。
 *
 * 导入弹窗、批量修改这类「一次写很多键」的操作一律用这里的 `runLockedOperation()` 包住：
 *
 * ```ts
 * const outcome = await runLockedOperation('seat-import', () => seatStore.applySeatImport(...))
 * ```
 *
 * 它做三件事，顺序不能变：
 * 1. `begin` 上锁 → 自动同步在此期间只记账、不推送（RC-01）；
 * 2. `await nextTick()` 后再解锁 —— **这一步是关键**：store 的写盘广播是 Vue 异步 watcher，
 *    不等到它跑完就解锁，脏键会正好落在「锁外」，导入中途还是会被推上云；
 * 3. 解锁后立刻 `flush()`（RC-02）：导入成功即自动同步一次，教师不用再点「立即同步」。
 *
 * 用 `try/finally` 保证「解锁」与「冲刷」一定发生——即使写入抛错也不会留一把死锁
 * 把自动同步永久停掉（那会让云端悄悄落后，比报错更难查）。
 */
import { nextTick } from 'vue'

import { flushAfterOperation, operationLock } from '@/sync'

/**
 * 在长事务锁里执行一次操作。
 *
 * @param name 操作名（诊断与测试用，如 `seat-import` / `student-import` / `student-batch`）
 * @param action 真正写数据的那段（同步或异步都可以）
 * @returns `action` 的返回值
 */
export async function runLockedOperation<T>(
  name: string,
  action: () => T | Promise<T>,
): Promise<T> {
  operationLock.begin(name)
  try {
    return await action()
  } finally {
    // 等本批写盘广播（Vue watcher）跑完再解锁，否则脏键会跑到锁外
    await nextTick()
    operationLock.end(name)
    // 解锁后立刻补一次冲刷：队列空则什么都不做（本地模式不会被误标成「已同步」）
    void flushAfterOperation()
  }
}
