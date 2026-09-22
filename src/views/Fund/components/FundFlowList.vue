<script setup lang="ts">
import { Wallet } from 'lucide-vue-next'

import { EmptyState } from '@/components/ui'
import { FUND_RANGE_LABELS } from '@/utils/fund'
import type { FundFlowEntry, FundRange } from '@/types/fund'
import FundFlowItem from './FundFlowItem.vue'

/**
 * FundFlowList — 收支流水列表（v3.6.0）。
 *
 * 两种空态分得很清楚：**一笔都没有**（引导记第一笔）与**这个范围内没有**
 * （账上有东西，只是「本月」里没有）——同一种空态会让教师以为数据丢了。
 */
defineProps<{
  entries: FundFlowEntry[]
  range: FundRange
  /** 全部口径下是否有流水（区分「还没记账」与「这个范围里没有」） */
  hasAny: boolean
}>()

const emit = defineEmits<{ select: [FundFlowEntry] }>()
</script>

<template>
  <div class="flow-panel">
    <div v-if="entries.length > 0" class="flow-list" role="list">
      <FundFlowItem
        v-for="(entry, index) in entries"
        :key="entry.id"
        :entry="entry"
        :index="index"
        @select="emit('select', $event)"
      />
    </div>

    <EmptyState
      v-else-if="hasAny"
      :icon="Wallet"
      :title="`${FUND_RANGE_LABELS[range]}没有收支记录`"
      description="账本里有记录，只是不落在当前这个范围里。换成「全部」看看。"
    />
    <EmptyState
      v-else
      :icon="Wallet"
      title="还没有收支记录"
      description="收班费、买东西的每一笔都记在这里，余额会自动算出来。"
    />
  </div>
</template>

<style scoped>
.flow-panel {
  padding: var(--space-2);
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
}

.flow-list {
  display: flex;
  flex-direction: column;
}

/* 行与行之间的分隔线：最后一行不带（否则面板底部多一条悬空的线） */
.flow-list > :deep(.flow-row) + :deep(.flow-row) {
  border-top: 1px solid var(--color-border-divider);
  border-radius: 0;
}

.flow-list > :deep(.flow-row):first-child {
  border-radius: var(--radius-md) var(--radius-md) 0 0;
}

.flow-list > :deep(.flow-row):last-child {
  border-radius: 0 0 var(--radius-md) var(--radius-md);
}
</style>
