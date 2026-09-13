<script setup lang="ts">
import { ChevronRight } from 'lucide-vue-next'
import type { LucideIcon } from 'lucide-vue-next'

import { AppBadge } from '@/components/ui'
import type { BadgeVariant } from '@/types'

/**
 * SettingsCell — Apple Settings 风格设置行（V2.1.0-beta · Phase UI-5C 沉淀）：
 * 左图标（着色方圆）+ 标题 + 副标题，右侧值/徽章 + Chevron。
 * 点击反馈 200ms；危险项红色调。所有设置页复用，禁止按钮式列表。
 */
withDefaults(
  defineProps<{
    icon?: LucideIcon
    /** 图标色调：primary=松石青底 / neutral=灰底 / danger=红底 */
    iconTone?: 'primary' | 'neutral' | 'danger'
    title: string
    subtitle?: string
    /** 右侧值文案（时间、状态等） */
    value?: string
    /** 右侧徽章（云同步状态等）；value 与 badge 可共存 */
    badgeText?: string
    badgeVariant?: BadgeVariant
    /** 是否显示 Chevron（默认 true；开关类行传 false） */
    chevron?: boolean
    /** 危险操作（重置等）：标题与图标用红色 */
    danger?: boolean
  }>(),
  {
    icon: undefined,
    iconTone: 'primary',
    subtitle: undefined,
    value: undefined,
    badgeText: undefined,
    badgeVariant: 'neutral',
    chevron: true,
    danger: false,
  },
)

const emit = defineEmits<{
  click: []
}>()
</script>

<template>
  <button
    type="button"
    class="settings-cell"
    :class="{ 'is-danger': danger }"
    @click="emit('click')"
  >
    <span v-if="icon" class="cell-icon" :class="`is-${iconTone}`" aria-hidden="true">
      <component :is="icon" :size="18" :stroke-width="2" />
    </span>
    <span class="cell-main">
      <span class="cell-title">{{ title }}</span>
      <span v-if="subtitle" class="cell-subtitle">{{ subtitle }}</span>
    </span>
    <span class="cell-side">
      <span v-if="value" class="cell-value">{{ value }}</span>
      <AppBadge v-if="badgeText" :variant="badgeVariant" size="sm">{{ badgeText }}</AppBadge>
      <ChevronRight
        v-if="chevron"
        class="cell-chevron"
        :size="16"
        :stroke-width="2"
        aria-hidden="true"
      />
    </span>
  </button>
</template>

<style scoped>
.settings-cell {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: none;
  border-bottom: var(--border-hairline-width) solid var(--color-border-light);
  background: transparent;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  transition: background var(--duration-base) var(--ease-out);
}

.settings-cell:last-child {
  border-bottom: none;
}

.settings-cell:hover {
  background: var(--bg-hover);
}

.settings-cell:active {
  background: var(--color-fill-disabled);
}

.settings-cell:focus-visible {
  outline: none;
  box-shadow: inset var(--ring-focus);
}

.cell-icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
}

.cell-icon.is-primary {
  background: var(--color-primary-bg);
  color: var(--color-primary-strong);
}

.cell-icon.is-neutral {
  background: var(--color-fill-disabled);
  color: var(--color-text-secondary);
}

.cell-icon.is-danger {
  background: var(--color-danger-soft);
  color: var(--color-danger-strong);
}

.cell-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cell-title {
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.is-danger .cell-title {
  color: var(--color-danger-strong);
}

.cell-subtitle {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-side {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.cell-value {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.cell-chevron {
  color: var(--color-text-tertiary);
  opacity: 0.5;
}
</style>
