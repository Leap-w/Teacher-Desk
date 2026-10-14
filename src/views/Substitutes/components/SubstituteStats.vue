<script setup lang="ts">
import { ClipboardList } from 'lucide-vue-next'

import DashboardStatCard from '@/components/dashboard/DashboardStatCard.vue'
import type { SubstituteSummary } from '@/types/substitute'

/**
 * SubstituteStats — 代课统计（v3.7.5 §6.4）。
 *
 * 三档，全部由 `store.summaryIn(from, to)` 实时算出（不落库、不缓存、不硬编码）：
 * ① 总节数；② 按实际代课教师；③ 按被代课教师。三者用的是**同一份筛选后的列表**，
 * 所以卡片上的数字与下面列表里数得出来的条数必然一致（统计口径写在卡上：
 * 一条记录 = 一节代课）。
 *
 * 「早自习及第一节」在课程表里就是**一段**（v1.1.3 起的刻意设计），
 * 因此代课登记选到这一节时按一节计，与课程表、课时的口径保持一致。
 */
defineProps<{
  summary: SubstituteSummary
  /** 是否正处在日期范围筛选下（口径说明跟着变，免得被当成全部的数字） */
  filtered?: boolean
}>()
</script>

<template>
  <div class="substitute-stats">
    <DashboardStatCard
      :icon="ClipboardList"
      :value="summary.total"
      label="代课总节数"
      :hint="filtered ? '当前筛选范围内 · 一条记录 = 一节' : '一条记录 = 一节代课'"
    />

    <section class="breakdown">
      <h3 class="breakdown-title">按实际代课教师</h3>
      <ul v-if="summary.bySubstituteTeacher.length > 0" class="breakdown-list">
        <li v-for="item in summary.bySubstituteTeacher" :key="item.name" class="breakdown-row">
          <span class="breakdown-name">{{ item.name }}</span>
          <span class="breakdown-count">{{ item.count }} 节</span>
        </li>
      </ul>
      <p v-else class="breakdown-empty">筛选范围内没有代课记录</p>
    </section>

    <section class="breakdown">
      <h3 class="breakdown-title">按被代课教师</h3>
      <ul v-if="summary.byOriginalTeacher.length > 0" class="breakdown-list">
        <li v-for="item in summary.byOriginalTeacher" :key="item.name" class="breakdown-row">
          <span class="breakdown-name">{{ item.name }}</span>
          <span class="breakdown-count">{{ item.count }} 节</span>
        </li>
      </ul>
      <p v-else class="breakdown-empty">筛选范围内没有代课记录</p>
    </section>
  </div>
</template>

<style scoped>
.substitute-stats {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--card-gap);
}

.breakdown {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--spacing-card);
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
}

.breakdown-title {
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
}

.breakdown-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
  /* 名单长起来时限制高度：卡不做成「排行榜」，它是核对谁代了几节的账 */
  max-height: 168px;
  overflow-y: auto;
}

.breakdown-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  font-size: var(--font-secondary);
}

.breakdown-name {
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.breakdown-count {
  flex-shrink: 0;
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.breakdown-empty {
  font-size: var(--font-secondary);
  color: var(--color-text-tertiary);
}

@media (max-width: 960px) {
  .substitute-stats {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
