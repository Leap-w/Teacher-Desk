/**
 * 云端传输实现（V2.2.2-alpha · Phase Cloud-3 核心）。
 *
 * 把 `services/cloudSync.ts`（真实 CloudBase 通道：登录 / 拉全量 / 单键推 / LWW 记账）
 * 适配成 `SyncTransport`——**这就是 Sync Engine First 那个接缝**：
 * 引擎只管排队、重试、状态、冲突；网络、鉴权、集合、记账全在通道这一侧。
 *
 * 遵守既有契约（`push` / `pull`），另外实现三个通道专属能力：
 * - `connect()`    确认会话（未登录 → 不可重试的失败，引擎不会白重试）
 * - `disconnect()` 登出并清记账
 * - `sync()`       整轮对账（拉全量 → 按记账裁决 → 推脏键 / 采纳远端，含首次同步保护）
 *
 * **本文件是本模块唯一允许 import 云服务的地方**；`src/sync` 的其它文件保持零云依赖。
 */
import { isCloudConfigured } from '@/services/cloudbase'
import {
  isCloudReady,
  probeFirstSync,
  pullKeyNow,
  pushAllLocalNow,
  pushKeyNow,
  signInAndSync,
  signOutAndStop,
  syncNow,
  cloudSyncState,
  type FirstSyncSituation,
} from '@/services/cloudSync'

import type { SyncTask, SyncTransport, TransportOutcome } from './types'

export interface CloudTransport extends SyncTransport {
  /** 确认会话可用（配了环境 ID 且已登录）；未就绪时给出可读原因 */
  connect(): Promise<TransportOutcome>
  /** 登出并清掉本机对齐记账 */
  disconnect(): Promise<TransportOutcome>
  /** 整轮对账（引擎的 runCycle 走这条） */
  sync(): Promise<TransportOutcome>
  /** 首次同步处境（「是否用本机数据初始化云端」的判定） */
  firstSyncSituation(): Promise<FirstSyncSituation>
  /** 用本机数据初始化云端（教师在确认弹窗里选「初始化」后调用） */
  initializeFromLocal(): Promise<{ pushed: number; failed: number }>
  /** 账号（用户名）+ 密码登录（登录弹窗走这条） */
  signIn(username: string, password: string): Promise<void>
  /** 当前账号（未登录为 null） */
  account(): string | null
}

/** 把整轮同步之后的共享状态映射成传输结果 */
function outcomeFromCycle(before: number | null): TransportOutcome {
  const status = cloudSyncState.value.status
  if (status === 'idle') {
    return { ok: true, at: cloudSyncState.value.lastSyncedAt ?? before ?? Date.now() }
  }
  if (status === 'disabled') {
    return { ok: false, error: '未配置云环境', retryable: false }
  }
  if (status === 'signedOut') {
    return { ok: false, error: '未登录云端', retryable: false }
  }
  const error = cloudSyncState.value.error ?? '同步失败'
  return { ok: false, error, retryable: status === 'offline' }
}

export function createCloudTransport(): CloudTransport {
  return {
    kind: 'cloud',

    async push(task: SyncTask): Promise<TransportOutcome> {
      if (!isCloudReady()) {
        return { ok: false, error: '未登录云端', retryable: false }
      }
      try {
        const outcome = await pushKeyNow(task.key)
        if (outcome.ok) return { ok: true, at: Date.now() }
        return { ok: false, error: outcome.error, retryable: outcome.retryable }
      } catch (error) {
        // 通道本身抛错（SDK 异常等）：按可重试处理，让队列按上限退避重试
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false, error: message, retryable: true }
      }
    },

    async pull(key: string): Promise<TransportOutcome> {
      if (!isCloudReady()) {
        return { ok: false, error: '未登录云端', retryable: false }
      }
      try {
        const doc = await pullKeyNow(key)
        // 云端没有这个键也是「拉取成功」：内容为空不是错误
        return { ok: true, at: doc?.updatedAt ?? Date.now() }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false, error: message, retryable: true }
      }
    },

    async sync(): Promise<TransportOutcome> {
      if (!isCloudConfigured()) {
        return { ok: false, error: '未配置云环境', retryable: false }
      }
      const before = cloudSyncState.value.lastSyncedAt
      try {
        await syncNow()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false, error: message, retryable: true }
      }
      return outcomeFromCycle(before)
    },

    async connect(): Promise<TransportOutcome> {
      if (!isCloudConfigured()) {
        return { ok: false, error: '未配置云环境', retryable: false }
      }
      // 整轮同步会顺手确认会话（未登录时状态置 signedOut，不报错）
      const outcome = await this.sync()
      if (outcome.ok) return outcome
      if (!isCloudReady()) return { ok: false, error: '未登录云端', retryable: false }
      return outcome
    },

    async disconnect(): Promise<TransportOutcome> {
      try {
        await signOutAndStop()
        return { ok: true, at: Date.now() }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false, error: message, retryable: false }
      }
    },

    firstSyncSituation(): Promise<FirstSyncSituation> {
      return probeFirstSync()
    },

    initializeFromLocal(): Promise<{ pushed: number; failed: number }> {
      return pushAllLocalNow()
    },

    async signIn(username: string, password: string): Promise<void> {
      await signInAndSync(username, password)
    },

    account(): string | null {
      return cloudSyncState.value.account
    },
  }
}
