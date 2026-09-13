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
/* CDL Button：12px 圆角 + spring 过渡（单一动效曲线，见 theme.css） */
.app-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  border: none;
  cursor: pointer;
  border-radius: var(--radius-button);
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0.2px;
  transition:
    transform var(--transition-fast),
    box-shadow var(--transition-fast),
    background var(--transition-fast),
    opacity var(--transition-fast);
}

.app-button:hover:not(:disabled) {
  /* UI-7：按钮 hover 轻微抬升 */
  transform: translateY(-1px);
}

.app-button:active:not(:disabled) {
  transform: scale(0.97);
}

.app-button:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.app-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.is-md {
  height: 40px;
  padding: 0 var(--space-5);
  font-size: var(--text-md);
}

.is-sm {
  height: 32px;
  padding: 0 var(--space-4);
  font-size: var(--text-sm);
  border-radius: var(--radius-sm);
}

.is-primary {
  background: var(--color-primary);
  color: var(--color-text-inverse);
  box-shadow: var(--shadow-primary-glow);
}

.is-primary:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.is-primary:active:not(:disabled) {
  background: var(--color-primary-active);
}

.is-secondary {
  background: var(--color-primary-bg);
  color: var(--color-primary-dark);
}

.is-secondary:hover:not(:disabled) {
  background: var(--color-primary-bg-hover);
}

.is-ghost {
  background: transparent;
  color: var(--color-text-secondary);
}

.is-ghost:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--color-text-primary);
}

.is-danger {
  background: var(--color-danger);
  color: var(--color-text-inverse);
  box-shadow: var(--shadow-danger-glow);
}

.is-danger:hover:not(:disabled) {
  background: var(--color-danger-strong);
}

.spinner {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 2px solid var(--color-primary-soft);
  border-top-color: var(--color-primary);
  animation: spin 0.7s linear infinite;
}

.is-primary .spinner,
.is-danger .spinner {
  border-color: rgba(255, 255, 255, 0.35);
  border-top-color: var(--color-text-inverse);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
