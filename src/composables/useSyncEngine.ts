/**
 * 同步状态桥（V2.2.1-alpha · Phase Cloud-2）。
 *
 * 把 `SyncEngine` 的状态机变成响应式：UI 只读 `state` / `label` / `pending` / `hint`，
 * **不新增任何交互**（没有同步按钮，也不触发同步动作）。
 *
 * 与 `useCloudSync` 的分工：后者管「真实的云端登录 + 手动同步」（既有能力，不动），
 * 本 composable 只暴露同步引擎的状态快照——Cloud-3 接通后，两者由引擎统一驱动。
 */
import { computed, onScopeDispose, ref } from 'vue'

import { SyncState, syncEngine } from '@/sync'

/** 状态 → 界面文案（唯一一份映射，避免各页面各写一套） */
const STATE_LABELS: Record<SyncState, string> = {
  [SyncState.LocalOnly]: '本地模式',
  [SyncState.SyncPending]: '待同步',
  [SyncState.Syncing]: '同步中',
  [SyncState.Synced]: '已同步',
  [SyncState.Error]: '同步失败',
}

export function useSyncEngine(engine = syncEngine) {
  const snapshot = ref(engine.snapshot())

  const refresh = (): void => {
    snapshot.value = engine.snapshot()
  }

  // 状态变化经引擎事件回流（引擎是纯 TS，不认识 Vue）
  const off = engine.on(() => refresh())
  onScopeDispose(off)

  const state = computed(() => snapshot.value.state)
  const label = computed(() => STATE_LABELS[snapshot.value.state])
  const pending = computed(() => snapshot.value.pending)
  const lastError = computed(() => snapshot.value.lastError)

  /** 界面提示文案：只有「需要注意」的状态才给可读提示（本地模式/已同步返回空串） */
  const hint = computed(() => {
    if (snapshot.value.state === SyncState.SyncPending) {
      return `有 ${snapshot.value.pending} 项改动等待同步`
    }
    if (snapshot.value.state === SyncState.Syncing) return '正在同步…'
    if (snapshot.value.state === SyncState.Error) {
      return snapshot.value.lastError ? `同步失败：${snapshot.value.lastError}` : '同步失败'
    }
    return ''
  })

  /** 是否处于「本地模式」（未启用同步的常态） */
  const isLocalOnly = computed(() => snapshot.value.state === SyncState.LocalOnly)

  return { state, label, pending, lastError, hint, isLocalOnly, refresh, snapshot }
}
