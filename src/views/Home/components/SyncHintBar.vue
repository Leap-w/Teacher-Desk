<script setup lang="ts">
import { RefreshCw } from 'lucide-vue-next'

import { useSyncEngine } from '@/composables/useSyncEngine'

/**
 * SyncHintBar — 同步提示条（V2.2.1-alpha · Phase Cloud-2）。
 *
 * 只读 `SyncState`：有排队改动 / 同步中 / 同步失败时提示一句；
 * **本地模式（默认）与已同步不显示**——不打扰是这一层的设计目标。
 * 不提供任何按钮（同步动作由引擎与未来的设置页驱动）。
 */
const { hint } = useSyncEngine()
</script>

<template>
  <p v-if="hint" class="sync-hint" role="status">
    <RefreshCw class="sync-hint__icon" :size="14" :stroke-width="2" aria-hidden="true" />
    {{ hint }}
  </p>
</template>

<style scoped>
.sync-hint {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  padding: 6px 12px;
  border-radius: var(--radius-full);
  background: var(--color-warning-soft);
  color: var(--color-warning-strong);
  font-size: var(--font-caption);
  font-weight: var(--font-weight-medium);
}

.sync-hint__icon {
  animation: sync-hint-spin 1.4s linear infinite;
}

@keyframes sync-hint-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
