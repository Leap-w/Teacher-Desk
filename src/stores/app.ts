import { ref } from 'vue'
import { defineStore } from 'pinia'

import { formatClock } from '@/utils/date'

/** 全局应用状态（Phase 0：仅同步占位逻辑，后续接入真实后端） */
export const useAppStore = defineStore('app', () => {
  const syncing = ref(false)
  const lastSyncedAt = ref<string | null>(null)

  /** 模拟同步，Phase 9（后端接入）替换为真实 API 调用 */
  function sync() {
    if (syncing.value) return
    syncing.value = true
    window.setTimeout(() => {
      syncing.value = false
      lastSyncedAt.value = formatClock(new Date())
    }, 1200)
  }

  return { syncing, lastSyncedAt, sync }
})
