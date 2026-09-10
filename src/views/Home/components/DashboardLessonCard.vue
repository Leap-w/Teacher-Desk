<script setup lang="ts">
import { computed } from 'vue'

import { AppBadge, AppCard, EmptyState } from '@/components/ui'
import type { Lesson } from '@/types/timetable'

interface Props {
  /** 今日课程（已按节次升序，由 timetable store 的 lessonsOf 提供） */
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
        <span class="lesson-period">第{{ lesson.period }}节</span>
        <span class="lesson-main">
          <span class="lesson-subject">{{ lesson.subject }}</span>
          <span class="lesson-class">{{ lesson.className }}</span>
        </span>
        <span v-if="lesson.location" class="lesson-location">{{ lesson.location }}</span>
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
  min-width: 52px;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
  font-size: var(--text-xs);
  font-weight: 600;
  text-align: center;
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
}

.lesson-class {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

/* 地点可长可短：允许被压缩并在词内换行，长地点不会把整行撑破（§9.6 审查修复） */
.lesson-location {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
</style>
