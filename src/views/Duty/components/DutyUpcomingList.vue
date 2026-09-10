<script setup lang="ts">
import { AppBadge, AppCard, EmptyState } from '@/components/ui'
import { formatMonthDay } from '@/utils/date'
import { WEEKDAY_SHORT_LABELS } from '@/utils/timetable'
import type { DutyDay } from '@/utils/duty'

interface Props {
  /** 从今天起连续几天的安排（含今天） */
  days: DutyDay[]
  todayKey: string
  hasGroups: boolean
  /** 轮换已设好起点：没设好时下面的日子全是「不值日」，不如直接说清要先做什么 */
  scheduled: boolean
}

const props = defineProps<Props>()

function isToday(dateKey: string): boolean {
  return dateKey === props.todayKey
}
</script>

<template>
  <AppCard title="接下来 7 天">
    <ul v-if="hasGroups && scheduled" class="day-list">
      <li
        v-for="day in days"
        :key="day.dateKey"
        class="day-row"
        :class="{ 'is-today': isToday(day.dateKey) }"
      >
        <span class="day-date">
          {{ formatMonthDay(day.dateKey) }}
          <span class="day-weekday">{{ WEEKDAY_SHORT_LABELS[day.weekday] }}</span>
          <AppBadge v-if="isToday(day.dateKey)" variant="primary" size="sm">今天</AppBadge>
        </span>
        <span v-if="day.group" class="day-group">{{ day.group.name }}</span>
        <span v-else class="day-rest">不值日</span>
      </li>
    </ul>

    <EmptyState
      v-else-if="!hasGroups"
      icon="📅"
      title="还没排班"
      description="建好值日组后，这里会列出每天的安排。"
    />

    <EmptyState
      v-else
      icon="🗓️"
      title="还没设置轮换起点"
      description="在下面的「轮换设置」里选好起点日期和起点组，这里就会列出每天的安排。"
    />
  </AppCard>
</template>

<style scoped>
.day-list {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
  list-style: none;
}

.day-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-2);
  border-radius: var(--radius-md);
}

.day-row.is-today {
  background: var(--color-primary-soft);
}

.day-date {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-md);
  color: var(--color-text);
}

.day-weekday {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.day-group {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--color-text);
}

.day-rest {
  font-size: var(--text-sm);
  color: var(--color-text-faint);
}
</style>
