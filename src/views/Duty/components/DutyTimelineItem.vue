<script setup lang="ts">
import { Moon } from 'lucide-vue-next'
import type { DutyTimelineEntry } from './DutyTimeline.vue'

/**
 * DutyTimelineItem — 轮换时间轴单条（V2.0.6-alpha · Phase UI-4D 沉淀）：
 * 日期节点（今天松石青实心高亮）+ 组名 + 人数；不值日的日子灰节点标注。
 * v3.7.5：教师按天指定的日子标注「已指定」，并给出「指定 / 改派」入口。
 * v3.7.6：指定日之后的自动轮换从指定组继续衔接，「已指定」徽标带说明。
 */
defineProps<{
  entry: DutyTimelineEntry
  /** 渐入延迟序号（父级遍历赋值） */
  index?: number
  /** 是否给出「指定」入口（没有值日组时关掉） */
  assignable?: boolean
}>()

const emit = defineEmits<{
  assign: [dateKey: string]
}>()
</script>

<template>
  <div class="tl-row" :class="{ 'is-today': entry.isToday }" role="listitem">
    <span class="tl-node" aria-hidden="true" />
    <div class="tl-main">
      <p class="tl-date">
        {{ entry.label }}
        <span v-if="entry.isToday" class="tl-today-badge">今天</span>
      </p>
      <p v-if="entry.group" class="tl-group">
        {{ entry.group.name }}<span class="tl-meta"> · {{ entry.group.memberCount }} 人</span>
        <span
          v-if="entry.assigned"
          class="tl-assigned"
          title="这一天由教师指定，之后的自动轮换从这一组继续衔接"
          >已指定</span
        >
      </p>
      <p v-else class="tl-skip">
        <Moon :size="12" :stroke-width="2" aria-hidden="true" />
        不值日
      </p>
    </div>
    <button
      v-if="assignable"
      type="button"
      class="tl-assign"
      @click="emit('assign', entry.dateKey)"
    >
      {{ entry.assigned ? '改派' : '指定' }}
    </button>
  </div>
</template>

<style scoped>
.tl-row {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-2) 0 var(--space-2) var(--space-2);
  opacity: 0;
  transform: translateY(4px);
  animation: tl-in var(--duration-base) var(--ease-out) forwards;
  animation-delay: calc(var(--tl-index, 0) * 60ms);
}

@keyframes tl-in {
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 节点：圆点压在父级连线上；默认灰（不值日），有组青色，今天实心高亮 */
.tl-node {
  flex-shrink: 0;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--color-surface);
  border: 2.5px solid var(--color-border-strong);
  z-index: 1;
}

.tl-row:has(.tl-group) .tl-node {
  border-color: var(--color-primary);
}

.tl-row.is-today .tl-node {
  background: var(--color-primary);
  border-color: var(--color-primary);
}

.tl-main {
  flex: 1;
  min-width: 0;
}

.tl-date {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.tl-today-badge {
  padding: 1px 8px;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  color: var(--color-text-inverse);
  font-size: var(--font-caption);
  font-weight: var(--font-weight-semibold);
}

.tl-group {
  margin-top: 2px;
  font-size: var(--font-secondary);
  color: var(--color-text-secondary);
}

.tl-meta {
  color: var(--color-text-tertiary);
}

/* 「已指定」：这一天的组是教师按天指定的（与自动轮换区分开） */
.tl-assigned {
  margin-left: var(--space-2);
  padding: 1px 6px;
  border-radius: var(--radius-full);
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
  font-size: var(--font-caption);
}

.tl-assign {
  flex-shrink: 0;
  align-self: center;
  border: none;
  background: transparent;
  padding: var(--space-1) var(--space-2);
  font: inherit;
  font-size: var(--font-caption);
  font-weight: var(--font-weight-medium);
  color: var(--color-primary-strong);
  cursor: pointer;
}

.tl-assign:hover {
  text-decoration: underline;
}

.tl-skip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  font-size: var(--font-caption);
  color: var(--color-text-faint);
}
</style>
