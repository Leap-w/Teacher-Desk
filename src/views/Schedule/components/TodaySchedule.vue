<script setup lang="ts">
import { CalendarDays } from 'lucide-vue-next'

import { EmptyState } from '@/components/ui'
import type { Lesson } from '@/types/timetable'
import CourseCard from './CourseCard.vue'

/**
 * TodaySchedule — 今日课程时间轴（V2.0.8-alpha · Phase UI-5A）：
 * 按节次排序（父级用 sortLessonsByPeriod），当前课松石青描边呼吸强调；
 * 点击打开课程详情（逻辑在父级编排层）。
 */
defineProps<{
  lessons: Lesson[]
  /** 当前/下一节的课程 id（高亮）；无则不高亮 */
  currentLessonId?: string
  /** 当前状态（ongoing / next 用强调，done/empty 全部弱化） */
  state: 'ongoing' | 'next' | 'done' | 'empty'
}>()

const emit = defineEmits<{
  open: [lesson: Lesson]
}>()
</script>

<template>
  <div v-if="lessons.length" class="today-schedule" role="list">
    <CourseCard
      v-for="lesson in lessons"
      :key="lesson.id"
      role="listitem"
      :lesson="lesson"
      :state="lesson.id === currentLessonId ? state : 'done'"
      @open="emit('open', $event)"
    />
  </div>
  <div v-else class="today-empty">
    <EmptyState :icon="CalendarDays" title="今天没有课" description="课程表里没有今天的安排。" />
  </div>
</template>

<style scoped>
.today-schedule {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.today-empty {
  padding: var(--space-4) 0;
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
}
</style>
