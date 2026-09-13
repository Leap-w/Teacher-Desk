/**
 * LocalStorage 数据源适配器（V2.2.0-alpha · Phase Cloud-1）。
 *
 * 纯委托：每个方法 1:1 转发到 `services/storage.ts`（全应用唯一写盘点）与
 * `services/sync.ts` 的 `syncPersisted`（写盘 + 跨标签页广播 + 云端同步注册表）。
 * **不改任何语义**——幂等写、损坏降级、播种基线登记、最后写入胜出的记账，
 * 全部沿用既有实现；本层只是把它们装进 `DataSourceAdapter` 的形状，
 * 让 Repository 与 Store 从此不认识「localStorage」这个词。
 */
import type { Ref } from 'vue'

import {
  localStoragePort,
  readList,
  readRaw,
  writeJSON as storageWriteJSON,
  writeSeedJSON,
} from '@/services/storage'
import { syncPersisted } from '@/services/sync'

import type { DataSourceAdapter } from '../base/types'

export const localStorageAdapter: DataSourceAdapter = {
  kind: 'local-storage',

  readRaw(key) {
    return readRaw(key)
  },

  readList(key) {
    return readList(key)
  },

  writeJSON(key, value) {
    return storageWriteJSON(key, value)
  },

  remove(key) {
    localStoragePort.remove(key)
  },

  writeSeed(key, value) {
    writeSeedJSON(key, value)
  },

  bindCollection<T>(key: string, source: Ref<T>, revive: (raw: unknown[]) => T): void {
    syncPersisted(key, source, revive)
  },
}
