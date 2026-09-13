<script setup lang="ts">
import { computed } from 'vue'

import { AppBadge } from '@/components/ui'

/**
 * ScheduleStatusBadge — 课程状态徽章（V2.0.8-alpha · Phase UI-5A 沉淀）：
 * 当前课程（松石青）/ 下一节（蓝）/ 已结束（灰）。颜色全部走 UI-1 Badge。
 */
const props = defineProps<{
  state: 'ongoing' | 'next' | 'done' | 'empty'
}>()

const state = computed<{ label: string; variant: 'primary' | 'neutral' }>(() => {
  if (props.state === 'ongoing') return { label: '当前课程', variant: 'primary' }
  if (props.state === 'next') return { label: '下一节', variant: 'primary' }
  return { label: '已结束', variant: 'neutral' }
})
</script>

<template>
  <AppBadge :variant="state.variant" size="sm">{{ state.label }}</AppBadge>
</template>
