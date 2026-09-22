<script setup lang="ts">
import { computed } from 'vue'
import { ArrowDownLeft, ArrowUpRight } from 'lucide-vue-next'

import { AppBadge } from '@/components/ui'
import { categoryIcon, formatFlowAmount } from '@/utils/fund'
import { formatMonthDay } from '@/utils/date'
import type { FundFlowEntry } from '@/types/fund'

/**
 * FundFlowItem — 流水列表的一行（v3.6.0）。
 *
 * 一行讲四件事：什么分类（图标）、这笔是什么（标题）、什么时候（日期）、进出多少（金额）。
 * 收入绿、支出红（规格第十二节）——**颜色不是唯一线索**：金额自带 `+` / `-` 符号，
 * 色盲教师与黑白打印同样读得出来。
 *
 * 收费批次行多一个「批次」徽标：它不可编辑（金额是勾选算出来的，不是一个可以改的数），
 * 点进去看的是名单，不是编辑表单。徽标是这一差别在列表上的唯一提示。
 */
const props = defineProps<{
  entry: FundFlowEntry
  /** 渐入延迟序号（父级遍历赋值） */
  index?: number
}>()

const emit = defineEmits<{ select: [FundFlowEntry] }>()

/** 预设分类的 emoji；自定义分类没有图标，用方向箭头兜底（不硬塞一个与内容无关的表情） */
const icon = computed(() => categoryIcon(props.entry.category, props.entry.type))

const isIncome = computed(() => props.entry.type === 'income')
</script>

<template>
  <button
    type="button"
    class="flow-row"
    :style="{ '--flow-index': index ?? 0 }"
    @click="emit('select', entry)"
  >
    <span class="flow-icon" :class="isIncome ? 'is-income' : 'is-expense'" aria-hidden="true">
      <span v-if="icon" class="flow-icon-emoji">{{ icon }}</span>
      <ArrowDownLeft v-else-if="isIncome" :size="18" :stroke-width="2" />
      <ArrowUpRight v-else :size="18" :stroke-width="2" />
    </span>

    <span class="flow-main">
      <span class="flow-title-line">
        <span class="flow-title">{{ entry.title }}</span>
        <AppBadge v-if="entry.kind === 'collection'" variant="primary" size="sm">批次</AppBadge>
      </span>
      <span class="flow-meta">
        <span class="flow-category">{{ entry.category }}</span>
        <span class="flow-dot" aria-hidden="true">·</span>
        <span class="flow-date">{{ formatMonthDay(entry.date) }}</span>
        <template v-if="entry.kind === 'collection' && entry.totalCount">
          <span class="flow-dot" aria-hidden="true">·</span>
          <span>已交 {{ entry.paidCount }}/{{ entry.totalCount }}</span>
        </template>
      </span>
    </span>

    <span class="flow-amount" :class="isIncome ? 'is-income' : 'is-expense'">
      {{ formatFlowAmount(entry) }}
    </span>
  </button>
</template>

<style scoped>
.flow-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-3) var(--space-3);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background var(--transition-fast);
  opacity: 0;
  animation: flow-in var(--duration-base) var(--ease-out) forwards;
  animation-delay: calc(var(--flow-index, 0) * 30ms);
}

@keyframes flow-in {
  to {
    opacity: 1;
  }
}

@media (hover: hover) {
  .flow-row:hover {
    background: var(--bg-hover);
  }
}

.flow-row:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.flow-icon {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  font-size: 18px;
  line-height: 1;
}

.flow-icon.is-income {
  background: var(--color-success-soft);
}

.flow-icon.is-expense {
  background: var(--color-danger-soft);
  color: var(--color-danger-strong);
}

.flow-icon-emoji {
  /* emoji 自带字面大小，这里只压一压行高，避免把方块撑变形 */
  font-size: 18px;
}

.flow-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.flow-title-line {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.flow-title {
  font-size: var(--font-content);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flow-meta {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
}

.flow-dot {
  color: var(--color-border-emphasis);
}

.flow-amount {
  flex-shrink: 0;
  font-size: var(--font-content);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
}

.flow-amount.is-income {
  color: var(--color-success-strong);
}

.flow-amount.is-expense {
  color: var(--color-danger-strong);
}

@media (max-width: 640px) {
  .flow-row {
    padding: var(--space-3) var(--space-2);
  }

  .flow-title {
    font-size: var(--font-secondary);
  }
}
</style>
