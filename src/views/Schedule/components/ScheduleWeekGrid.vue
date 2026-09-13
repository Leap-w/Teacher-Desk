<script setup lang="ts">
import { computed } from 'vue'

import { COURSE_PERIODS } from '@/types/timetable'
import { WEEKDAY_SHORT_LABELS, periodLabelOf, periodTimeTextOf } from '@/utils/timetable'
import type { CourseExchange, CoursePeriodId, Lesson, Weekday } from '@/types/timetable'
import ScheduleLessonCard from './ScheduleLessonCard.vue'
import ScheduleSwapMark from './ScheduleSwapMark.vue'

interface Props {
  /** 全部课程（本组件按 星期 + 时段 归位） */
  lessons: Lesson[]
  /** 换课记录：原时段渲染「调课 → …」标记 */
  exchanges: CourseExchange[]
  /** 显示的列（默认周一~周五；有周末课时由页面追加） */
  weekdays: Weekday[]
  /** 今天的星期，用于高亮当列 */
  today?: Weekday
  /** 当前 / 下一节的课程 id（UI-5A：松石青描边呼吸强调；纯视觉，不改交互） */
  currentLessonId?: string
}

const props = withDefaults(defineProps<Props>(), {
  today: undefined,
  currentLessonId: undefined,
})

const emit = defineEmits<{
  (event: 'open', lesson: Lesson): void
  (event: 'open-exchange', exchange: CourseExchange): void
  (event: 'create', weekday: Weekday, periodId: CoursePeriodId): void
}>()

/**
 * 格子索引：`星期-时段` → 该格的课程数组。
 * 一格多课不静默丢弃（数据被外部改坏时也要全部渲染出来），
 * 正常路径由 store 的时段冲突校验拦住。
 */
const slots = computed(() => {
  const map = new Map<string, Lesson[]>()
  for (const lesson of props.lessons) {
    const key = `${lesson.weekday}-${lesson.periodId}`
    const bucket = map.get(key)
    if (bucket) bucket.push(lesson)
    else map.set(key, [lesson])
  }
  return map
})

function lessonsAt(weekday: Weekday, periodId: CoursePeriodId): Lesson[] {
  return slots.value.get(`${weekday}-${periodId}`) ?? []
}

/** 该格子上「被调走」的标记（本时段没课、但有一次换课从这里搬走了课程） */
function swapAt(weekday: Weekday, periodId: CoursePeriodId): CourseExchange | undefined {
  if (lessonsAt(weekday, periodId).length > 0) return undefined
  return props.exchanges.find(
    (exchange) =>
      exchange.from.weekday === weekday && exchange.from.periodId === periodId && !exchange.group,
  )
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

    <div v-for="period in COURSE_PERIODS" :key="period.id" class="grid-row">
      <span class="grid-period">
        <span class="grid-period-name">{{ period.label }}</span>
        <span class="grid-period-time">{{ periodTimeTextOf(period.id) }}</span>
      </span>

      <div
        v-for="weekday in weekdays"
        :key="`${weekday}-${period.id}`"
        class="grid-cell"
        :class="{ 'is-today': weekday === today }"
      >
        <ScheduleLessonCard
          v-for="lesson in lessonsAt(weekday, period.id)"
          :key="lesson.id"
          compact
          :lesson="lesson"
          :is-current="lesson.id === props.currentLessonId"
          @open="emit('open', $event)"
        />

        <ScheduleSwapMark
          v-if="swapAt(weekday, period.id)"
          compact
          :exchange="swapAt(weekday, period.id)!"
          @open="emit('open-exchange', $event)"
        />

        <button
          v-if="lessonsAt(weekday, period.id).length === 0 && !swapAt(weekday, period.id)"
          type="button"
          class="cell-add"
          :aria-label="`${WEEKDAY_SHORT_LABELS[weekday]} ${periodLabelOf(period.id)} 新增课程`"
          @click="emit('create', weekday, period.id)"
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
  grid-template-columns: 96px repeat(var(--columns), minmax(0, 1fr));
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

/* 时段列：名称 + 时间两行（V1.1.3 起时段有固定起止时间，教师按时间找课比按序号快） */
.grid-period {
  flex-direction: column;
  gap: 1px;
  padding: var(--space-2) 0;
  text-align: center;
}

.grid-period-name {
  font-weight: 600;
  color: var(--color-text-secondary);
}

.grid-period-time {
  font-size: 10px;
  color: var(--color-text-faint);
  white-space: nowrap;
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
  border-radius: var(--radius-full);
  background: var(--color-primary-soft);
  font-size: 10px;
  font-weight: 600;
}

.grid-cell {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-height: 54px;
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
  min-height: 40px;
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
