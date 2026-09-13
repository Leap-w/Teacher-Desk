<script setup lang="ts">
import { Users, CalendarDays, Tag } from 'lucide-vue-next'

/**
 * ProfileStats — Hero 下方工作信息条（V2.1.0-beta · Phase UI-5C）：
 * 班级人数 / 本周课时 / 当前版本。全部真实数据（Store 与构建期注入）。
 */
defineProps<{
  studentCount: number
  weekLessons: number
  version: string
}>()
</script>

<template>
  <div class="profile-stats">
    <div class="stat">
      <span class="stat-icon" aria-hidden="true"><Users :size="16" :stroke-width="2" /></span>
      <span class="stat-value">{{ studentCount }}</span>
      <span class="stat-label">班级人数</span>
    </div>
    <div class="stat">
      <span class="stat-icon" aria-hidden="true"
        ><CalendarDays :size="16" :stroke-width="2"
      /></span>
      <span class="stat-value">{{ weekLessons }}</span>
      <span class="stat-label">本周课时</span>
    </div>
    <div class="stat">
      <span class="stat-icon" aria-hidden="true"><Tag :size="16" :stroke-width="2" /></span>
      <span class="stat-value stat-value--text">{{ version }}</span>
      <span class="stat-label">当前版本</span>
    </div>
  </div>
</template>

<style scoped>
.profile-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-fill-disabled);
}

.stat-icon {
  color: var(--color-primary-strong);
  margin-bottom: 2px;
}

.stat-value {
  font-size: 22px;
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
  line-height: var(--leading-tight);
}

.stat-value--text {
  font-size: var(--font-secondary);
  padding-top: 4px;
}

.stat-label {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}
</style>
