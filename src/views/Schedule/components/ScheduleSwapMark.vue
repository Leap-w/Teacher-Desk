<script setup lang="ts">
import { computed } from 'vue'

import { WEEKDAY_SHORT_LABELS, periodLabelOf } from '@/utils/timetable'
import type { CourseExchange } from '@/types/timetable'

/**
 * 「调课」标记：某个时段原本有课、但被换课搬走了（原时间显示换课标记，而不是凭空消失）。
 * 点它可以查看详情并撤销这次换课。
 */
interface Props {
  exchange: CourseExchange
  compact?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  compact: false,
})

const emit = defineEmits<{
  (event: 'open', exchange: CourseExchange): void
}>()

const toLabel = computed(
  () =>
    `${WEEKDAY_SHORT_LABELS[props.exchange.to.weekday]} ${periodLabelOf(props.exchange.to.periodId)}`,
)

const ariaLabel = computed(
  () => `本时段已调课至 ${toLabel.value}（${props.exchange.from.subject}），点击查看或撤销`,
)
</script>

<template>
  <button
    type="button"
    class="swap-mark"
    :class="{ 'is-compact': compact }"
    :aria-label="ariaLabel"
    @click="emit('open', exchange)"
  >
    <span class="swap-icon" aria-hidden="true">→</span>
    <span class="swap-text">
      <span class="swap-title">调课</span>
      <span class="swap-target">{{ toLabel }}</span>
    </span>
  </button>
</template>

<style scoped>
.swap-mark {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-sm);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--transition-fast),
    background var(--transition-fast);
}

.swap-mark:hover {
  border-color: var(--color-warning-strong);
  background: var(--color-warning-soft);
}

.swap-mark:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.swap-icon {
  flex-shrink: 0;
  color: var(--color-text-faint);
  font-size: var(--text-xs);
}

.swap-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.swap-title {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-text-secondary);
}

.swap-target {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  overflow-wrap: anywhere;
}
</style>
