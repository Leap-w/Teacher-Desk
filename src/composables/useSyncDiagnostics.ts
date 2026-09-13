/**
 * 同步诊断桥（V2.2.3-alpha · Phase Cloud-4）。
 *
 * **Observable Sync 规范**：任何同步问题都要能通过「当前状态 / 队列长度 / 最近同步时间 /
 * 最近错误 / 当前通道」定位，而不是去翻控制台。本 composable 就是那五个数字的唯一来源。
 *
 * 只读：不改队列、不触发同步（诊断界面点一下不该改变被诊断的对象）。
 */
import { computed, onScopeDispose, ref } from 'vue'

import { SYNC_QUEUE_STORAGE_KEY } from '@/repositories'
import { activeTransport } from '@/sync/transportRegistry'
import { syncEngine } from '@/sync/SyncEngine'
import { hasActiveTransport } from '@/sync/transportRegistry'
import { cloudSyncState } from '@/services/cloudSync'
import { isCloudConfigured } from '@/services/cloudbase'

/** 通道标识 → 界面文案 */
function transportLabel(): string {
  if (!isCloudConfigured()) return '未配置（本地模式）'
  const active = activeTransport()
  if (!active) return '未接入'
  return active.kind === 'cloud' ? '云通道（CloudBase）' : '模拟通道'
}

export function useSyncDiagnostics() {
  const snapshot = ref(syncEngine.snapshot())
  const outbox = ref(syncEngine.outbox())

  /** 队列变化（入队 / 成功 / 失败 / 状态迁移）都只通过引擎事件到达界面 */
  const off = syncEngine.on(() => {
    snapshot.value = syncEngine.snapshot()
    outbox.value = syncEngine.outbox()
  })
  onScopeDispose(off)

  const state = computed(() => snapshot.value.state)
  const pending = computed(() => snapshot.value.pending)
  const pendingKeys = computed(() => outbox.value.map((entry) => entry.key))
  const lastSyncedAt = computed(() => snapshot.value.lastSyncedAt)
  const lastError = computed(() => snapshot.value.lastError ?? cloudSyncState.value.error)
  const succeeded = computed(() => snapshot.value.succeeded)
  const failed = computed(() => snapshot.value.failed)
  const transport = computed(() => transportLabel())
  const connected = computed(() => hasActiveTransport())
  const account = computed(() => cloudSyncState.value.account)
  const cloudStatus = computed(() => cloudSyncState.value.status)
  const queueKey = computed(() => SYNC_QUEUE_STORAGE_KEY)

  /** 最近同步时间（可读文案；从未同步过为 null） */
  const lastSyncedText = computed(() => {
    const at = lastSyncedAt.value
    if (at === null) return null
    const date = new Date(at)
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  })

  /** 开发模式默认展开详情；正式版默认折叠（一行摘要足够定位） */
  const isDev = import.meta.env.DEV

  const summary = computed(() => {
    if (!isCloudConfigured()) return '本地模式（未配置云环境）'
    // 未登录同样是本地模式：不能报「已与云端对齐」（那是没登录时的假象）
    if (account.value === null) return '本地模式（未登录云端）'
    if (pending.value > 0) return `${pending.value} 项等待同步`
    if (state.value === 'error') return '同步失败'
    if (state.value === 'syncing') return '正在同步'
    return '已与云端对齐'
  })

  return {
    state,
    pending,
    pendingKeys,
    outbox,
    lastSyncedAt,
    lastSyncedText,
    lastError,
    succeeded,
    failed,
    transport,
    connected,
    account,
    cloudStatus,
    queueKey,
    isDev,
    summary,
  }
}
