<script lang="ts">
/** 课时统计（全部来自真实 Store 派生） */
export interface ScheduleStatsData {
  /** 本周总课时 */
  weekCount: number
  /** 今日课时 */
  todayCount: number
  /** 今日空课节数（全天时段数 − 今日课时） */
  freePeriods: number
}
</script>

<script setup lang="ts">
import { CalendarDays, CalendarX2, CheckCircle2 } from 'lucide-vue-next'

/**
 * ScheduleStats — 课时统计（V2.0.8-alpha · Phase UI-5A 沉淀）：
 * 本周课时 / 今日课时 / 今日空课节数；来自 Timetable Store 真实派生。
 */
defineProps<{
  stats: ScheduleStatsData
}>()

const CARDS = [
  { key: 'weekCount', label: '本周课时', icon: CalendarDays, hint: '周一到周日的总节数' },
  { key: 'todayCount', label: '今日课时', icon: CheckCircle2, hint: '今天要上的课' },
  {
    key: 'freePeriods',
    label: '今日空课',
    icon: CalendarX2,
    hint: '可用来备课批作业',
    tone: 'default',
  },
] as const
</script>

<template>
  <div class="schedule-stats">
    <div v-for="card in CARDS" :key="card.key" class="stat-card">
      <span class="stat-card__icon" aria-hidden="true">
        <component :is="card.icon" :size="20" :stroke-width="2" />
      </span>
      <span class="stat-card__value">{{ stats[card.key] }}</span>
      <span class="stat-card__label">{{ card.label }}</span>
      <span class="stat-card__hint">{{ card.hint }}</span>
    </div>
  </div>
</template>

<style scoped>
.schedule-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--card-gap);
}

@media (max-width: 640px) {
  .schedule-stats {
    grid-template-columns: minmax(0, 1fr);
  }
}

.stat-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--spacing-card);
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  transition:
    transform var(--duration-base) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out);
}

@media (hover: hover) {
  .stat-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-hover);
  }
}

.stat-card__icon {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: var(--color-primary-bg);
  color: var(--color-primary-dark);
  margin-bottom: var(--space-2);
}

.stat-card__value {
  font-size: 28px;
  font-weight: var(--font-weight-semibold);
  line-height: 1.1;
  letter-spacing: -0.02em;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}

.stat-card__label {
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
}

.stat-card__hint {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}
</style>
