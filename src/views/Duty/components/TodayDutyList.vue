<script setup lang="ts">
import { Paintbrush } from 'lucide-vue-next'

import { EmptyState } from '@/components/ui'
import type { DutyMember } from '@/types/duty'
import DutyCard from './DutyCard.vue'

/**
 * TodayDutyList — 今日值日名单（V2.0.6-alpha · Phase UI-4D）：
 * 今日组成员卡片流（StudentCard 风格）；无组员给 EmptyState 引导去加人。
 */
defineProps<{
  members: DutyMember[]
  groupName: string
}>()
</script>

<template>
  <div v-if="members.length" class="today-list">
    <DutyCard v-for="member in members" :key="member.id" :member="member" :group-name="groupName" />
  </div>
  <div v-else class="today-empty">
    <EmptyState
      :icon="Paintbrush"
      title="这个组还没有组员"
      description="去下方「值日组」卡片里编辑成员。"
    />
  </div>
</template>

<style scoped>
.today-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-3);
}

.today-empty {
  padding: var(--space-4) 0;
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
}
</style>
