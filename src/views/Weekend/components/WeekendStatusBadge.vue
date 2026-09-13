<script setup lang="ts">
import { computed } from 'vue'

import { AppBadge } from '@/components/ui'
import type { WeekendReturnRecord } from '@/types/weekend'

/**
 * WeekendStatusBadge — 返家状态徽章（V2.0.7-alpha · Phase UI-4E 沉淀）：
 * 返家（松石青）/ 已不在档案（橙，历史遗留需处理）。颜色全部走 UI-1 Badge。
 */
const props = defineProps<{
  record: WeekendReturnRecord
  /** 学生是否仍在本班档案 */
  active: boolean
}>()

const state = computed<{ label: string; variant: 'primary' | 'warning' }>(() =>
  props.active
    ? { label: '返家', variant: 'primary' }
    : { label: '已不在档案', variant: 'warning' },
)
</script>

<template>
  <AppBadge :variant="state.variant">{{ state.label }}</AppBadge>
</template>
