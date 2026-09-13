<script lang="ts">
/** 地区统计卡（昌都市区 / 昌都市其他县 / 昌都市外；家庭地区算法来自学生档案，只读） */
export interface RegionStat {
  scope: string
  label: string
  count: number
  active: boolean
}
</script>

<script setup lang="ts">
/**
 * RegionCard — 地区信息卡（V2.0.7-alpha · Phase UI-4E，Apple Maps 信息卡风）：
 * 地区名 + 返家人数；点击联动筛选名单（active 高亮当前选中）。
 */
defineProps<{
  stat: RegionStat
}>()

const emit = defineEmits<{
  select: [scope: string]
}>()
</script>

<template>
  <button
    type="button"
    class="region-card"
    :class="{ 'is-active': stat.active }"
    :aria-pressed="stat.active ? 'true' : 'false'"
    @click="emit('select', stat.scope)"
  >
    <span class="region-card__count">{{ stat.count }}</span>
    <span class="region-card__label">{{ stat.label }}</span>
    <span class="region-card__hint">{{ stat.active ? '已筛选' : '点击筛选' }}</span>
  </button>
</template>

<style scoped>
.region-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: var(--spacing-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--duration-base) var(--ease-out),
    background var(--duration-base) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out);
}

.region-card:hover {
  border-color: var(--color-primary);
  box-shadow: var(--shadow-sm);
}

.region-card:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.region-card.is-active {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
}

.region-card__count {
  font-size: 26px;
  font-weight: var(--font-weight-semibold);
  line-height: 1.1;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}

.region-card.is-active .region-card__count {
  color: var(--color-primary-dark);
}

.region-card__label {
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
}

.region-card__hint {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}
</style>
