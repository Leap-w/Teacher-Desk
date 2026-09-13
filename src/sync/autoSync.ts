/**
 * 自动同步调度（V2.2.2-alpha · Phase Cloud-3）。
 *
 * **Sync Engine First 的落地处**：所有触发点都只与 `SyncEngine` 打交道，
 * 通道（`CloudTransport`）由这里注册一次，之后引擎自己不知道也不需要知道云端细节。
 *
 * 四个触发点（拍板口径，§八）：
 * - **应用启动** → 一次整轮对账（把云端已有的数据拿下来）；
 * - **登录完成** → 一次整轮对账（登录表单提交后走这条）；
 * - **页面回到前台 / 重新联网** → 整轮对账（断网期间的改动在这一刻补上）；
 * - **本页写盘后（防抖 1.5s）** → 只把脏键推上去（快通道：一个键一条队列任务）。
 *
 * 两条纪律：
 * 1. **不对每次输入立刻联网**：脏键先入队，防抖窗口合并连续编辑；
 * 2. **不做回声**：整轮对账会在采纳远端数据时写盘，那次写盘不该再被当成
 *    「本地改动」推回去——所以 `cloudSyncState.status === 'syncing'` 期间不收脏键。
 */
import { isCloudConfigured } from '@/services/cloudbase'
import { cloudSyncState, isCloudReady, SYNC_DEBOUNCE_MS } from '@/services/cloudSync'
import { onSyncDirty } from '@/services/sync'

import { createCloudTransport, type CloudTransport } from './CloudTransport'
import { syncEngine } from './SyncEngine'
import { setActiveTransport } from './transportRegistry'

let transport: CloudTransport | null = null
let started = false
let debounceTimer: ReturnType<typeof setTimeout> | null = null

/** 已注册的云通道（未配置环境 ID 时为 null → 纯本地模式） */
function ensureTransport(): CloudTransport | null {
  if (!isCloudConfigured()) return null
  if (!transport) {
    transport = createCloudTransport()
    setActiveTransport(transport)
  }
  return transport
}

/** 当前云通道（未接入为 null）；UI 的登录 / 初始化入口经由它 */
export function cloudTransport(): CloudTransport | null {
  return ensureTransport()
}

/** 防抖后的队列冲刷：把这一批脏键推上云（引擎按 FIFO + 重试上限执行） */
export function scheduleFlush(delay = SYNC_DEBOUNCE_MS): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void syncEngine.flush()
  }, delay)
}

/**
 * 手动「立即同步」（Profile → 控制中心）：跑一次整轮对账。
 * 与自动触发的区别只在于「谁发起」，用的是同一条通道、同一套状态与事件。
 */
export async function syncNowManual(): Promise<void> {
  // 手动同步可能在 `startAutoSync()` 之前被调用（测试与将来的入口）：这里补一次注册，幂等
  ensureTransport()
  await runCycleGuarded()
}

/** 邮箱登录 + 立刻整轮对账（登录表单走这条） */
export async function signInAndSync(email: string, password: string): Promise<void> {
  const channel = ensureTransport()
  if (!channel) throw new Error('未配置云环境，无法登录')
  await channel.signIn(email, password)
  await syncEngine.runCycle()
}

/** 登出：清队列、回本地模式（云端数据不动） */
export async function signOutAndReset(): Promise<void> {
  const channel = ensureTransport()
  if (channel) await channel.disconnect()
  syncEngine.clear()
}

/**
 * 启动自动同步（`main.ts` 调用一次）。
 *
 * 没配环境 ID 时**什么都不注册**：本地模式是默认工作模式，
 * 引擎保持 `LocalOnly`，界面不会被同步提示打扰。
 */
export function startAutoSync(): void {
  if (started) return
  started = true

  const channel = ensureTransport()
  if (!channel) return

  // ① 应用启动：整轮对账（未登录时只是把状态问清楚，不发数据）
  void runCycleGuarded()

  // ② 本页写盘后：脏键入队 → 防抖冲刷（快通道，只推这一个键）
  onSyncDirty((key) => {
    if (!isCloudReady()) return
    // 整轮对账期间的写盘是「采纳远端」的副作用，不是教师的改动：不入队，避免回声
    if (cloudSyncState.value.status === 'syncing') return
    if (syncEngine.enqueue(key)) scheduleFlush()
  })

  // ③ 重新联网 / 回到前台：一次整轮对账（补上断网期间与后台期间的改动）
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      void runCycleGuarded()
    })
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return
      void runCycleGuarded()
    })
  }
}

/**
 * 一次整轮对账，并处理「没有账号」这处境：
 * 未登录不是同步失败——它只是「云同步没开」。所以整轮跑完后若会话仍不可用，
 * 就把引擎收回 `LocalOnly`（队列清空、不显示错误）——UI 的账号状态由通道侧如实给出。
 */
async function runCycleGuarded(): Promise<void> {
  const outcome = await syncEngine.runCycle()
  if (outcome.ok) return
  if (!isCloudReady()) syncEngine.clear()
}

/** 仅供测试：拆掉定时器与已注册通道（避免用例之间互相影响） */
export function resetAutoSyncForTest(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  transport = null
  started = false
  setActiveTransport(null)
}
