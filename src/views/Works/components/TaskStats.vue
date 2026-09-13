<script setup lang="ts">
import { CalendarCheck, CalendarClock, CalendarX2, ListTodo } from 'lucide-vue-next'

import DashboardStatCard from '@/components/dashboard/DashboardStatCard.vue'
import type { WorkSummary } from '@/utils/work'

/**
 * TaskStats — 任务统计（V2.0.9-alpha · Phase UI-5B）：
 * 四张真实统计（workStore.summary）：今日待办 / 今日已完成 / 本周剩余 / 逾期。
 * 统计卡复用 DashboardStatCard（UI-3 沉淀），零新样式。
 */
defineProps<{
  summary: WorkSummary
}>()
</script>

<template>
  <div class="task-stats">
    <DashboardStatCard
      :icon="ListTodo"
      :value="summary.todayOpen"
      label="今日待办"
      hint="归属今天或更早且未完成"
    />
    <DashboardStatCard
      :icon="CalendarCheck"
      :value="summary.todayDone"
      label="今日已完成"
      hint="今天归属日期已完成"
    />
    <DashboardStatCard
      :icon="CalendarClock"
      :value="summary.weekOpen"
      label="本周剩余"
      hint="明天起到本周日"
    />
    <DashboardStatCard
      :icon="CalendarX2"
      :value="summary.overdue"
      label="逾期未完成"
      hint="归属日期早于今天"
    />
  </div>
</template>

<style scoped>
.task-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-3);
}

@media (max-width: 960px) {
  .task-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
