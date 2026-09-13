<script setup lang="ts">
/**
 * StudentSummaryItem — 班级概览单格（数字 + 标签），StudentSummary 的内部件。
 * 数字 tabular-nums 防跳动；不承担跳转。
 */
defineProps<{
  label: string
  value: number | string
}>()
</script>

<template>
  <div class="summary-item">
    <span class="summary-item__value">{{ value }}</span>
    <span class="summary-item__label">{{ label }}</span>
  </div>
</template>

<style scoped>
.summary-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: var(--space-2) 0;
  background: var(--color-bg-white);
  border-radius: var(--radius-sm);
}

.summary-item__value {
  font-size: 18px;
  font-weight: var(--font-weight-semibold);
  line-height: 1.1;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}

.summary-item__label {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}
</style>
