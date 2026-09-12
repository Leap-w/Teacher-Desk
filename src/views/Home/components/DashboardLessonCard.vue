<script setup lang="ts">
import { computed } from 'vue'

import { AppBadge, AppCard, EmptyState } from '@/components/ui'
import { LESSON_TYPE_LABELS, periodLabelOf, periodTimeTextOf } from '@/utils/timetable'
import type { Lesson } from '@/types/timetable'

interface Props {
  /** 今日课程（已按时段升序，由 timetable store 的 lessonsOf 提供） */
  lessons: Lesson[]
  /** 今天星期几的中文标签，用于右上角「今天 星期四」 */
  weekdayLabel: string
  /** 今天是否周末 —— 仅用于空态文案的措辞 */
  weekend: boolean
}

const props = defineProps<Props>()

const emptyDescription = computed(() =>
  props.weekend ? '周末不排课，好好休息。' : '今天没有安排课程，可以安排班级事务。',
)
</script>

<template>
  <AppCard title="今日课程">
    <template #actions>
      <AppBadge variant="primary" size="sm">今天 {{ weekdayLabel }}</AppBadge>
    </template>

    <ul v-if="lessons.length > 0" class="lesson-list">
      <li v-for="lesson in lessons" :key="lesson.id" class="lesson-row">
        <span class="lesson-period">
          {{ periodLabelOf(lesson.periodId) }}
          <span class="lesson-time">{{ periodTimeTextOf(lesson.periodId) }}</span>
        </span>
        <span class="lesson-main">
          <span class="lesson-subject">
            {{ lesson.subject }}
            <AppBadge
              v-if="lesson.type !== 'normal'"
              :variant="lesson.type === 'substitute' ? 'warning' : 'neutral'"
              size="sm"
            >
              {{ LESSON_TYPE_LABELS[lesson.type] }}
            </AppBadge>
          </span>
          <span class="lesson-class">{{ lesson.className }}</span>
        </span>
      </li>
    </ul>

    <EmptyState v-else icon="📚" title="今天暂无课程" :description="emptyDescription" />
  </AppCard>
</template>

<style scoped>
.lesson-list {
  display: flex;
  flex-direction: column;
}

.lesson-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--color-border);
}

.lesson-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.lesson-row:first-child {
  padding-top: 0;
}

.lesson-period {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
  font-size: var(--text-xs);
  font-weight: 600;
  text-align: center;
}

.lesson-time {
  font-size: 10px;
  font-weight: 400;
  color: var(--color-text-faint);
}

.lesson-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.lesson-subject {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--color-text);
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.lesson-class {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}
</style>
