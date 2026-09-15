<script lang="ts">
import type { LucideIcon } from 'lucide-vue-next'

/** 图标底色（与昌都记忆快捷入口同一套高原自然色系） */
export type QuickActionTone = 'primary' | 'sky' | 'gold' | 'green' | 'neutral'

/** 对外类型：调用方 import 后喂 items */
export interface QuickAction {
  icon: LucideIcon
  label: string
  description?: string
  to: string
  /** 图标底色，缺省 primary */
  tone?: QuickActionTone
}
</script>

<script setup lang="ts">
/**
 * QuickActionGrid — 快捷入口（v3.0.3-rc · 对齐 Changdu-Memory 首页 `quick-btn`）：
 * 图标色块（44px / 12px 圆角）+ 主标题 + 副标题，整块可点。
 * 桌面 5 列 / 平板 3 列 / 手机 2 列，与昌都记忆首页快捷入口同一套栅格与留白。
 */
defineProps<{
  items: QuickAction[]
}>()

const TONE_STYLE: Record<QuickActionTone, { bg: string; fg: string }> = {
  primary: { bg: 'rgba(74, 140, 148, 0.1)', fg: 'var(--color-primary)' },
  sky: { bg: 'rgba(111, 168, 220, 0.12)', fg: 'var(--color-sky)' },
  gold: { bg: 'rgba(214, 168, 79, 0.12)', fg: 'var(--color-gold)' },
  green: { bg: 'rgba(107, 158, 133, 0.12)', fg: 'var(--color-secondary)' },
  neutral: { bg: 'rgba(140, 154, 155, 0.12)', fg: 'var(--color-text-tertiary)' },
}
</script>

<template>
  <div class="quick-grid">
    <RouterLink v-for="item in items" :key="item.to" :to="item.to" class="quick-action">
      <span
        class="quick-action__icon"
        :style="{
          background: TONE_STYLE[item.tone ?? 'primary'].bg,
          color: TONE_STYLE[item.tone ?? 'primary'].fg,
        }"
        aria-hidden="true"
      >
        <component :is="item.icon" :size="22" :stroke-width="2" />
      </span>
      <span class="quick-action__text">
        <span class="quick-action__label">{{ item.label }}</span>
        <span v-if="item.description" class="quick-action__desc">{{ item.description }}</span>
      </span>
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
  gap: 10px;
  padding: var(--spacing-md) var(--space-2);
  background: var(--color-bg-white);
  border: var(--border-hairline-width) solid var(--color-border-light);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  text-align: center;
  text-decoration: none;
  transition:
    transform var(--duration-base) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out);
}

/* Hover：轻抬升（与昌都记忆 AppCard hoverable 同一手感），不做按钮感 */
@media (hover: hover) {
  .quick-action:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-hover);
  }
}

.quick-action:active {
  transform: translateY(0);
}

.quick-action:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.quick-action__icon {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  flex-shrink: 0;
}

.quick-action__text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

/* v3.3.1 §五：卡片标题 +2px */
.quick-action__label {
  font-size: calc(var(--font-secondary) + 2px);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

/* v3.3.1 §五：副标题 +1px。原来这儿是写死的 11px——顺手收回令牌档位 */
.quick-action__desc {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}
</style>
