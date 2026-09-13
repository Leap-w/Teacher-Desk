<script setup lang="ts">
import { computed } from 'vue'

import { AppBadge } from '@/components/ui'
import { WORK_STATUS_LABELS, type WorkStatus } from '@/types/work'

/**
 * TaskStatusBadge — 任务状态徽章（V2.0.9-alpha · Phase UI-5B）：
 * 待完成=主色 / 进行中=蓝 / 已完成=灰；全部走 UI-1 Badge，页面零自带色。
 */
const props = defineProps<{
  status: WorkStatus
}>()

const variant = computed(() => {
  if (props.status === 'done') return 'neutral'
  return 'primary'
})
</script>

<template>
  <AppBadge :variant="variant" size="sm">{{ WORK_STATUS_LABELS[props.status] }}</AppBadge>
</template>
