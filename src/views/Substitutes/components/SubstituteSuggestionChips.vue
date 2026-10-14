<script setup lang="ts">
import { computed } from 'vue'

/**
 * SubstituteSuggestionChips — 教师名 / 科目的「用过的」快捷填入（v3.7.5 §6.1）。
 *
 * 候选全部来自教师**自己已经登记过的代课记录**（store 的 `teacherOptions` /
 * `subjectOptions`，从既存记录实时派生）。**原样列出、原样填入**：
 * 不做近似合并、不按前缀猜身份——「王老师」与「王丽」是两个候选，点哪个填哪个
 * （§6.1：不得擅自将不同姓名合并或自动推断教师身份）。
 *
 * 当前已填的值不出现在候选里：点一个等于当前值的按钮什么也不会发生，
 * 一个没反应的按钮比没有按钮更糟（同 FundCategoryPicker 对自建项的处理）。
 * 候选为空（第一次登记）时整块不渲染，表单不会多出一行空白。
 */
const props = withDefaults(
  defineProps<{
    /** 候选名（来自 store 的派生列表，已排好序） */
    options: readonly string[]
    /** 当前已填的值：与它相同的候选不再列出 */
    current?: string
    /** 最多列几个：再多就换行占版面，剩下的靠手打也不慢 */
    limit?: number
  }>(),
  { current: '', limit: 8 },
)

const emit = defineEmits<{ pick: [value: string] }>()

const shown = computed(() => {
  const used = props.current.trim()
  return props.options.filter((name) => name !== used).slice(0, props.limit)
})
</script>

<template>
  <div v-if="shown.length > 0" class="suggest" role="group" aria-label="用过的名称">
    <span class="suggest-label">用过的</span>
    <button
      v-for="name in shown"
      :key="name"
      type="button"
      class="suggest-chip"
      @click="emit('pick', name)"
    >
      {{ name }}
    </button>
  </div>
</template>

<style scoped>
.suggest {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-top: calc(-1 * var(--space-2));
}

.suggest-label {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.suggest-chip {
  padding: 2px 10px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-full);
  background: var(--color-bg-white);
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
  cursor: pointer;
  transition:
    background var(--transition-fast),
    color var(--transition-fast),
    border-color var(--transition-fast);
}

.suggest-chip:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--bg-hover);
}

.suggest-chip:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}
</style>
