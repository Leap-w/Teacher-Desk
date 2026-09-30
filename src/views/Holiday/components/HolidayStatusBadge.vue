<script setup lang="ts">
import { computed } from 'vue'

import { AppBadge } from '@/components/ui'
import { HOLIDAY_STATUS_LABELS } from '@/utils/holiday'
import type { BadgeVariant } from '@/types'
import type { HolidayStatus } from '@/types/holiday'

/**
 * HolidayStatusBadge — 二态徽章（离校 / 留校，v3.6.2）。
 *
 * 两种都是**确定的结果**，不再是「登记过 / 还没登记」的分别，所以都给实色：
 * 离校（登记了回家）用主色，留校（没有登记回家）用成功色——留校不是「缺了一条数据」，
 * 它是本版的默认结论，不该再拿中性灰去暗示「还空着」（v3.6.1 的「未登记」正是那种灰）。
 */
const props = defineProps<{ status: HolidayStatus }>()

const VARIANTS: Record<HolidayStatus, BadgeVariant> = {
  home: 'primary',
  stay: 'success',
}

const variant = computed(() => VARIANTS[props.status])
</script>

<template>
  <AppBadge :variant="variant" size="sm">{{ HOLIDAY_STATUS_LABELS[status] }}</AppBadge>
</template>
