<script setup lang="ts">
import { useToast } from '@/composables/useToast'
import type { ToastVariant } from '@/types'

const { toasts, dismiss } = useToast()

const ICON_PATHS: Record<ToastVariant, string[]> = {
  info: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', 'M12 16v-4', 'M12 8h.01'],
  success: ['M20 6 9 17l-5-5'],
  warning: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', 'M12 8v4', 'M12 16h.01'],
  danger: ['M18 6 6 18', 'M6 6l12 12'],
}
</script>

<template>
  <Teleport to="body">
    <div class="toast-stack" aria-live="polite">
      <TransitionGroup name="toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="app-toast"
          :class="`is-${toast.variant}`"
          role="status"
        >
          <svg
            class="toast-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path v-for="d in ICON_PATHS[toast.variant]" :key="d" :d="d" />
          </svg>
          <p class="toast-message">{{ toast.message }}</p>
          <button
            class="toast-close"
            type="button"
            aria-label="关闭通知"
            @click="dismiss(toast.id)"
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
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-stack {
  position: fixed;
  top: var(--space-5);
  left: 0;
  right: 0;
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  pointer-events: none;
}

.app-toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  max-width: min(420px, calc(100vw - 32px));
  padding: var(--space-2) var(--space-3) var(--space-2) var(--space-4);
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
}

.toast-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.is-info .toast-icon {
  color: var(--color-primary);
}

.is-success .toast-icon {
  color: var(--color-success-strong);
}

.is-warning .toast-icon {
  color: var(--color-warning-strong);
}

.is-danger .toast-icon {
  color: var(--color-danger-strong);
}

.toast-message {
  font-size: var(--text-sm);
  line-height: 1.45;
  color: var(--color-text);
}

.toast-close {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
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

.toast-close:hover {
  background: var(--color-fill-disabled);
  color: var(--color-text);
}

.toast-close svg {
  width: 12px;
  height: 12px;
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity var(--duration-normal) var(--ease-standard),
    transform var(--duration-normal) var(--ease-standard);
}

.toast-enter-from {
  opacity: 0;
  transform: translateY(-10px) scale(0.96);
}

.toast-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.96);
}

.toast-move {
  transition: transform var(--duration-normal) var(--ease-standard);
}
</style>
