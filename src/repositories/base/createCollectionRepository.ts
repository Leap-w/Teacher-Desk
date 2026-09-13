/**
 * 集合仓储工厂（V2.2.0-alpha · Phase Cloud-1）。
 *
 * 把「一个键 + 一个列表 + 一套复活规则」装进 `CollectionRepository` 的最小实现。
 * **只提供读写原语**；「要不要播种」「播种条件是什么」这类业务判断由模块仓储
 * 在自己的 `load` 里组合（见各模块仓储文件的说明）。
 */
import { SyncStatus } from './types'
import type { CollectionRepository, DataSourceAdapter } from './types'

export interface CollectionRepositoryOptions<T> {
  key: string
  adapter: DataSourceAdapter
  /** 把盘上的原始列表规范成内存值；**首屏加载与跨标签页同步共用这一份**（§11.1） */
  reviveList: (raw: unknown[]) => T
}

export function createCollectionRepository<T>(
  options: CollectionRepositoryOptions<T>,
): CollectionRepository<T> {
  const { key, adapter, reviveList } = options

  return {
    key,
    /** Cloud-1 运行时恒 LocalOnly；Cloud-2 起由 adapter 如实上报 */
    get syncStatus(): SyncStatus {
      return SyncStatus.LocalOnly
    },

    load() {
      const list = adapter.readList(key)
      // 键不存在 → null（调用方据此播种）；损坏 → readList 已给 []，复活后仍是空值
      if (list === null) return null
      return reviveList(list)
    },

    writeSeed(value: T): T {
      adapter.writeSeed(key, value)
      return value
    },

    bind(source, revive) {
      adapter.bindCollection(key, source, revive ?? reviveList)
    },
  }
}
