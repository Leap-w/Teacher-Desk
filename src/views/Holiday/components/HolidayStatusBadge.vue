<script setup lang="ts">
import { computed } from 'vue'

import { AppBadge } from '@/components/ui'
import { HOLIDAY_STATUS_LABELS } from '@/utils/holiday'
import type { BadgeVariant } from '@/types'
import type { HolidayStatus } from '@/types/holiday'

/**
 * HolidayStatusBadge — 三态徽章（回家 / 留校 / 未登记）。
 *
 * 配色的依据是**信息的确定程度**，不是「好坏」：回家与留校都是教师登记过的事实，
 * 给两种不同的实色；「未登记」用中性灰——它不是一种去向，是**还没有去向**，
 * 灰让它在一列徽章里一眼就能被挑出来（这批人正是教师下一步要去问的）。
 */
const props = defineProps<{ status: HolidayStatus }>()

const VARIANTS: Record<HolidayStatus, BadgeVariant> = {
  home: 'primary',
  stay: 'success',
  unregistered: 'neutral',
}

const variant = computed(() => VARIANTS[props.status])
</script>

<template>
  <AppBadge :variant="variant" size="sm">{{ HOLIDAY_STATUS_LABELS[status] }}</AppBadge>
</template>
