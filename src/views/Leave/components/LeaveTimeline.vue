<script setup lang="ts">
import type { LeaveTimelineEvent } from './LeaveTimelineItem.vue'
import LeaveTimelineItem from './LeaveTimelineItem.vue'

/**
 * LeaveTimeline — 今日登记时间轴（V2.0.5-alpha · Phase UI-4C 沉淀）：
 * 离校 / 返校登记按时间排序；竖向连线 + 节点圆点，逐项 200ms 渐入。
 * 值日 / 工作记录的时间轴可直接复用此结构（喂 events 即可）。
 */
defineProps<{
  events: LeaveTimelineEvent[]
}>()
</script>

<template>
  <div class="leave-timeline" role="list">
    <LeaveTimelineItem
      v-for="(event, index) in events"
      :key="event.id"
      :event="event"
      :index="index"
    />
  </div>
</template>

<style scoped>
.leave-timeline {
  position: relative;
  display: flex;
  flex-direction: column;
}

/* 竖向连线：贯穿节点 */
.leave-timeline::before {
  content: '';
  position: absolute;
  left: 11px;
  top: 14px;
  bottom: 14px;
  width: 1.5px;
  background: var(--color-border);
}
</style>
