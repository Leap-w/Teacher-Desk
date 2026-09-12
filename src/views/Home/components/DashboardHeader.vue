<script setup lang="ts">
import { computed } from 'vue'

import { useToday } from '@/composables/useToday'
import { formatDateOnly, formatWeekdayLabel } from '@/utils/date'

/**
 * 首页头部（V1.3.0）：大标题「今日」+ 副标题（日期 · 星期 · 问候）。
 * 日期全部来自 `useToday()`（30 秒刷新一次，跨零点自动更新），不写死任何日期。
 */
const { now, greeting } = useToday()

const dateLabel = computed(() => formatDateOnly(now.value))
const weekdayLabel = computed(() => formatWeekdayLabel(now.value))
</script>

<template>
  <!-- V5.2 页面头：56–64px 特粗标题 + 16px 副标题 + 底部细线 -->
  <header class="dash-header">
    <h1 class="dash-header__title">今日</h1>
    <p class="dash-header__sub">
      {{ dateLabel }} {{ weekdayLabel }} · {{ greeting }}，今天也一起把班级管理做好。
    </p>
  </header>
</template>

<style scoped>
.dash-header {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: 0 4px var(--spacing-lg);
  margin-bottom: var(--spacing-xl);
  border-bottom: 1px solid var(--color-border);
}

.dash-header__title {
  font-size: var(--font-page-title);
  font-weight: var(--font-weight-bold);
  line-height: var(--leading-tight);
  letter-spacing: -0.02em;
  color: var(--color-text-primary);
}

.dash-header__sub {
  font-size: var(--font-content);
  color: var(--color-text-secondary);
}
</style>
