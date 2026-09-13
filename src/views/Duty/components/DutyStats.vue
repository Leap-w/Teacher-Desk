<script lang="ts">
/** 值日概览统计（全部来自真实 Store 派生；完成打卡不在数据模型内，不伪造） */
export interface DutyStatsData {
  /** 今日值日人数 */
  todayMemberCount: number
  /** 值日组总数 */
  groupCount: number
  /** 未来 7 天轮值天数 */
  upcomingDays: number
  /** 已不在档案的组员数（需教师处理） */
  missingMembers: number
}
</script>

<script setup lang="ts">
import { AlertTriangle, CalendarDays, Paintbrush, UsersRound } from 'lucide-vue-next'

/**
 * DutyStats — 值日概览（V2.0.6-alpha · Phase UI-4D 沉淀）：
 * 四统计卡。数据模型不含「完成打卡」（Phase 6 拍板口径），故统计用真实可算口径：
 * 今日人数 / 组总数 / 7 天轮值 / 缺档组员——不伪造完成率。
 */
defineProps<{
  stats: DutyStatsData
}>()

const CARDS = [
  {
    key: 'todayMemberCount',
    label: '今日值日人数',
    icon: UsersRound,
    hint: '今天轮到的组员',
    tone: 'default',
  },
  {
    key: 'groupCount',
    label: '值日组总数',
    icon: Paintbrush,
    hint: '按顺序每天轮一组',
    tone: 'default',
  },
  {
    key: 'upcomingDays',
    label: '7 天轮值天数',
    icon: CalendarDays,
    hint: '未来一周的安排',
    tone: 'default',
  },
  {
    key: 'missingMembers',
    label: '缺档组员',
    icon: AlertTriangle,
    hint: '已不在档案，待处理',
    tone: 'alert',
  },
] as const
</script>

<template>
  <div class="duty-stats">
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
.duty-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--card-gap);
}

@media (max-width: 900px) {
  .duty-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 480px) {
  .duty-stats {
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
