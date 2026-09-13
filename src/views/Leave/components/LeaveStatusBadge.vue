<script setup lang="ts">
import { computed } from 'vue'

import { AppBadge } from '@/components/ui'
import type { LeaveRecord } from '@/types/leave'

/**
 * LeaveStatusBadge — 请假状态徽章（V2.0.5-alpha · Phase UI-4C 沉淀）：
 * 记录口径的派生状态（不落库、不改状态位）：
 * - 已作废（灰）：旧审批流驳回的历史遗留，这次请假没有发生
 * - 已返校（灰）：登记了返校时间
 * - 校外中（橙）：已离校未返校——班主任最需要一眼看到的状态
 * - 请假中（蓝）：记录生效、尚未到离校登记
 * 颜色全部走 UI-1 Badge 语义变体，页面不单独写色值。
 */
const props = defineProps<{
  record: LeaveRecord
}>()

const state = computed<{ label: string; variant: 'primary' | 'warning' | 'neutral' }>(() => {
  if (props.record.status === 'rejected') return { label: '已作废', variant: 'neutral' }
  if (props.record.backToSchool) return { label: '已返校', variant: 'neutral' }
  if (props.record.leftSchool) return { label: '校外中', variant: 'warning' }
  return { label: '请假中', variant: 'primary' }
})
</script>

<template>
  <AppBadge :variant="state.variant">{{ state.label }}</AppBadge>
</template>
