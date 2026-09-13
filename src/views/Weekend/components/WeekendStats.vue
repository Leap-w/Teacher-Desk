<script lang="ts">
/** 周末概览统计（全部来自真实 Store 派生，禁止假数据） */
export interface WeekendStatsData {
  /** 本期返家人数 */
  returnedCount: number
  /** 本期留校人数（在读 − 返家，派生） */
  stayCount: number
  /** 已不在档案的返家记录条数 */
  staleCount: number
  /** 本月累计返家人次 */
  monthCount: number
}
</script>

<script setup lang="ts">
import { Archive, CalendarRange, Luggage, Moon } from 'lucide-vue-next'

/**
 * WeekendStats — 周末概览（V2.0.7-alpha · Phase UI-4E 沉淀）：
 * 四统计卡（本期返家 / 留校 / 本月累计 / 历史遗留记录）。
 * 数据模型只记「返家」（留校是派生口径），不发明返校时刻统计。
 */
defineProps<{
  stats: WeekendStatsData
}>()

const CARDS = [
  { key: 'returnedCount', label: '本期返家', icon: Luggage, hint: '周末人不在校', tone: 'default' },
  { key: 'stayCount', label: '留校', icon: Moon, hint: '未登记返家', tone: 'default' },
  { key: 'monthCount', label: '本月累计', icon: CalendarRange, hint: '返家人次', tone: 'default' },
  { key: 'staleCount', label: '历史遗留', icon: Archive, hint: '学生已不在档案', tone: 'alert' },
] as const
</script>

<template>
  <div class="weekend-stats">
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
.weekend-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--card-gap);
}

@media (max-width: 900px) {
  .weekend-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 480px) {
  .weekend-stats {
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
  font-size: 28px;
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
