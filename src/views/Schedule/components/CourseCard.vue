<script setup lang="ts">
import { computed } from 'vue'

import type { Lesson } from '@/types/timetable'
import { periodLabelOf, periodTimeTextOf } from '@/utils/timetable'
import ScheduleStatusBadge from './ScheduleStatusBadge.vue'

/**
 * CourseCard — 统一课程卡（V2.0.8-alpha · Phase UI-5A，今日时间轴用）：
 * 科目 22px + 班级（上）/ 节次 + 时间（中）/ 状态徽章（下）。
 * 当前课程：松石青描边 + 柔和呼吸强调（克制）。点击打开详情（逻辑在父级）。
 */
const props = withDefaults(
  defineProps<{
    lesson: Lesson
    state: 'ongoing' | 'next' | 'done' | 'empty'
  }>(),
  {
    state: 'done',
  },
)

const emit = defineEmits<{
  open: [lesson: Lesson]
}>()

const isCurrent = computed(() => props.state === 'ongoing')
</script>

<template>
  <button
    type="button"
    class="course-card"
    :class="{ 'is-current': isCurrent }"
    @click="emit('open', lesson)"
  >
    <div class="card-head">
      <h3 class="course-subject">{{ lesson.subject }}</h3>
      <ScheduleStatusBadge :state="state" />
    </div>
    <p class="course-class">{{ lesson.className }}</p>
    <p class="course-time">
      {{ periodLabelOf(lesson.periodId) }}
      <span class="dot" aria-hidden="true"> · </span>
      {{ periodTimeTextOf(lesson.periodId) }}
    </p>
  </button>
</template>

<style scoped>
.course-card {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--spacing-card);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  background: var(--color-bg-white);
  box-shadow: var(--shadow-xs);
  text-align: left;
  cursor: pointer;
  transition:
    transform var(--duration-base) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out),
    border-color var(--duration-base) var(--ease-out);
}

@media (hover: hover) {
  .course-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }
}

.course-card:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

/* 当前课程：松石青描边 + 柔和呼吸（克制，不闪烁） */
.course-card.is-current {
  border-color: var(--color-primary);
  animation: course-breathe 2.4s ease-in-out infinite;
}

@keyframes course-breathe {
  0%,
  100% {
    box-shadow: 0 0 0 0 var(--color-primary-soft);
  }

  50% {
    box-shadow: 0 0 0 5px var(--color-primary-soft);
  }
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.course-subject {
  font-size: 22px;
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.01em;
  line-height: var(--leading-tight);
  color: var(--color-text-primary);
  overflow-wrap: anywhere;
}

.course-class {
  font-size: var(--font-secondary);
  color: var(--color-text-secondary);
}

.course-time {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.dot {
  color: var(--color-text-faint);
}
</style>
