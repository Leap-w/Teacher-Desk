<script setup lang="ts">
import { computed } from 'vue'
import { ChevronRight } from 'lucide-vue-next'

import { AppBadge } from '@/components/ui'
import { describeHoliday, formatHolidayRange } from '@/utils/holiday'
import type { HolidayEntry, HolidayStatus } from '@/types/holiday'

/**
 * HolidayCard — 假期列表里的一张卡（自定义假期与虚拟周末共用）。
 *
 * 一张卡要回答三个问题：**这是哪一段**（名称 + 日期）、**离现在多远**（还有 N 天 / 进行中 /
 * 已结束）、**登记得怎么样了**（三态）。三样都在同一行视线里，教师不用点进去就知道该处理哪个。
 *
 * 底部的三态条是**比例条**不是图表：它只回答「这一期大概登记到什么程度了」，
 * 具体数字就在下面写着，不给人「读图」的负担（§2.3 不做图表）。
 */
const props = defineProps<{
  entry: HolidayEntry
  counts: Record<HolidayStatus, number>
  todayKey: string
}>()

const holiday = computed(() => props.entry.holiday)
const total = computed(() => props.counts.home + props.counts.stay + props.counts.unregistered)

/** 比例条的段宽（百分比）。总数为 0 时不画（全班都退档了这种边角，别画一根空条） */
function widthOf(count: number): string {
  if (!total.value) return '0%'
  return `${(count / total.value) * 100}%`
}
</script>

<template>
  <button type="button" class="holiday-card" @click="$emit('select')">
    <div class="card-head">
      <div class="card-title-line">
        <span class="card-name">{{ holiday.name }}</span>
        <AppBadge v-if="entry.kind === 'weekend'" variant="neutral" size="sm">周末</AppBadge>
      </div>
      <ChevronRight :size="16" :stroke-width="2" class="card-arrow" aria-hidden="true" />
    </div>

    <p class="card-meta">
      {{ formatHolidayRange(holiday) }}
      <span class="card-dot" aria-hidden="true">·</span>
      {{ describeHoliday(holiday, todayKey) }}
    </p>

    <div class="card-bar" aria-hidden="true">
      <span class="bar-seg is-home" :style="{ width: widthOf(counts.home) }" />
      <span class="bar-seg is-stay" :style="{ width: widthOf(counts.stay) }" />
      <span class="bar-seg is-blank" :style="{ width: widthOf(counts.unregistered) }" />
    </div>

    <p class="card-counts">
      回家 <strong>{{ counts.home }}</strong> · 留校 <strong>{{ counts.stay }}</strong> · 未登记
      <strong>{{ counts.unregistered }}</strong>
    </p>
  </button>
</template>

<style scoped>
.holiday-card {
  display: block;
  width: 100%;
  padding: var(--spacing-card);
  text-align: left;
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  cursor: pointer;
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast);
}

.holiday-card:hover {
  background: var(--bg-hover);
}

.holiday-card:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.card-title-line {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.card-name {
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-arrow {
  flex-shrink: 0;
  color: var(--color-text-faint);
}

.card-meta {
  margin-top: var(--space-1);
  font-size: var(--font-secondary);
  color: var(--color-text-tertiary);
}

.card-dot {
  margin: 0 var(--space-1);
}

.card-bar {
  display: flex;
  height: 6px;
  margin-top: var(--space-3);
  border-radius: var(--radius-full);
  overflow: hidden;
  background: var(--color-fill-disabled);
}

.bar-seg {
  display: block;
  height: 100%;
  transition: width var(--duration-base) var(--ease-out);
}

.bar-seg.is-home {
  background: var(--color-primary);
}

.bar-seg.is-stay {
  background: var(--color-success);
}

.bar-seg.is-blank {
  /* 未被登记的段落不填色，让底色透出来——「还空着」正是这一段的含义 */
  background: transparent;
}

.card-counts {
  margin-top: var(--space-2);
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.card-counts strong {
  color: var(--color-text-primary);
  font-weight: var(--font-weight-medium);
}
</style>
