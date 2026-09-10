<script setup lang="ts">
import { AppCard } from '@/components/ui'

interface Props {
  /** 本周授课节数（由 timetable store 的 weekLessonCount 提供） */
  count: number
}

defineProps<Props>()
</script>

<template>
  <AppCard title="本周授课">
    <div class="stats-body">
      <p class="stats-value">
        <strong>{{ count }}</strong>
        <span class="stats-unit">节</span>
      </p>
      <p class="stats-note" title="历史周次对比需要保存往周课表，将在后续版本提供">较上周 ——</p>
    </div>
  </AppCard>
</template>

<style scoped>
.stats-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.stats-value {
  display: flex;
  align-items: baseline;
  gap: var(--space-1);
  color: var(--color-primary-strong);
}

.stats-value strong {
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.6px;
  line-height: 1.1;
}

.stats-unit {
  font-size: var(--text-md);
  font-weight: 600;
}

.stats-note {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
</style>
