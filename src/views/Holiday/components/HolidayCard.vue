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
 * 已结束）、**登记得怎么样了**（离校 / 留校）。三样都在同一行视线里，教师不用点进去就知道该处理哪个。
 *
 * 底部的二态条是**比例条**不是图表：它只回答「这一期大概什么情况」，
 * 具体数字就在下面写着，不给人「读图」的负担（§2.3 不做图表）。
 *
 * v3.6.2：「未登记」这一段已删——两段之和恒等于全班，条上不再有留白那一段。
 *
 * v3.7.6：自动周末的名称本身就是日期范围（如「10月24日—10月25日」），所以那种卡不再
 * 重复显示日期行；自定义假期（或改过名的周末）则把日期范围单独排成一行稍重的文字，
 * 让「这是哪一段」比「还有几天」先被看到。
 */
const props = defineProps<{
  entry: HolidayEntry
  counts: Record<HolidayStatus, number>
  todayKey: string
}>()

const holiday = computed(() => props.entry.holiday)
const total = computed(() => props.counts.home + props.counts.stay)

/** 名称已经就是日期范围时不再重复一行（自动生成、或教师原样保留名称的周末） */
const showDateLine = computed(() => holiday.value.name !== formatHolidayRange(holiday.value))

/** 正在进行中的假期在状态行上稍作强调；已结束的退到最淡，避免和未来项抢注意力 */
const isCurrent = computed(
  () => props.todayKey >= holiday.value.startDate && props.todayKey <= holiday.value.endDate,
)
const isPast = computed(() => props.todayKey > holiday.value.endDate)

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

    <p v-if="showDateLine" class="card-date">{{ formatHolidayRange(holiday) }}</p>

    <p class="card-meta" :class="{ 'is-current': isCurrent, 'is-past': isPast }">
      <span class="status-dot" aria-hidden="true" />
      {{ describeHoliday(holiday, todayKey) }}
    </p>

    <div class="card-bar" aria-hidden="true">
      <span class="bar-seg is-home" :style="{ width: widthOf(counts.home) }" />
      <span class="bar-seg is-stay" :style="{ width: widthOf(counts.stay) }" />
    </div>

    <p class="card-counts">
      离校 <strong>{{ counts.home }}</strong> · 留校 <strong>{{ counts.stay }}</strong>
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

/* 日期范围单独一行、稍重：自定义假期的名称（如「国庆」）本身不含日期，
   让「这是哪一段」先于「还有几天」被看到 */
.card-date {
  margin-top: var(--space-1);
  font-size: var(--text-md);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.card-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-1);
  font-size: var(--font-secondary);
  color: var(--color-text-tertiary);
}

.status-dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--color-text-faint);
}

.card-meta.is-current {
  color: var(--color-primary-dark);
  font-weight: var(--font-weight-medium);
}

.card-meta.is-current .status-dot {
  background: var(--color-primary);
}

.card-meta.is-past {
  color: var(--color-text-faint);
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
