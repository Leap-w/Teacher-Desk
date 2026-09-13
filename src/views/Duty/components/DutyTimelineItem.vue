<script setup lang="ts">
import { Moon } from 'lucide-vue-next'
import type { DutyTimelineEntry } from './DutyTimeline.vue'

/**
 * DutyTimelineItem — 轮换时间轴单条（V2.0.6-alpha · Phase UI-4D 沉淀）：
 * 日期节点（今天松石青实心高亮）+ 组名 + 人数；不值日的日子灰节点标注。
 */
defineProps<{
  entry: DutyTimelineEntry
  /** 渐入延迟序号（父级遍历赋值） */
  index?: number
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
      </p>
      <p v-else class="tl-skip">
        <Moon :size="12" :stroke-width="2" aria-hidden="true" />
        不值日
      </p>
    </div>
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
  color: #ffffff;
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

.tl-skip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  font-size: var(--font-caption);
  color: var(--color-text-faint);
}
</style>
