/**
 * 同步队列仓储（V2.2.3-alpha · Phase Cloud-4）。
 *
 * 数据源：`teacherdesk:sync-queue`——**队列的持久化落点**（刷新 / 关标签 / 重启后可恢复）。
 *
 * 三点纪律（与 Cloud-1 起的 Repository 约定一致）：
 * 1. **不进同步注册表**：队列是本机的待办记录，不是教师的数据——它既不该被推到云端，
 *    也不该参与「最后写入胜出」（所以走仓储读写，但不注册 `bind`）；
 * 2. **单个对象包成单元素数组**：对齐备份模块「一个键 = 一个数组」的既有形状；
 * 3. **读不出来按空处理**：坏掉的队列只丢待同步记录，不影响任何业务数据（下一次
 *    数据改动还会重新入队），绝不因为队列坏了让应用打不开。
 */
import { appConfig } from '@/config'
import type { SerializedQueue } from '@/sync/types'

import { localStorageAdapter } from '../adapters/LocalStorageAdapter'
import { createCollectionRepository } from '../base/createCollectionRepository'

const SYNC_QUEUE_KEY = `${appConfig.storageKeyPrefix}:sync-queue`

/** 队列键名（诊断界面展示用） */
export const SYNC_QUEUE_STORAGE_KEY = SYNC_QUEUE_KEY

/** 单元素数组里那一条的形状守卫：坏数据当空 */
function reviveQueue(raw: unknown[]): SerializedQueue | null {
  const entry = raw[0]
  if (!entry || typeof entry !== 'object') return null
  const candidate = entry as Partial<SerializedQueue>
  if (!Array.isArray(candidate.items)) return null
  return {
    nextId: typeof candidate.nextId === 'number' && candidate.nextId > 0 ? candidate.nextId : 1,
    items: candidate.items as SerializedQueue['items'],
  }
}

const repository = createCollectionRepository<SerializedQueue | null>({
  key: SYNC_QUEUE_KEY,
  adapter: localStorageAdapter,
  reviveList: reviveQueue,
})

export const syncQueueRepository = {
  /** 读队列快照；没有 / 坏了 → null（按空队列处理） */
  load(): SerializedQueue | null {
    try {
      return repository.load()
    } catch (error) {
      console.warn('[sync] 同步队列读不出来，按空队列处理：', error)
      return null
    }
  },

  /** 写队列快照（空队列也写：一次写盘相当于「这里没有待办了」的记事） */
  save(snapshot: SerializedQueue): void {
    try {
      localStorageAdapter.writeJSON(SYNC_QUEUE_KEY, [snapshot])
    } catch (error) {
      // 写盘失败只告警：队列在内存里照常工作，最坏结果是这次刷新后少补一次推送
      console.warn('[sync] 同步队列写盘失败（队列仍在内存里工作）：', error)
    }
  },

  /** 清掉盘上的队列记录（登出 / 手动清空时用） */
  clear(): void {
    try {
      localStorageAdapter.writeJSON(SYNC_QUEUE_KEY, [])
    } catch (error) {
      console.warn('[sync] 同步队列清除失败：', error)
    }
  },
}
