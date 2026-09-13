<script lang="ts">
/** 筛选键：UI-4A 扩展出「今日已请假 / 有备注」两个真实数据筛选（预留位转正） */
export type StudentFilterKey = 'all' | 'male' | 'female' | 'cadre' | 'onleave' | 'remarked'

export interface FilterChipOption {
  key: StudentFilterKey
  label: string
  count: number
}
</script>

<script setup lang="ts">
/**
 * StudentFilterChips — iOS 风格快速筛选 Chips（V2.0.3-alpha · Phase UI-4A 沉淀）：
 * 全部 / 男生 / 女生 / 班委 / 已请假 / 有备注；切换 200ms；
 * 计数来自真实 Store，禁止假数据。
 */
defineProps<{
  options: FilterChipOption[]
  modelValue: StudentFilterKey
}>()

const emit = defineEmits<{
  'update:modelValue': [key: StudentFilterKey]
}>()
</script>

<template>
  <div class="chip-row" role="group" aria-label="快速筛选">
    <button
      v-for="option in options"
      :key="option.key"
      type="button"
      class="chip"
      :class="{ 'is-active': modelValue === option.key }"
      :aria-pressed="modelValue === option.key ? 'true' : 'false'"
      @click="emit('update:modelValue', option.key)"
    >
      {{ option.label }}
      <span class="chip__count">{{ option.count }}</span>
    </button>
  </div>
</template>

<style scoped>
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
</style>
