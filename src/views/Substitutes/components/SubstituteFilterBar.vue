<script setup lang="ts">
import { computed } from 'vue'
import { CalendarRange } from 'lucide-vue-next'

import { AppButton, AppInput } from '@/components/ui'

/**
 * SubstituteFilterBar — 代课记录的日期范围筛选（v3.7.5 §6.4）。
 *
 * **两端都含**，留空即该端不限（与 `utils/substitute.ts` 的 `isInSubstituteRange` 同一口径）：
 * 只填开始日期 = 「这天起至今的全部」；只填结束日期 = 「这天为止的全部」。
 * 这是筛列表同时也是筛统计——数字与列表必须同一份数据（§6.4：统计实时算）。
 *
 * 日期用原生 `<input type="date">`：它给的是 `YYYY-MM-DD`，与全项目的数据格式一致，
 * 也让手机上的日期选择器直接可用（同「按天指定值日组」的做法）。
 */
const props = defineProps<{
  from: string
  to: string
}>()

const emit = defineEmits<{
  'update:from': [value: string]
  'update:to': [value: string]
  clear: []
}>()

const hasRange = computed(() => Boolean(props.from || props.to))
</script>

<template>
  <div class="filter-bar">
    <span class="filter-label">
      <CalendarRange :size="15" :stroke-width="2" aria-hidden="true" />
      日期范围
    </span>

    <div class="filter-range">
      <AppInput
        :model-value="props.from"
        type="date"
        size="sm"
        aria-label="开始日期"
        @update:model-value="emit('update:from', String($event))"
      />
      <span class="range-sep" aria-hidden="true">至</span>
      <AppInput
        :model-value="props.to"
        type="date"
        size="sm"
        aria-label="结束日期"
        @update:model-value="emit('update:to', String($event))"
      />
    </div>

    <p class="filter-hint">留空 = 不限。筛选只影响下面的列表与统计，不动任何记录。</p>

    <AppButton v-if="hasRange" variant="ghost" size="sm" @click="emit('clear')">
      清除筛选
    </AppButton>
  </div>
</template>

<style scoped>
.filter-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
}

.filter-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
}

.filter-range {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

/* 日期框在窄屏各占半行；桌面按内容宽度即可 */
.filter-range :deep(.app-input),
.filter-range :deep(.app-select) {
  width: 152px;
}

.range-sep {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.filter-hint {
  margin-left: auto;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

@media (max-width: 640px) {
  .filter-range {
    width: 100%;
  }

  .filter-range :deep(.app-input),
  .filter-range :deep(.app-select) {
    flex: 1;
    width: auto;
  }

  .filter-hint {
    margin-left: 0;
  }
}
</style>
