<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'primary',
  size: 'md',
  type: 'button',
  disabled: false,
  loading: false,
})

const isDisabled = computed(() => props.disabled || props.loading)
</script>

<template>
  <button
    :type="type"
    class="app-button"
    :class="[`is-${variant}`, `is-${size}`]"
    :disabled="isDisabled"
  >
    <span v-if="loading" class="spinner" aria-hidden="true" />
    <span class="button-content"><slot /></span>
  </button>
</template>

<style scoped>
.app-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: none;
  cursor: pointer;
  border-radius: 10px;
  font-weight: 600;
  letter-spacing: 0.2px;
  transition:
    transform var(--transition-fast),
    box-shadow var(--transition-fast),
    background var(--transition-fast),
    opacity var(--transition-fast);
}

.app-button:active:not(:disabled) {
  transform: scale(0.97);
}

.app-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.is-md {
  height: 38px;
  padding: 0 18px;
  font-size: 14px;
}

.is-sm {
  height: 30px;
  padding: 0 14px;
  font-size: 13px;
  border-radius: 9px;
}

.is-primary {
  background: var(--color-primary);
  color: #ffffff;
  box-shadow: 0 4px 12px rgba(47, 143, 131, 0.28);
}

.is-primary:hover:not(:disabled) {
  background: var(--color-primary-strong);
}

.is-secondary {
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
}

.is-secondary:hover:not(:disabled) {
  background: var(--color-primary-soft-strong);
}

.is-ghost {
  background: transparent;
  color: var(--color-text-secondary);
}

.is-ghost:hover:not(:disabled) {
  background: rgba(29, 29, 31, 0.05);
  color: var(--color-text);
}

.is-danger {
  background: var(--color-danger);
  color: #ffffff;
  box-shadow: 0 4px 12px rgba(255, 59, 48, 0.28);
}

.is-danger:hover:not(:disabled) {
  background: var(--color-danger-strong);
}

.spinner {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 2px solid rgba(47, 143, 131, 0.25);
  border-top-color: var(--color-primary);
  animation: spin 0.7s linear infinite;
}

.is-primary .spinner,
.is-danger .spinner {
  border-color: rgba(255, 255, 255, 0.35);
  border-top-color: #ffffff;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
