<script setup lang="ts">
import { NotebookPen } from 'lucide-vue-next'

import { AppInput, EmptyState } from '@/components/ui'
import type { LeaveRecord } from '@/types/leave'
import LeaveCard from './LeaveCard.vue'

/**
 * LeaveHistorySection — 历史记录区（V2.0.5-alpha · Phase UI-4C 沉淀）：
 * 筛选 Chips + 搜索 + 卡片列表；筛选逻辑来自既有 filterLeaveRecords，不新增查询。
 */
defineProps<{
  records: LeaveRecord[]
  chipOptions: { key: string; label: string; count: number }[]
  filter: string
  keyword: string
  hasAny: boolean
  dutyGroupNames?: Map<string, string>
}>()

const emit = defineEmits<{
  'update:filter': [key: string]
  'update:keyword': [value: string]
  clear: []
  edit: [record: LeaveRecord]
  registerLeft: [record: LeaveRecord]
  registerBack: [record: LeaveRecord]
  remove: [record: LeaveRecord]
}>()
</script>

<template>
  <div class="history">
    <div class="history-tools">
      <AppInput
        :model-value="keyword"
        class="history-search"
        placeholder="搜索学生姓名或学号后四位"
        clearable
        @update:model-value="emit('update:keyword', $event)"
      />
      <div class="chip-row" role="group" aria-label="请假记录筛选">
        <button
          v-for="option in chipOptions"
          :key="option.key"
          type="button"
          class="chip"
          :class="{ 'is-active': filter === option.key }"
          :aria-pressed="filter === option.key ? 'true' : 'false'"
          @click="emit('update:filter', option.key)"
        >
          {{ option.label }}
          <span class="chip__count">{{ option.count }}</span>
        </button>
      </div>
    </div>

    <div v-if="records.length" class="history-list">
      <LeaveCard
        v-for="record in records"
        :key="record.id"
        :record="record"
        :duty-group="dutyGroupNames?.get(record.studentId)"
        @edit="emit('edit', $event)"
        @register-left="emit('registerLeft', $event)"
        @register-back="emit('registerBack', $event)"
        @remove="emit('remove', $event)"
      />
    </div>

    <div v-else class="history-empty">
      <EmptyState
        v-if="hasAny"
        :icon="NotebookPen"
        title="未找到匹配的请假记录"
        description="换个关键词，或清除筛选条件再试试。"
      >
        <slot name="clearAction" />
      </EmptyState>
      <EmptyState
        v-else
        :icon="NotebookPen"
        title="还没有请假记录"
        description="用右下角的「＋ 记录请假」登记第一条。"
      />
    </div>
  </div>
</template>

<style scoped>
.history {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.history-tools {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.history-search {
  width: 260px;
  max-width: 100%;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-bg-white);
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  line-height: 1;
  cursor: pointer;
  user-select: none;
  transition:
    background var(--duration-base) var(--ease-out),
    color var(--duration-base) var(--ease-out),
    border-color var(--duration-base) var(--ease-out);
}

.chip:hover:not(.is-active) {
  background: var(--bg-hover);
  color: var(--color-text-primary);
}

.chip:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.chip.is-active {
  background: var(--color-primary-soft);
  border-color: transparent;
  color: var(--color-primary-dark);
  font-weight: var(--font-weight-medium);
}

.chip__count {
  font-size: var(--text-xs);
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.chip.is-active .chip__count {
  color: var(--color-primary-dark);
  opacity: 0.75;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.history-empty {
  padding: var(--space-4) 0;
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
}
</style>
