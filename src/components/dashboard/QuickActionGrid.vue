<script lang="ts">
import type { LucideIcon } from 'lucide-vue-next'

/** 对外类型：调用方 import 后喂 items */
export interface QuickAction {
  icon: LucideIcon
  label: string
  description?: string
  to: string
}
</script>

<script setup lang="ts">
/**
 * QuickActionGrid — 快捷操作四宫格（V2.0.2-alpha · Phase UI-3 沉淀）：
 * 图标置顶 + 标题 + 描述；Hover 背景轻亮（不是传统菜单按钮，无按钮感）。
 * 桌面 4 列 / 平板 2 列 / 手机 1 列（跟随 Dashboard Grid，禁止固定宽度）。
 * 以后可扩展更多入口（items 驱动）。
 */
defineProps<{
  items: QuickAction[]
}>()
</script>

<template>
  <div class="quick-grid">
    <RouterLink v-for="item in items" :key="item.to" :to="item.to" class="quick-action">
      <span class="quick-action__icon" aria-hidden="true">
        <component :is="item.icon" :size="24" :stroke-width="2" />
      </span>
      <span class="quick-action__label">{{ item.label }}</span>
      <span v-if="item.description" class="quick-action__desc">{{ item.description }}</span>
    </RouterLink>
  </div>
</template>

<style scoped>
.quick-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--card-gap);
}

@media (max-width: 1023px) {
  .quick-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 639px) {
  .quick-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.quick-action {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--spacing-card) var(--space-3);
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  text-align: center;
  text-decoration: none;
  transition:
    background var(--duration-base) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out);
}

/* Hover：背景轻亮，不做按钮感、不明显跳动 */
@media (hover: hover) {
  .quick-action:hover {
    background: var(--color-primary-bg);
    box-shadow: var(--shadow-sm);
  }
}

.quick-action:active {
  background: var(--color-primary-bg-hover);
}

.quick-action:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.quick-action__icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  background: var(--color-primary-soft);
  color: var(--color-primary-dark);
}

.quick-action__label {
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.quick-action__desc {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}
</style>
