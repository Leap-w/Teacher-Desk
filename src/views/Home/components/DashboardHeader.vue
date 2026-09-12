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
  <!-- CDL 首页日期横条：大号日期 + 星期，底部细线分隔（同 Changdu Memory home__date-bar） -->
  <header class="dash-header">
    <div class="dash-header__main">
      <h1 class="dash-date">{{ dateLabel }}</h1>
      <p class="dash-weekday">{{ weekdayLabel }}</p>
    </div>
    <p class="dash-motto">{{ greeting }}，今天也一起把班级管理做好。</p>
  </header>
</template>

<style scoped>
.dash-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--spacing-md);
  flex-wrap: wrap;
  padding: 0 4px 12px;
  margin-bottom: var(--spacing-lg);
  border-bottom: 1px solid var(--color-border);
}

.dash-header__main {
  display: flex;
  align-items: baseline;
  gap: var(--spacing-md);
  flex-wrap: wrap;
}

.dash-date {
  font-size: var(--font-page-title, 32px);
  line-height: 1.2;
  font-weight: var(--font-weight-bold);
  letter-spacing: -0.01em;
  color: var(--color-text-primary);
}

.dash-weekday {
  font-size: var(--font-section-title, 20px);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
}

.dash-motto {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}
</style>
