<script setup lang="ts">
import { computed } from 'vue'

import { AppBadge } from '@/components/ui'
import { WEEKDAY_SHORT_LABELS } from '@/utils/timetable'
import type { Lesson } from '@/types/timetable'

interface Props {
  lesson: Lesson
  /** 紧凑模式（PC 周视图的格子里用，行高更小） */
  compact?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  compact: false,
})

const emit = defineEmits<{
  /** 点击卡片：请求编辑该课程（由页面打开编辑抽屉） */
  (event: 'edit', lesson: Lesson): void
}>()

/**
 * 无障碍名称里带上「星期 + 节次」：卡片所在的行列只对视觉有效，
 * 读屏软件听不出这是周几的哪一节（移动端分日列表里略冗余，一并统一为一种格式）。
 */
const ariaLabel = computed(
  () =>
    `${WEEKDAY_SHORT_LABELS[props.lesson.weekday]} 第${props.lesson.period}节 ${props.lesson.subject} ${props.lesson.className}` +
    `${props.lesson.location ? ` ${props.lesson.location}` : ''}${props.lesson.isTemporary ? '（代课）' : ''}，点击编辑`,
)
</script>

<template>
  <button
    type="button"
    class="lesson-card"
    :class="{ 'is-compact': compact, 'is-temp': lesson.isTemporary }"
    :aria-label="ariaLabel"
    @click="emit('edit', lesson)"
  >
    <span class="lesson-head">
      <span class="lesson-subject">{{ lesson.subject }}</span>
      <AppBadge v-if="lesson.isTemporary" variant="warning" size="sm">代课</AppBadge>
    </span>
    <span class="lesson-class">{{ lesson.className }}</span>
    <span v-if="lesson.location" class="lesson-location">{{ lesson.location }}</span>
  </button>
</template>

<style scoped>
.lesson-card {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: var(--space-2) var(--space-3);
  border: none;
  border-left: 3px solid var(--color-primary);
  border-radius: var(--radius-sm);
  background: var(--color-primary-soft);
  text-align: left;
  cursor: pointer;
  transition:
    background var(--transition-fast),
    transform var(--transition-fast);
}

.lesson-card:hover {
  background: var(--color-primary-soft-strong);
}

.lesson-card:active {
  transform: scale(0.99);
}

.lesson-card:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

/* 代课：整体转为暖色，与常规课程一眼可分 */
.lesson-card.is-temp {
  border-left-color: var(--color-warning-strong);
  background: var(--color-warning-soft);
}

.lesson-card.is-temp:hover {
  background: var(--color-warning-soft-strong);
}

.lesson-card.is-compact {
  padding: var(--space-1) var(--space-2);
  gap: 1px;
}

.lesson-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  max-width: 100%;
}

.lesson-subject {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
  overflow-wrap: anywhere;
}

.lesson-card.is-compact .lesson-subject {
  font-size: var(--text-xs);
}

.lesson-class {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}

.lesson-location {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  overflow-wrap: anywhere;
}

.lesson-card.is-compact .lesson-location {
  font-size: 11px;
}
</style>
