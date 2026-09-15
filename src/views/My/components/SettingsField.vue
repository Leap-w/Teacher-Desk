<script setup lang="ts">
import { computed, useSlots } from 'vue'

/**
 * SettingsField — 二级设置页里「一行设置」的统一形状（v3.0.4-rc）。
 *
 * 对齐 Changdu-Memory `Settings.vue` 的 `settings-item`：左侧标签（+ 可选说明），
 * 右侧控件；控件放不下时用 `stack` 变体（标签在上、内容在下，如背景图预设网格）。
 *
 * 与 `SettingsCell` 的分工：`SettingsCell` 是**可点的入口行**（带图标与箭头，点了去别处），
 * `SettingsField` 是**就地改值的控件行**（开关 / 分段控件 / 日期 / 输入框）。
 */
withDefaults(
  defineProps<{
    label: string
    /** 控件下方的说明文字 */
    hint?: string
    /** 内容换行到标签下方（用于网格、表单这类较宽的内容） */
    stack?: boolean
  }>(),
  {
    hint: undefined,
    stack: false,
  },
)

const slots = useSlots()
/** 默认插槽有没有真内容（空插槽不留白，紧凑行才紧凑） */
const hasBody = computed(() => Boolean(slots.default))
</script>

<template>
  <div class="set-field" :class="{ 'is-stack': stack }">
    <div class="set-field__head">
      <span class="set-field__label">{{ label }}</span>
      <div v-if="!stack" class="set-field__control">
        <slot name="control" />
      </div>
    </div>

    <div v-if="hasBody" class="set-field__body">
      <slot />
    </div>

    <p v-if="hint" class="set-field__hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.set-field {
  padding: var(--space-3) var(--space-4);
  border-bottom: var(--border-hairline-width) solid var(--color-border-light);
}

.set-field:last-child {
  border-bottom: none;
}

.set-field__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
}

.set-field__label {
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.set-field__control {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.set-field.is-stack .set-field__head {
  margin-bottom: var(--space-3);
}

.set-field__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.set-field__hint {
  margin: var(--space-2) 0 0;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  line-height: var(--leading-normal);
}
</style>
