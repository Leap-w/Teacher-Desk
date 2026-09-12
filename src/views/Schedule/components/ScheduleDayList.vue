<script setup lang="ts">
import { computed } from 'vue'

import { AppButton, EmptyState } from '@/components/ui'
import { WEEKDAY_LABELS, periodLabelOf, periodTimeTextOf } from '@/utils/timetable'
import type { CourseExchange, Lesson, Weekday } from '@/types/timetable'
import ScheduleLessonCard from './ScheduleLessonCard.vue'
import ScheduleSwapMark from './ScheduleSwapMark.vue'
import { CalendarDays } from 'lucide-vue-next'

interface Props {
  /** 该天的课程（已按时段升序） */
  lessons: Lesson[]
  /** 该天被调走的时段（原时间显示「调课」标记） */
  exchanges: CourseExchange[]
  weekday: Weekday
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (event: 'open', lesson: Lesson): void
  (event: 'open-exchange', exchange: CourseExchange): void
  (event: 'create'): void
}>()

/** 当天的「调课」标记：该时段现在没有课、但有一次换课从这里搬走了课程 */
const swaps = computed(() => props.exchanges.filter((exchange) => !exchange.group))
</script>

<template>
  <section class="day-panel">
    <ul v-if="lessons.length > 0 || swaps.length > 0" class="day-list">
      <li v-for="lesson in lessons" :key="lesson.id" class="day-row">
        <span class="day-period">
          {{ periodLabelOf(lesson.periodId) }}
          <span class="day-time">{{ periodTimeTextOf(lesson.periodId) }}</span>
        </span>
        <ScheduleLessonCard class="day-card" :lesson="lesson" @open="emit('open', $event)" />
      </li>
      <li v-for="exchange in swaps" :key="exchange.id" class="day-row">
        <span class="day-period">
          {{ periodLabelOf(exchange.from.periodId) }}
          <span class="day-time">{{ periodTimeTextOf(exchange.from.periodId) }}</span>
        </span>
        <ScheduleSwapMark
          class="day-card"
          :exchange="exchange"
          @open="emit('open-exchange', $event)"
        />
      </li>
    </ul>

    <EmptyState
      v-else
      :icon="CalendarDays"
      :title="`${WEEKDAY_LABELS[weekday]}没有课`"
      description="点下方按钮添加，或从 Excel 批量导入。"
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
  min-width: 76px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--color-fill-disabled);
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
  font-weight: 600;
  text-align: center;
}

.day-time {
  font-size: 10px;
  font-weight: 400;
  color: var(--color-text-faint);
  white-space: nowrap;
}

.day-card {
  flex: 1;
  min-width: 0;
}

.day-add {
  align-self: stretch;
}
</style>
