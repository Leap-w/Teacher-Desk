<script setup lang="ts">
interface Props {
  modelValue: boolean
  /** 开关文案（同时作为无障碍名称） */
  label?: string
  disabled?: boolean
}

withDefaults(defineProps<Props>(), {
  label: '',
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()
</script>

<template>
  <button
    type="button"
    class="app-switch"
    :class="{ 'is-disabled': disabled }"
    role="switch"
    :aria-checked="modelValue"
    :aria-label="label || undefined"
    :disabled="disabled"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span class="switch-track" aria-hidden="true">
      <span class="switch-knob" />
    </span>
    <span v-if="label" class="switch-label">{{ label }}</span>
  </button>
</template>

<style scoped>
.app-switch {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 44px;
  padding: 0;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.app-switch:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.app-switch.is-disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.switch-track {
  position: relative;
  flex-shrink: 0;
  width: 34px;
  height: 20px;
  border-radius: var(--radius-full);
  background: var(--color-border-strong);
  transition: background var(--transition-fast);
}

.app-switch[aria-checked='true'] .switch-track {
  background: var(--color-primary);
}

.switch-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--bg-card);
  transition: transform var(--transition-fast);
}

.app-switch[aria-checked='true'] .switch-knob {
  transform: translateX(14px);
}

.switch-label {
  font-size: var(--text-md);
  color: var(--color-text);
}
</style>
