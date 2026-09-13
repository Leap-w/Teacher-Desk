<script setup lang="ts">
import type { LucideIcon } from 'lucide-vue-next'

/**
 * ToolCard — 课堂工具卡片壳（V2.3.0-alpha · Phase Classroom-1）。
 *
 * 大控件、远距离可操作：卡片本身是**非按钮**容器（内部有各自的开始按钮），
 * Hover 2px 抬升、200ms 过渡；标题与说明的字号按讲台距离定（18px / 14px）。
 */
defineProps<{
  title: string
  description: string
  icon: LucideIcon
}>()
</script>

<template>
  <section class="tool-card">
    <header class="tool-head">
      <span class="tool-icon" aria-hidden="true"
        ><component :is="icon" :size="22" :stroke-width="2"
      /></span>
      <span class="tool-text">
        <h2 class="tool-title">{{ title }}</h2>
        <p class="tool-desc">{{ description }}</p>
      </span>
      <slot name="actions" />
    </header>
    <div class="tool-body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.tool-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5);
  border: var(--border-hairline-width) solid var(--color-border-light);
  border-radius: var(--radius-xl);
  background: var(--bg-card);
  box-shadow: var(--shadow-xs);
  transition:
    transform var(--duration-base) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out);
}

.tool-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-sm);
}

.tool-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.tool-icon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  background: var(--color-primary-bg);
  color: var(--color-primary-strong);
}

.tool-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tool-title {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.tool-desc {
  margin: 0;
  font-size: var(--font-secondary);
  color: var(--color-text-tertiary);
}

.tool-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
</style>
