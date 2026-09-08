<script setup lang="ts">
import { storeToRefs } from 'pinia'

import { AppButton } from '@/components/ui'
import { useAppStore } from '@/stores/app'
import { useToday } from '@/composables/useToday'

const appStore = useAppStore()
const { syncing, lastSyncedAt } = storeToRefs(appStore)
const { todayLabel } = useToday()
</script>

<template>
  <header class="app-header">
    <RouterLink to="/" class="brand">
      <span class="brand-mark" aria-hidden="true">T</span>
      <span class="brand-name">TeacherDesk</span>
    </RouterLink>

    <div class="flex items-center gap-4">
      <span v-if="lastSyncedAt" class="header-synced">已同步 {{ lastSyncedAt }}</span>
      <span class="header-date">{{ todayLabel }}</span>
      <AppButton size="sm" :loading="syncing" @click="appStore.sync()">
        {{ syncing ? '同步中…' : '同步' }}
      </AppButton>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  flex-shrink: 0;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 clamp(20px, 3vw, 36px);
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-bottom: 1px solid var(--color-border);
  z-index: 10;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 10px;
  transition: background var(--transition-fast);
}

.brand:hover {
  background: rgba(29, 29, 31, 0.04);
}

.brand-mark {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  background: linear-gradient(135deg, var(--color-secondary), var(--color-primary));
  color: #ffffff;
  font-size: 15px;
  font-weight: 700;
  box-shadow: var(--shadow-sm);
}

.brand-name {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.2px;
  background: linear-gradient(
    120deg,
    var(--color-primary-strong),
    var(--color-primary),
    var(--color-secondary)
  );
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.header-date {
  font-size: 13px;
  color: var(--color-text-secondary);
}

.header-synced {
  font-size: 12px;
  color: var(--color-text-secondary);
}

@media (max-width: 760px) {
  .header-date,
  .header-synced {
    display: none;
  }
}
</style>
