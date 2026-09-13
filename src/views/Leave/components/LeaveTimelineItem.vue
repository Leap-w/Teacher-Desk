<script lang="ts">
/** 时间轴事件（由请假记录的登记端点派生，组件不依赖 Store） */
export interface LeaveTimelineEvent {
  id: string
  kind: 'left' | 'back'
  /** 学生姓名快照 */
  studentName: string
  /** 展示时间（已格式化，如「9月13日 下午」） */
  timeLabel: string
  /** 排序键（同一天内：上午 < 下午；跨记录按时间点） */
  sortKey: string
}
</script>

<script setup lang="ts">
/**
 * LeaveTimelineItem — 时间轴单条（V2.0.5-alpha · Phase UI-4C 沉淀）：
 * 节点（离校=松石青 / 返校=绿）+ 学生名 + 事件 + 时间。渐入延迟由父级按序号注入。
 */
defineProps<{
  event: LeaveTimelineEvent
  /** 渐入延迟序号（父级遍历赋值） */
  index?: number
}>()
</script>

<template>
  <div class="tl-row" role="listitem">
    <span class="tl-node" :class="`is-${event.kind}`" aria-hidden="true" />
    <div class="tl-main">
      <p class="tl-title">
        <strong>{{ event.studentName }}</strong>
        {{ event.kind === 'left' ? '登记离校' : '登记返校' }}
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
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--color-surface);
  border: 2.5px solid var(--color-primary);
  z-index: 1;
}

.tl-node.is-back {
  border-color: var(--color-success);
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
