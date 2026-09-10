<script setup lang="ts">
import { computed } from 'vue'

import { useToday } from '@/composables/useToday'
import { formatDateOnly, formatWeekdayLabel } from '@/utils/date'

/**
 * 工作台头部（Phase 4）：日期 / 星期 / 一句问候。
 * 日期全部来自 `useToday()`（30 秒刷新一次，跨零点自动更新），不写死任何日期。
 */
const { now, greeting } = useToday()

const dateLabel = computed(() => formatDateOnly(now.value))
const weekdayLabel = computed(() => formatWeekdayLabel(now.value))
</script>

<template>
  <header class="dash-header">
    <h1 class="dash-date">{{ dateLabel }}</h1>
    <p class="dash-weekday">{{ weekdayLabel }}</p>
    <p class="dash-motto">{{ greeting }}，今天也一起把班级管理做好。</p>
  </header>
</template>

<style scoped>
.dash-header {
  margin-bottom: var(--space-5);
}

.dash-date {
  font-size: var(--text-xl);
  font-weight: 700;
  letter-spacing: -0.4px;
  color: var(--color-text);
}

.dash-weekday {
  margin-top: var(--space-1);
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--color-primary-strong);
}

.dash-motto {
  margin-top: var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}
</style>
