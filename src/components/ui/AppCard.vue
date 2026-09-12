<script setup lang="ts">
interface Props {
  title?: string
  subtitle?: string
  padding?: 'none' | 'compact' | 'normal'
  /** hover 上浮（CDL AppCard 同款动效）；默认只做轻阴影变化 */
  hoverable?: boolean
}

withDefaults(defineProps<Props>(), {
  title: '',
  subtitle: '',
  padding: 'normal',
  hoverable: false,
})
</script>

<template>
  <section class="app-card" :class="[`padding-${padding}`, { 'app-card--hoverable': hoverable }]">
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
/* CDL AppCard：毛玻璃 + 24px 圆角 + 轻阴影（与 Changdu Memory 同一份实现） */
.app-card {
  background: var(--glass-bg-card);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  transition:
    box-shadow var(--transition-spring),
    transform var(--transition-spring),
    border-color var(--transition-spring);
}

.app-card:hover {
  box-shadow: var(--shadow-md);
}

/* hoverable：CDL 上浮动效（点击型卡片用） */
.app-card--hoverable {
  cursor: pointer;
}

.app-card--hoverable:hover {
  border-color: transparent;
  box-shadow: var(--shadow-hover);
  transform: translateY(-3px);
}

.padding-normal {
  padding: var(--spacing-page);
}

.padding-compact {
  padding: var(--spacing-md) var(--spacing-card);
}

.padding-none {
  padding: 0;
}

.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: var(--spacing-card);
}

.card-title {
  /* V5.2 卡片标题：26–30px Bold */
  font-size: var(--font-card-title);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.card-subtitle {
  margin-top: 2px;
  font-size: var(--font-secondary);
  color: var(--color-text-tertiary);
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
