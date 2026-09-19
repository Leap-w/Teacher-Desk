<script setup lang="ts">
import type { ImportStat } from './importUi'

/**
 * ImportStats — 导入预览顶部的统计卡（v3.5.0，样式取自座位导入弹窗）。
 *
 * **单行等高格**（`auto-fit` + `1fr`）：各模块的指标个数不同（座位 8 个、学生 5 个、
 * 课程 7 个），固定列数会出现「第二行孤零零一个格」。单行铺满则五个弹窗看起来是同一套。
 * 格子窄到放不下时标签自动换行，不截断——数字对了但标签看不清，等于没显示。
 */
defineProps<{
  items: readonly ImportStat[]
}>()
</script>

<template>
  <div class="stats">
    <div
      v-for="item in items"
      :key="item.label"
      class="stat"
      :class="item.tone ? `is-${item.tone}` : ''"
    >
      <span class="stat-value">{{ item.value }}</span>
      <span class="stat-label">{{ item.label }}</span>
    </div>
  </div>
</template>

<style scoped>
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
  gap: var(--space-2);
  margin-top: var(--space-4);
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 0;
  padding: var(--space-3) var(--space-2);
  border-radius: var(--radius-md);
  background: var(--color-fill-disabled);
}

.stat-value {
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text);
}

.stat-label {
  font-size: var(--text-xs);
  line-height: 1.3;
  text-align: center;
  color: var(--color-text-secondary);
}

.stat.is-ok .stat-value {
  color: var(--color-success-strong);
}

.stat.is-bad .stat-value {
  color: var(--color-danger-strong);
}
</style>
