<script setup lang="ts" generic="T extends string | number">
import { computed } from 'vue'

import type { SelectOption } from '@/types'

interface Props {
  modelValue?: T
  options?: SelectOption<T>[]
  placeholder?: string
  disabled?: boolean
  /** 仅控制边框与焦点外观，错误文案由 AppField 呈现 */
  error?: boolean
  size?: 'sm' | 'md'
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: undefined,
  options: () => [],
  placeholder: '',
  disabled: false,
  error: false,
  size: 'md',
})

const emit = defineEmits<{
  'update:modelValue': [value: T]
}>()

defineOptions({ inheritAttrs: false })

const value = computed(() => (props.modelValue === undefined ? '' : String(props.modelValue)))

function onChange(event: Event) {
  const el = event.target as HTMLSelectElement
  const matched = props.options.find((option) => String(option.value) === el.value)
  emit('update:modelValue', matched ? matched.value : (el.value as T))
}
</script>

<template>
  <div class="app-select" :class="[`is-${size}`, { 'is-disabled': disabled, 'is-error': error }]">
    <select
      v-bind="$attrs"
      class="select-inner"
      :value="value"
      :disabled="disabled"
      @change="onChange"
    >
      <option v-if="placeholder" value="" disabled hidden>{{ placeholder }}</option>
      <option
        v-for="option in options"
        :key="option.value"
        :value="option.value"
        :disabled="option.disabled"
      >
        {{ option.label }}
      </option>
    </select>
    <svg
      class="select-chevron"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  </div>
</template>

<style scoped>
.app-select {
  position: relative;
  display: inline-flex;
  width: 100%;
  border-radius: var(--radius-lg);
}

.select-inner {
  width: 100%;
  border: 1px solid var(--color-border-strong);
  border-radius: inherit;
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-size: var(--text-md);
  outline: none;
  appearance: none;
  -webkit-appearance: none;
  cursor: pointer;
  padding-right: calc(var(--space-4) + var(--space-4));
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    background var(--transition-fast);
}

.is-md .select-inner {
  height: 38px;
  padding-left: var(--space-4);
}

.is-sm .select-inner {
  height: 30px;
  padding-left: var(--space-3);
  font-size: var(--text-sm);
}

.select-inner:invalid,
.select-inner option[value=''][hidden] {
  color: var(--color-text-faint);
}

.app-select:hover:not(.is-disabled) .select-inner {
  border-color: var(--color-border-emphasis);
}

.app-select:focus-within .select-inner {
  border-color: var(--color-primary);
  box-shadow: var(--ring-focus);
}

.is-error .select-inner {
  border-color: var(--color-danger);
}

.is-error:focus-within .select-inner {
  box-shadow: var(--ring-danger);
}

.is-disabled .select-inner {
  background: var(--color-fill-disabled);
  color: var(--color-text-secondary);
  cursor: not-allowed;
}

.select-chevron {
  position: absolute;
  top: 50%;
  right: var(--space-3);
  transform: translateY(-50%);
  width: 15px;
  height: 15px;
  color: var(--color-text-secondary);
  pointer-events: none;
}
</style>
