<script setup lang="ts">
interface Props {
  title?: string
  subtitle?: string
  padding?: 'none' | 'compact' | 'normal'
}

withDefaults(defineProps<Props>(), {
  title: '',
  subtitle: '',
  padding: 'normal',
})
</script>

<template>
  <section class="app-card" :class="`padding-${padding}`">
    <header v-if="title || $slots.actions" class="card-header">
      <div class="card-heading">
        <h3 class="card-title">{{ title }}</h3>
        <p v-if="subtitle" class="card-subtitle">{{ subtitle }}</p>
      </div>
      <div v-if="$slots.actions" class="card-actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="card-body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.app-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  transition:
    box-shadow var(--transition-base),
    transform var(--transition-base);
}

.app-card:hover {
  box-shadow: var(--shadow-md);
}

.padding-normal {
  padding: 22px;
}

.padding-compact {
  padding: 14px 16px;
}

.padding-none {
  padding: 0;
}

.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.card-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
}

.card-subtitle {
  margin-top: 2px;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
