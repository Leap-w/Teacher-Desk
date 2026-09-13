<script setup lang="ts">
import type { BadgeVariant } from '@/types'

interface Props {
  variant?: BadgeVariant
  size?: 'sm' | 'md'
}

withDefaults(defineProps<Props>(), {
  variant: 'neutral',
  size: 'md',
})
</script>

<template>
  <span class="app-badge" :class="[`is-${variant}`, `is-${size}`]">
    <slot />
  </span>
</template>

<style scoped>
.app-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  border-radius: var(--radius-full);
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
}

.is-md {
  padding: 5px 10px;
  font-size: var(--text-xs);
}

.is-sm {
  padding: 3px 8px;
  font-size: var(--text-xs);
}

.is-primary {
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
}

.is-success {
  background: var(--color-success-soft);
  color: var(--color-success-strong);
}

.is-warning {
  background: var(--color-warning-soft);
  color: var(--color-warning-strong);
}

.is-danger {
  background: var(--color-danger-soft);
  color: var(--color-danger-strong);
}

.is-neutral {
  background: var(--color-fill-disabled);
  color: var(--color-text-secondary);
}
</style>
