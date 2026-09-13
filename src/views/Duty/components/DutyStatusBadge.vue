<script setup lang="ts">
import { computed } from 'vue'

import { AppBadge } from '@/components/ui'
import type { DutyMember } from '@/types/duty'

/**
 * DutyStatusBadge — 值日状态徽章（V2.0.6-alpha · Phase UI-4D 沉淀）：
 * 今日值日（松石青）/ 已不在档案（橙，需教师处理）。颜色全部走 UI-1 Badge。
 */
const props = defineProps<{
  member: DutyMember
}>()

const state = computed<{ label: string; variant: 'primary' | 'warning' }>(() =>
  props.member.active
    ? { label: '今日值日', variant: 'primary' }
    : { label: '已不在档案', variant: 'warning' },
)
</script>

<template>
  <AppBadge :variant="state.variant">{{ state.label }}</AppBadge>
</template>
