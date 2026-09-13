<script lang="ts">
/** 概览统计（全部来自真实 Store 派生，禁止假数据） */
export interface LeaveStatsData {
  /** 今日请假人数（时段与今天相交，剔除已作废） */
  todayCount: number
  /** 校外未返校人数（Store.outLeaves 同口径） */
  outCount: number
  /** 今日登记返校人数 */
  backTodayCount: number
  /** 本周累计请假人次 */
  weekCount: number
}
</script>

<script setup lang="ts">
import { CalendarDays, UserMinus, UserPlus, UsersRound } from 'lucide-vue-next'

/**
 * LeaveStats — 请假今日概览（V2.0.5-alpha · Phase UI-4C 沉淀）：
 * 四张统计卡（今日请假 / 校外未返校 / 今日返校 / 本周累计）。
 * 校外未返校用警示色数字——它才是班主任打开本页要找的数字。
 */
defineProps<{
  stats: LeaveStatsData
}>()

const CARDS = [
  {
    key: 'todayCount',
    label: '今日请假',
    icon: UsersRound,
    hint: '时段与今天相交',
    tone: 'default',
  },
  { key: 'outCount', label: '校外未返校', icon: UserMinus, hint: '需要登记返校', tone: 'alert' },
  {
    key: 'backTodayCount',
    label: '今日返校',
    icon: UserPlus,
    hint: '今天登记返校',
    tone: 'default',
  },
  {
    key: 'weekCount',
    label: '本周累计',
    icon: CalendarDays,
    hint: '本周请假人次',
    tone: 'default',
  },
] as const
</script>

<template>
  <div class="leave-stats">
    <div
      v-for="card in CARDS"
      :key="card.key"
      class="stat-card"
      :class="{ 'is-alert': card.tone === 'alert' }"
    >
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
.leave-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--card-gap);
}

@media (max-width: 900px) {
  .leave-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 480px) {
  .leave-stats {
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

.stat-card.is-alert .stat-card__icon {
  background: var(--color-warning-soft);
  color: var(--color-warning-strong);
}

.stat-card__value {
  font-size: var(--font-num-md);
  font-weight: var(--font-weight-semibold);
  line-height: 1.1;
  letter-spacing: -0.02em;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}

.stat-card.is-alert .stat-card__value {
  color: var(--color-warning-strong);
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
