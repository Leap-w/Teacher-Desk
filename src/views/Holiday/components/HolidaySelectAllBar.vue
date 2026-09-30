<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'

import type { SelectAllState } from '@/utils/holidayQuery'

/**
 * HolidaySelectAllBar — 名单顶部的「全选」（v3.6.2 规格第 10–13 节）。
 *
 * 三条口径：
 *
 * 1. **全选针对当前筛选结果**，不是永远针对全班。当前筛的是「昌都市外离校 12 人」，
 *    点全选就只选这 12 人（`visibleTotal` 与 `visibleSelected` 都由页面按**当前名单**给）。
 * 2. **标准三态**：未选 / 部分选中（indeterminate）/ 全部选中。部分选中用原生
 *    `input.indeterminate`——它正是浏览器与读屏软件对「部分选中」的标准表达。
 * 3. **「已选 X 人」只数真实选中的学生**（`selectedCount`），不是「当前筛选人数」。
 *    选中跨筛选保留（v3.6.1 起的既有机制），所以它可能大于眼前这份名单的人数；
 *    那时把「其中 K 人不在当前筛选结果中」写出来，免得教师以为屏幕上这些人都在选中态里。
 */
const props = defineProps<{
  /** 三态：未选 / 部分选中 / 全部选中（由页面用 `selectAllState()` 算好传进来） */
  state: SelectAllState
  /** 当前筛选结果的人数（为 0 时勾选框禁用） */
  visibleTotal: number
  /** 实际选中的学生总数（可含不在当前筛选结果里的） */
  selectedCount: number
  /** 选中但不在当前筛选结果中的人数 */
  outsideCount: number
}>()

const emit = defineEmits<{ toggleAll: [] }>()

const box = ref<HTMLInputElement>()

const allChecked = computed(() => props.state === 'all')
const indeterminate = computed(() => props.state === 'partial')

// 原生 checkbox 的 indeterminate 是**属性**不是 attribute，只能这样写
watchEffect(() => {
  if (box.value) box.value.indeterminate = indeterminate.value
})
</script>

<template>
  <div class="select-all-bar">
    <label class="select-all">
      <input
        ref="box"
        type="checkbox"
        class="select-all-box"
        :checked="allChecked"
        :disabled="visibleTotal === 0"
        @change="emit('toggleAll')"
      />
      <span class="select-all-label">全选</span>
    </label>

    <p class="select-count">
      已选 <strong>{{ selectedCount }}</strong> 人
      <span v-if="outsideCount > 0" class="select-outside">
        （其中 {{ outsideCount }} 人不在当前筛选结果中）
      </span>
    </p>
  </div>
</template>

<style scoped>
.select-all-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: 44px;
  padding: var(--space-1) var(--space-3);
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
}

.select-all {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  /* 触控目标 ≥44px */
  min-height: 40px;
  padding-right: var(--space-2);
  cursor: pointer;
  user-select: none;
}

.select-all-box {
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--color-primary);
  cursor: pointer;
}

.select-all-box:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
  border-radius: var(--radius-xs);
}

.select-all-label {
  font-size: var(--text-md);
  color: var(--color-text-primary);
}

.select-count {
  font-size: var(--font-secondary);
  color: var(--color-text-secondary);
}

.select-count strong {
  color: var(--color-text-primary);
  font-weight: var(--font-weight-semibold);
}

.select-outside {
  color: var(--color-warning-strong);
}
</style>
