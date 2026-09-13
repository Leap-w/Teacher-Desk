<script setup lang="ts">
import type { LucideIcon } from 'lucide-vue-next'

/**
 * DashboardStatCard — 统一统计卡（V2.0.2-alpha · Phase UI-3 沉淀）：
 * 左图标 / 中数字（字号大于普通标题）/ 下说明。用于今日待办、学生人数、
 * 请假人数、值日人数等；提供 to 时整卡可点（RouterLink），否则纯展示。
 * Hover：2px 微抬升。
 */
defineProps<{
  icon: LucideIcon
  value: string | number
  label: string
  hint?: string
  /** 可选跳转；提供即整卡可点 */
  to?: string
}>()
</script>

<template>
  <RouterLink v-if="to" :to="to" class="stat-card stat-card--link">
    <span class="stat-card__icon" aria-hidden="true">
      <component :is="icon" :size="20" :stroke-width="2" />
    </span>
    <span class="stat-card__value">{{ value }}</span>
    <span class="stat-card__label">{{ label }}</span>
    <span v-if="hint" class="stat-card__hint">{{ hint }}</span>
  </RouterLink>
  <div v-else class="stat-card">
    <span class="stat-card__icon" aria-hidden="true">
      <component :is="icon" :size="20" :stroke-width="2" />
    </span>
    <span class="stat-card__value">{{ value }}</span>
    <span class="stat-card__label">{{ label }}</span>
    <span v-if="hint" class="stat-card__hint">{{ hint }}</span>
  </div>
</template>

<style scoped>
.stat-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--spacing-card);
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  text-decoration: none;
  transition:
    transform var(--duration-base) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out);
}

@media (hover: hover) {
  .stat-card--link:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-hover);
  }
}

.stat-card--link:active {
  transform: translateY(0);
}

.stat-card--link:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.stat-card__icon {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: var(--color-primary-bg);
  color: var(--color-primary-dark);
  margin-bottom: var(--space-2);
}

.stat-card__value {
  font-size: var(--font-num-md);
  font-weight: var(--font-weight-semibold);
  line-height: 1.1;
  letter-spacing: -0.02em;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stat-card__label {
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
}

.stat-card__hint {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
