<script setup lang="ts">
import RegionCard from './RegionCard.vue'
import type { RegionStat } from './RegionCard.vue'

/**
 * RegionSummary — 家庭地区分布（V2.0.7-alpha · Phase UI-4E，班主任特色功能）：
 * 三张地区信息卡（昌都市区 / 昌都市其他县 / 昌都市外），点击联动筛选返家名单。
 * 统计来自学生档案 familyLocation（只读），不含地图。
 */
defineProps<{
  stats: RegionStat[]
  /** 当前筛选中的 scope（undefined = 全部） */
  selected?: string
}>()

const emit = defineEmits<{
  select: [scope: string | undefined]
}>()
</script>

<template>
  <div class="region-summary">
    <div class="region-grid">
      <RegionCard
        v-for="stat in stats"
        :key="stat.scope"
        :stat="stat"
        @select="emit('select', $event)"
      />
    </div>
    <button v-if="selected" type="button" class="region-reset" @click="emit('select', undefined)">
      清除地区筛选
    </button>
  </div>
</template>

<style scoped>
.region-summary {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.region-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--card-gap);
}

@media (max-width: 640px) {
  .region-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.region-reset {
  align-self: flex-start;
  border: none;
  background: transparent;
  padding: 2px 0;
  color: var(--color-primary-dark);
  font-size: var(--font-caption);
  cursor: pointer;
}

.region-reset:hover {
  text-decoration: underline;
}

.region-reset:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
  border-radius: var(--radius-xs);
}
</style>
