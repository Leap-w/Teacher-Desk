<script lang="ts">
/** 返家登记事件（由记录的 createdAt 派生，组件不依赖 Store） */
export interface WeekendTimelineEvent {
  id: string
  studentName: string
  /** 展示时间（已格式化，如「9月12日 20:14」） */
  timeLabel: string
}
</script>

<script setup lang="ts">
import WeekendTimelineItem from './WeekendTimelineItem.vue'

/**
 * WeekendTimeline — 返家登记时间轴（V2.0.7-alpha · Phase UI-4E 沉淀）：
 * 本期登记按时间排序（新 → 旧），逐项 200ms 渐入。
 * 数据模型只记「是否返家 + 登记时间」——离校 / 返校时刻不存在，不做假事件。
 * 外出登记 / 节假日管理可复用此结构。
 */
defineProps<{
  events: WeekendTimelineEvent[]
}>()
</script>

<template>
  <div class="weekend-timeline" role="list">
    <WeekendTimelineItem
      v-for="(event, index) in events"
      :key="event.id"
      :event="event"
      :index="index"
    />
  </div>
</template>

<style scoped>
.weekend-timeline {
  position: relative;
  display: flex;
  flex-direction: column;
}

/* 竖向连线：贯穿节点 */
.weekend-timeline::before {
  content: '';
  position: absolute;
  left: 11px;
  top: 14px;
  bottom: 14px;
  width: 1.5px;
  background: var(--color-border);
}
</style>
