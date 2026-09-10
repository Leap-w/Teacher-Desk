<script setup lang="ts">
import { AppButton, EmptyState } from '@/components/ui'
import { WEEKDAY_LABELS } from '@/utils/timetable'
import type { Lesson, Weekday } from '@/types/timetable'
import ScheduleLessonCard from './ScheduleLessonCard.vue'

interface Props {
  /** 该天的课程（已按节次升序） */
  lessons: Lesson[]
  weekday: Weekday
}

defineProps<Props>()

const emit = defineEmits<{
  (event: 'edit', lesson: Lesson): void
  (event: 'create'): void
}>()
</script>

<template>
  <section class="day-panel">
    <ul v-if="lessons.length > 0" class="day-list">
      <li v-for="lesson in lessons" :key="lesson.id" class="day-row">
        <span class="day-period">第{{ lesson.period }}节</span>
        <ScheduleLessonCard class="day-card" :lesson="lesson" @edit="emit('edit', lesson)" />
      </li>
    </ul>

    <EmptyState
      v-else
      icon="📅"
      :title="`${WEEKDAY_LABELS[weekday]}没有课`"
      description="点下方按钮添加，或切换到其他星期看看。"
    />

    <AppButton variant="secondary" class="day-add" @click="emit('create')">＋ 添加课程</AppButton>
  </section>
</template>

<style scoped>
.day-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.day-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.day-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.day-period {
  flex-shrink: 0;
  min-width: 52px;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--color-fill-disabled);
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
  font-weight: 600;
  text-align: center;
}

.day-card {
  flex: 1;
  min-width: 0;
}

.day-add {
  align-self: stretch;
}
</style>
