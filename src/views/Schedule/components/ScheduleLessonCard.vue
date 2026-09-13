<script setup lang="ts">
import { computed } from 'vue'

import { AppBadge } from '@/components/ui'
import { LESSON_TYPE_LABELS, WEEKDAY_SHORT_LABELS, periodLabelOf } from '@/utils/timetable'
import type { Lesson } from '@/types/timetable'

interface Props {
  lesson: Lesson
  /** 紧凑模式（PC 周视图的格子里用，行高更小） */
  compact?: boolean
  /** 当前 / 下一节课（UI-5A：松石青描边呼吸强调；纯视觉） */
  isCurrent?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  compact: false,
  isCurrent: false,
})

const emit = defineEmits<{
  /** 点击卡片：打开课程详情（详情里提供 编辑 / 换课 / 代课 / 删除） */
  (event: 'open', lesson: Lesson): void
}>()

/**
 * 无障碍名称里带上「星期 + 时段 + 类型」：卡片所在的行列只对视觉有效，
 * 读屏软件听不出这是周几的哪一节（移动端分日列表里略冗余，一并统一为一种格式）。
 * **不包含上课地点**：V1.1.3 起课程表没有地点这一栏。
 */
const ariaLabel = computed(
  () =>
    `${WEEKDAY_SHORT_LABELS[props.lesson.weekday]} ${periodLabelOf(props.lesson.periodId)} ` +
    `${props.lesson.subject} ${props.lesson.className}` +
    `${props.lesson.type === 'normal' ? '' : `（${LESSON_TYPE_LABELS[props.lesson.type]}）`}，点击查看详情`,
)

/** 代课 / 调课的徽标文案（正常课不显示徽标） */
const badgeText = computed(() =>
  props.lesson.type === 'normal' ? undefined : LESSON_TYPE_LABELS[props.lesson.type],
)
</script>

<template>
  <button
    type="button"
    class="lesson-card"
    :class="{
      'is-compact': compact,
      'is-temp': lesson.type === 'substitute',
      'is-adjusted': lesson.type === 'adjusted',
      'is-current': isCurrent,
    }"
    :aria-label="ariaLabel"
    @click="emit('open', lesson)"
  >
    <span class="lesson-head">
      <span class="lesson-subject">{{ lesson.subject }}</span>
      <AppBadge
        v-if="badgeText"
        :variant="lesson.type === 'substitute' ? 'warning' : 'neutral'"
        size="sm"
      >
        {{ badgeText }}
      </AppBadge>
    </span>
    <span class="lesson-class">{{ lesson.className }}</span>
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

/* 调课：中性灰（不是异常，只是「这节的来历不同」） */
.lesson-card.is-adjusted {
  border-left-color: var(--color-text-secondary);
  background: var(--color-fill-disabled);
}

.lesson-card.is-adjusted:hover {
  background: var(--color-fill-disabled);
}

/* 当前 / 下一节（UI-5A）：松石青描边 + 柔和呼吸，压过代课/调课底色 */
.lesson-card.is-current {
  border-left-color: var(--color-primary);
  background: var(--color-primary-soft-strong);
  animation: lesson-breathe 2.4s ease-in-out infinite;
}

@keyframes lesson-breathe {
  0%,
  100% {
    box-shadow: 0 0 0 0 var(--color-primary-soft);
  }

  50% {
    box-shadow: 0 0 0 4px var(--color-primary-soft);
  }
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
  flex-wrap: wrap;
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
</style>
