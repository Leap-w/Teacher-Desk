<script setup lang="ts">
import { computed } from 'vue'

import { AppBadge } from '@/components/ui'
import { formatDayPoint } from '@/utils/point'
import type { BadgeVariant } from '@/types'
import type { RegisterEndpoints } from '@/types/point'

/**
 * 「离校 / 返校」状态行（Phase 7A 抽自请假的 LeaveRecordCard）。
 *
 * 状态由两个时间戳**派生展示**，不落库、不新增状态位（Phase 5 口径）：
 * 有返校时间即已返校，只有离校时间即已离校（学生不在校内，教师最需要一眼看到的），
 * 两者皆无为未离校。配色沿用徽标语义：已离校用警示色、已返校用成功色。
 *
 * 当前唯一调用方是请假模块；Phase 7B 的周末返家按拍板口径不记离校 / 返校时刻，
 * 因此没有接到这里（见 `types/weekend.ts` 与开发手册 §9.17）。
 */

interface Props {
  /** 离校 / 返校时间戳（缺哪一个就显示「未登记」） */
  endpoints: RegisterEndpoints
}

const props = defineProps<Props>()

const state = computed<{ label: string; variant: BadgeVariant }>(() => {
  if (props.endpoints.backToSchool) return { label: '已返校', variant: 'success' }
  if (props.endpoints.leftSchool) return { label: '已离校', variant: 'warning' }
  return { label: '未离校', variant: 'neutral' }
})
</script>

<template>
  <p class="status-line">
    <AppBadge :variant="state.variant" size="sm">{{ state.label }}</AppBadge>
    <span>
      离校时间 {{ endpoints.leftSchool ? formatDayPoint(endpoints.leftSchool) : '未登记' }}
    </span>
    <span class="divider" aria-hidden="true">·</span>
    <span>
      返校时间 {{ endpoints.backToSchool ? formatDayPoint(endpoints.backToSchool) : '未登记' }}
    </span>
  </p>
</template>

<style scoped>
.status-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.divider {
  color: var(--color-text-faint);
}
</style>
