<script setup lang="ts" generic="T extends string">
/**
 * AppSegmented — iOS 风分段控件（v3.0.1-rc）。
 *
 * 三段以上的并列单选（深色模式、视角切换这类「同一维度的几档」）；
 * 只有 2 个明确动作的用 AppButton 组合，列表选择用 AppSelect——不硬套。
 * 选中块是一个**会滑动的底片**（transform 移动，不是各自变色），切换有方向感。
 * 全部视觉走令牌；键盘左右可切换（radio 语义）。
 */
const props = defineProps<{
  /** 各档：值 + 展示文案 */
  options: { value: T; label: string }[]
  /** 当前选中值（v-model） */
  modelValue: T
  /** 无障碍：控件名（radiogroup 的 aria-label） */
  label: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: T]
}>()

const activeIndex = () => props.options.findIndex((option) => option.value === props.modelValue)
</script>

<template>
  <div class="segmented" role="radiogroup" :aria-label="label">
    <span
      class="segmented__thumb"
      aria-hidden="true"
      :style="{
        transform: `translateX(${activeIndex() * 100}%)`,
        width: `calc(100% / ${options.length})`,
      }"
    />
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="segmented__item"
      :class="{ 'is-active': option.value === modelValue }"
      role="radio"
      :aria-checked="option.value === modelValue"
      @click="emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.segmented {
  position: relative;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  padding: 3px;
  background: var(--color-bg-subtle);
  border-radius: var(--radius-button);
  isolation: isolate;
}

/* 滑动底片：宽度 = 1/N，位移 = index × 100%（自身宽度） */
.segmented__thumb {
  position: absolute;
  inset: 3px auto 3px 3px;
  height: calc(100% - 6px);
  border-radius: calc(var(--radius-button) - 2px);
  background: var(--bg-card);
  box-shadow: var(--shadow-sm);
  transition: transform var(--duration-base) var(--ease-spring);
  z-index: 0;
}

.segmented__item {
  position: relative;
  z-index: 1;
  padding: var(--spacing-sm) var(--spacing-md);
  border: 0;
  background: transparent;
  border-radius: calc(var(--radius-button) - 2px);
  font-size: var(--text-md);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: color var(--duration-base) var(--ease-out);
}

.segmented__item:hover {
  color: var(--color-text-primary);
}

.segmented__item.is-active {
  color: var(--color-text-primary);
}

.segmented__item:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}
</style>
