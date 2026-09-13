<script setup lang="ts">
/**
 * ResultDisplay — 工具结果大字区（V2.3.0-alpha · Phase Classroom-1）。
 *
 * 讲台距离的视觉核心：**超大居中**（姓名 40px / 计时 64px / 组名 48px），
 * 最小高度固定，滚动期间换字不会让卡片跳动。
 * 三种尺寸由 `size` 决定，颜色与圆角全部来自 Design Token。
 */
withDefaults(
  defineProps<{
    /** 上方小标签（如「今天请回答」） */
    label?: string
    /** 主显示内容（空态时给 `empty` 文案） */
    value: string
    /** 尺寸：name 姓名 / timer 计时 / group 组名 */
    size?: 'name' | 'timer' | 'group'
    /** 滚动中（加轻微模糊，让「还在转」一目了然） */
    rolling?: boolean
    /** 是否是空池 / 无数据（弱化显示） */
    empty?: boolean
  }>(),
  { label: undefined, size: 'name', rolling: false, empty: false },
)
</script>

<template>
  <div class="result" :class="[`is-${size}`, { 'is-rolling': rolling, 'is-empty': empty }]">
    <p v-if="label" class="result-label">{{ label }}</p>
    <p class="result-value" role="status" aria-live="polite">{{ value }}</p>
  </div>
</template>

<style scoped>
.result {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: 132px;
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--color-primary-bg);
  text-align: center;
}

.result-label {
  margin: 0;
  font-size: var(--font-content);
  color: var(--color-text-secondary);
}

.result-value {
  margin: 0;
  font-weight: var(--font-weight-semibold);
  line-height: 1.15;
  letter-spacing: -0.02em;
  color: var(--color-primary-strong);
  font-variant-numeric: tabular-nums;
  transition: opacity var(--duration-base) var(--ease-out);
}

.is-name .result-value {
  font-size: var(--font-num-2xl);
}

.is-timer .result-value {
  font-size: var(--font-num-2xl);
  font-size: 64px;
  line-height: 1.05;
}

.is-group .result-value {
  font-size: 48px;
}

.is-rolling .result-value {
  opacity: 0.72;
}

.is-empty {
  background: var(--color-fill-disabled);
}

.is-empty .result-value {
  font-size: var(--font-content);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-tertiary);
}

@media (max-width: 640px) {
  .is-timer .result-value {
    font-size: 48px;
  }

  .is-group .result-value {
    font-size: 36px;
  }
}
</style>
