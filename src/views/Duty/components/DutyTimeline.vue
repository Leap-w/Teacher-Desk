<script lang="ts">
/** 轮换时间轴事件（来自 dutyDaysFrom 的 DutyDay，组件不依赖 Store） */
export interface DutyTimelineEntry {
  dateKey: string
  /** 展示日期（如「9月14日 周一」） */
  label: string
  group?: { name: string; memberCount: number }
  /** 是否今天 */
  isToday?: boolean
  /** 这一天的组是不是教师按天指定的（v3.7.5）：行内标注「已指定」 */
  assigned?: boolean
}
</script>

<script setup lang="ts">
import DutyTimelineItem from './DutyTimelineItem.vue'

/**
 * DutyTimeline — 轮换安排时间轴（V2.0.6-alpha · Phase UI-4D 沉淀）：
 * 近 7 天逐日节点（今天高亮）；数据模型不含完成打卡，
 * 「开始/完成值日」类事件无从谈起——这里展示的是真实存在的轮换安排。
 * 值日 / 工作记录的时间轴可直接复用此结构。
 */
defineProps<{
  entries: DutyTimelineEntry[]
  /** 每行是否给出「指定」入口（v3.7.5 的按天指定；没有值日组时关掉） */
  assignable?: boolean
}>()

const emit = defineEmits<{
  /** 教师点了某一天的「指定 / 改派」 */
  assign: [dateKey: string]
}>()
</script>

<template>
  <div class="duty-timeline" role="list">
    <DutyTimelineItem
      v-for="(entry, index) in entries"
      :key="entry.dateKey"
      :entry="entry"
      :index="index"
      :assignable="assignable"
      @assign="emit('assign', $event)"
    />
  </div>
</template>

<style scoped>
.duty-timeline {
  position: relative;
  display: flex;
  flex-direction: column;
}

/* 竖向连线：贯穿节点 */
.duty-timeline::before {
  content: '';
  position: absolute;
  left: 11px;
  top: 14px;
  bottom: 14px;
  width: 1.5px;
  background: var(--color-border);
}
</style>
