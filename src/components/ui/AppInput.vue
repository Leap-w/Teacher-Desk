<script setup lang="ts">
import { computed, ref } from 'vue'

interface Props {
  modelValue?: string | number
  type?: string
  placeholder?: string
  disabled?: boolean
  readonly?: boolean
  /** 仅控制边框与焦点外观，错误文案由 AppField 呈现 */
  error?: boolean
  size?: 'sm' | 'md'
  /** 显示清空按钮 */
  clearable?: boolean
  maxlength?: number
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  type: 'text',
  placeholder: '',
  disabled: false,
  readonly: false,
  error: false,
  size: 'md',
  clearable: false,
  maxlength: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  focus: [event: FocusEvent]
  blur: [event: FocusEvent]
}>()

defineOptions({ inheritAttrs: false })

const inputRef = ref<HTMLInputElement>()

const value = computed({
  get: () => String(props.modelValue ?? ''),
  set: (v: string) => emit('update:modelValue', v),
})

function clear() {
  emit('update:modelValue', '')
  inputRef.value?.focus()
}
</script>

<template>
  <div
    class="app-input"
    :class="[`is-${size}`, { 'is-disabled': disabled, 'is-error': error, 'has-clear': clearable }]"
  >
    <input
      ref="inputRef"
      v-model="value"
      v-bind="$attrs"
      class="input-inner"
      :type="type"
      :placeholder="placeholder"
      :disabled="disabled"
      :readonly="readonly"
      :maxlength="maxlength"
      @focus="emit('focus', $event)"
      @blur="emit('blur', $event)"
    />
    <button
      v-if="clearable && value && !disabled && !readonly"
      class="clear-button"
      type="button"
      aria-label="清空输入"
      @click="clear"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.app-input {
  position: relative;
  display: inline-flex;
  width: 100%;
  border-radius: var(--radius-input);
}

.input-inner {
  width: 100%;
  border: 1px solid var(--color-border-strong);
  border-radius: inherit;
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-size: var(--text-md);
  outline: none;
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    background var(--transition-fast);
}

.is-md .input-inner {
  height: 38px;
  padding: 0 var(--space-4);
}

.is-sm .input-inner {
  height: 30px;
  padding: 0 var(--space-3);
  font-size: var(--text-sm);
}

.has-clear .input-inner {
  padding-right: var(--space-6);
}

.input-inner::placeholder {
  color: var(--color-text-faint);
}

.app-input:hover:not(.is-disabled) .input-inner {
  border-color: var(--color-border-emphasis);
}

.app-input:focus-within .input-inner {
  border-color: var(--color-primary);
  box-shadow: var(--ring-focus);
}

.is-error .input-inner {
  border-color: var(--color-danger);
}

.is-error:focus-within .input-inner {
  box-shadow: var(--ring-danger);
}

.is-disabled .input-inner {
  background: var(--color-fill-disabled);
  color: var(--color-text-secondary);
  cursor: not-allowed;
}

.clear-button {
  position: absolute;
  top: 50%;
  right: var(--space-2);
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background var(--transition-fast),
    color var(--transition-fast);
}

.clear-button:hover {
  background: var(--color-fill-disabled);
  color: var(--color-text);
}

.clear-button svg {
  width: 12px;
  height: 12px;
}
</style>
