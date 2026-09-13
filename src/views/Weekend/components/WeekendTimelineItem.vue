<script setup lang="ts">
import { Luggage } from 'lucide-vue-next'
import type { WeekendTimelineEvent } from './WeekendTimeline.vue'

/**
 * WeekendTimelineItem — 登记时间轴单条（V2.0.7-alpha · Phase UI-4E 沉淀）：
 * 松石青节点 + 学生名 + 登记时间。渐入延迟由父级按序号注入。
 */
defineProps<{
  event: WeekendTimelineEvent
  /** 渐入延迟序号（父级遍历赋值） */
  index?: number
}>()
</script>

<template>
  <div class="tl-row" role="listitem">
    <span class="tl-node" aria-hidden="true">
      <Luggage :size="10" :stroke-width="2.4" />
    </span>
    <div class="tl-main">
      <p class="tl-title">
        <strong>{{ event.studentName }}</strong>
        登记返家
      </p>
    </div>
    <span class="tl-time">{{ event.timeLabel }}</span>
  </div>
</template>

<style scoped>
.tl-row {
  position: relative;
  display: flex;
  align-items: center;
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

/* 节点：圆点压在父级连线上 */
.tl-node {
  flex-shrink: 0;
  width: 23px;
  height: 23px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--color-primary-soft);
  color: var(--color-primary-dark);
  z-index: 1;
}

.tl-main {
  flex: 1;
  min-width: 0;
}

.tl-title {
  font-size: var(--font-secondary);
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tl-title strong {
  color: var(--color-text-primary);
  font-weight: var(--font-weight-semibold);
}

.tl-time {
  flex-shrink: 0;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}
</style>
