<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  modelValue?: string | number
  rows?: number
  placeholder?: string
  disabled?: boolean
  readonly?: boolean
  /** 仅控制边框与焦点外观，错误文案由 AppField 呈现 */
  error?: boolean
  maxlength?: number
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  rows: 3,
  placeholder: '',
  disabled: false,
  readonly: false,
  error: false,
  maxlength: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  focus: [event: FocusEvent]
  blur: [event: FocusEvent]
}>()

defineOptions({ inheritAttrs: false })

const value = computed({
  get: () => String(props.modelValue ?? ''),
  set: (v: string) => emit('update:modelValue', v),
})
</script>

<template>
  <div class="app-textarea" :class="{ 'is-disabled': disabled, 'is-error': error }">
    <textarea
      v-model="value"
      v-bind="$attrs"
      class="textarea-inner"
      :rows="rows"
      :placeholder="placeholder"
      :disabled="disabled"
      :readonly="readonly"
      :maxlength="maxlength"
      @focus="emit('focus', $event)"
      @blur="emit('blur', $event)"
    />
  </div>
</template>

<style scoped>
.app-textarea {
  display: inline-flex;
  width: 100%;
  border-radius: var(--radius-lg);
}

.textarea-inner {
  width: 100%;
  border: 1px solid var(--color-border-strong);
  border-radius: inherit;
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-size: var(--text-md);
  line-height: 1.6;
  padding: var(--space-2) var(--space-4);
  outline: none;
  resize: vertical;
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    background var(--transition-fast);
}

.textarea-inner::placeholder {
  color: var(--color-text-faint);
}

.app-textarea:hover:not(.is-disabled) .textarea-inner {
  border-color: var(--color-border-emphasis);
}

.app-textarea:focus-within .textarea-inner {
  border-color: var(--color-primary);
  box-shadow: var(--ring-focus);
}

.is-error .textarea-inner {
  border-color: var(--color-danger);
}

.is-error:focus-within .textarea-inner {
  box-shadow: var(--ring-danger);
}

.is-disabled .textarea-inner {
  background: var(--color-fill-disabled);
  color: var(--color-text-secondary);
  cursor: not-allowed;
  resize: none;
}
</style>
