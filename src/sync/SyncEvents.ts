/**
 * 同步事件（V2.2.1-alpha · Phase Cloud-2）。
 *
 * 极简发布/订阅：引擎在关键节点 emit，UI（同步徽章 / 提示条）与诊断日志 subscribe。
 * **本阶段只在本地触发**——没有网络，也没有跨设备事件。
 *
 * 事件命名与载荷有意保持扁平（`sync:start` / `sync:success` / `sync:error` / `sync:retry`），
 * 后续接 CloudBase 时新增的事件（如 `sync:conflict`）直接追加，不改既有载荷形状。
 */
import type { SyncTask } from './types'

export type SyncEventName =
  'sync:start' | 'sync:success' | 'sync:error' | 'sync:retry' | 'sync:enqueue' | 'sync:state'

export interface SyncEventPayload {
  /** 事件时间（毫秒时间戳） */
  at: number
  /** 相关任务（状态类事件可不带） */
  task?: SyncTask
  /** 任务键（便于按模块筛选日志） */
  key?: string
  /** 附加说明（错误文案 / 重试次数等） */
  message?: string
}

export type SyncEventListener = (name: SyncEventName, payload: SyncEventPayload) => void

export class SyncEvents {
  private readonly listeners = new Set<SyncEventListener>()

  /** 订阅；返回取消订阅函数 */
  on(listener: SyncEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 广播（监听器抛错不影响其它监听器——同步不该被某个订阅方带崩） */
  emit(name: SyncEventName, payload: SyncEventPayload): void {
    for (const listener of this.listeners) {
      try {
        listener(name, payload)
      } catch (error) {
        console.warn(`[sync] 事件监听器处理 ${name} 出错（已忽略）：`, error)
      }
    }
  }

  /** 清空订阅（测试与卸载时用） */
  clear(): void {
    this.listeners.clear()
  }

  /** 当前订阅数（诊断 / 测试用） */
  get size(): number {
    return this.listeners.size
  }
}
