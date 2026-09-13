<script lang="ts">
/** 班级概览统计（全部来自真实 Store） */
export interface ClassSummary {
  total: number
  male: number
  female: number
  cadre: number
}
</script>

<script setup lang="ts">
import { Users } from 'lucide-vue-next'

import { useUserStore } from '@/stores/user'
import StudentSummaryItem from './StudentSummaryItem.vue'

/**
 * StudentSummary — 班级概览（V2.0.3-alpha · Phase UI-4A 沉淀）：
 * 全班 / 男生 / 女生 / 班委人数；数据来自 Student Store 真实统计。
 * 学生档案、值日、周末管理等模块可直接复用。
 */
defineProps<{
  summary: ClassSummary
}>()

const userStore = useUserStore()
</script>

<template>
  <div class="summary-card">
    <div class="summary-head">
      <Users :size="16" :stroke-width="2" aria-hidden="true" />
      <span>{{ userStore.profile.className }} · 班级概览</span>
    </div>
    <div class="summary-grid">
      <StudentSummaryItem label="全班" :value="summary.total" />
      <StudentSummaryItem label="男生" :value="summary.male" />
      <StudentSummaryItem label="女生" :value="summary.female" />
      <StudentSummaryItem label="班委" :value="summary.cadre" />
    </div>
  </div>
</template>

<style scoped>
.summary-card {
  padding: var(--spacing-card);
  background: var(--color-bg-subtle);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
}

.summary-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: var(--space-3);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
}

.summary-head svg {
  color: var(--color-primary-dark);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-2);
}
</style>
