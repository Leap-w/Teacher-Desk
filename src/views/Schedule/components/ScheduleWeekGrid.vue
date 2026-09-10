<script setup lang="ts">
import { computed } from 'vue'

import { LESSON_PERIODS, WEEKDAY_SHORT_LABELS } from '@/utils/timetable'
import type { Lesson, Weekday } from '@/types/timetable'
import ScheduleLessonCard from './ScheduleLessonCard.vue'

interface Props {
  /** 全部课程（本组件按 星期 + 节次 归位） */
  lessons: Lesson[]
  /** 显示的列（默认周一~周五；有周末课时由页面追加） */
  weekdays: Weekday[]
  /** 今天的星期，用于高亮当列 */
  today?: Weekday
}

const props = withDefaults(defineProps<Props>(), {
  today: undefined,
})

const emit = defineEmits<{
  (event: 'edit', lesson: Lesson): void
  (event: 'create', weekday: Weekday, period: number): void
}>()

/**
 * 格子索引：`星期-节次` → 该格的课程数组。
 * 一格多课不静默丢弃（数据被外部改坏时也要全部渲染出来），
 * 正常路径由 store 的时段冲突校验拦住。
 */
const slots = computed(() => {
  const map = new Map<string, Lesson[]>()
  for (const lesson of props.lessons) {
    const key = `${lesson.weekday}-${lesson.period}`
    const bucket = map.get(key)
    if (bucket) bucket.push(lesson)
    else map.set(key, [lesson])
  }
  return map
})

function lessonsAt(weekday: Weekday, period: number): Lesson[] {
  return slots.value.get(`${weekday}-${period}`) ?? []
}
</script>

<template>
  <div class="week-grid" :style="{ '--columns': weekdays.length }">
    <div class="grid-head">
      <span class="grid-corner" aria-hidden="true">节次</span>
      <span
        v-for="weekday in weekdays"
        :key="weekday"
        class="grid-weekday"
        :class="{ 'is-today': weekday === today }"
      >
        {{ WEEKDAY_SHORT_LABELS[weekday] }}
        <span v-if="weekday === today" class="grid-today-tag">今天</span>
      </span>
    </div>

    <div v-for="period in LESSON_PERIODS" :key="period" class="grid-row">
      <span class="grid-period">第{{ period }}节</span>

      <div
        v-for="weekday in weekdays"
        :key="`${weekday}-${period}`"
        class="grid-cell"
        :class="{ 'is-today': weekday === today }"
      >
        <ScheduleLessonCard
          v-for="lesson in lessonsAt(weekday, period)"
          :key="lesson.id"
          compact
          :lesson="lesson"
          @edit="emit('edit', lesson)"
        />

        <button
          v-if="lessonsAt(weekday, period).length === 0"
          type="button"
          class="cell-add"
          :aria-label="`${WEEKDAY_SHORT_LABELS[weekday]} 第${period}节 新增课程`"
          @click="emit('create', weekday, period)"
        >
          <span aria-hidden="true">＋</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.week-grid {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.grid-head,
.grid-row {
  display: grid;
  grid-template-columns: 56px repeat(var(--columns), minmax(0, 1fr));
  gap: var(--space-1);
}

.grid-corner,
.grid-period {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}

.grid-period {
  padding: var(--space-2) 0;
}

.grid-weekday {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  padding: var(--space-2) 0;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text-secondary);
}

.grid-weekday.is-today {
  color: var(--color-primary-strong);
}

.grid-today-tag {
  padding: 1px var(--space-1);
  border-radius: 999px;
  background: var(--color-primary-soft);
  font-size: 10px;
  font-weight: 600;
}

.grid-cell {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-height: 58px;
  padding: var(--space-1);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
}

.grid-cell.is-today {
  background: var(--color-primary-soft);
  border-color: transparent;
}

.cell-add {
  flex: 1;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-faint);
  font-size: var(--text-md);
  cursor: pointer;
  transition:
    border-color var(--transition-fast),
    color var(--transition-fast),
    background var(--transition-fast);
}

.grid-cell:hover .cell-add {
  border-color: var(--color-border-strong);
  background: var(--color-fill-disabled);
  color: var(--color-primary-strong);
}

.cell-add:focus-visible {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: var(--ring-focus);
  color: var(--color-primary-strong);
}
</style>
