<script lang="ts">
import type { FundCollection } from '@/types/fund'

/** 批次卡片的展示数据（由页面从 store 派生后喂进来，本组件不碰 store） */
export interface FundCollectionCard {
  collection: FundCollection
  paid: number
  total: number
  /** 已收金额 = 已交人数 × 每人金额 */
  income: number
  /** 已交比例（0–100），用来画那根细进度条 */
  percent: number
}
</script>

<script setup lang="ts">
import { ChevronRight, Users } from 'lucide-vue-next'

import { AppBadge, AppButton } from '@/components/ui'
import { formatFundDate, formatMoney } from '@/utils/fund'

/**
 * FundCollectionSection — 收费批次列表（v3.6.0，规格第八节）。
 *
 * 每张卡片讲三件事：这一批收什么（名称 + 日期）、收得怎么样（已交 61/62 + 进度条）、
 * 收上来多少（金额）。金额由「已交人数 × 每人金额」当场算——与流水里那一行是同一个数，
 * 不在这里另算一遍。
 *
 * **空态不藏**：一次批次都还没有时也留着这块位置并给出「新建收费批次」按钮。
 * 藏起来的话，这个功能只有点开 FAB 的人才知道它存在。
 */
defineProps<{
  cards: FundCollectionCard[]
}>()

const emit = defineEmits<{
  create: []
  open: [collection: FundCollection]
}>()
</script>

<template>
  <section class="collection-section">
    <header class="section-head">
      <h2 class="section-title">
        收费批次
        <span v-if="cards.length" class="section-count">{{ cards.length }}</span>
      </h2>
      <AppButton v-if="cards.length" size="sm" variant="secondary" @click="emit('create')">
        新建批次
      </AppButton>
    </header>

    <div v-if="cards.length" class="collection-list">
      <button
        v-for="card in cards"
        :key="card.collection.id"
        type="button"
        class="collection-card"
        @click="emit('open', card.collection)"
      >
        <span class="card-head">
          <span class="card-title">{{ card.collection.title }}</span>
          <ChevronRight :size="16" :stroke-width="2" class="card-arrow" aria-hidden="true" />
        </span>

        <span class="card-meta">
          <span>每人 {{ formatMoney(card.collection.amountPerStudent) }}</span>
          <span class="card-dot" aria-hidden="true">·</span>
          <span>{{ formatFundDate(card.collection.date) }}</span>
        </span>

        <span class="card-progress">
          <span
            class="progress-track"
            role="progressbar"
            :aria-valuenow="card.paid"
            :aria-valuemin="0"
            :aria-valuetext="`已交 ${card.paid} 人，共 ${card.total} 人`"
            :aria-valuemax="card.total"
          >
            <span class="progress-fill" :style="{ width: `${card.percent}%` }" />
          </span>
          <span class="progress-text">
            <Users :size="13" :stroke-width="2" aria-hidden="true" />
            已交 {{ card.paid }}/{{ card.total }}
          </span>
        </span>

        <span class="card-amount">
          <span class="card-amount-value">{{ formatMoney(card.income) }}</span>
          <AppBadge v-if="card.total > 0 && card.paid === card.total" variant="success" size="sm">
            已收齐
          </AppBadge>
        </span>
      </button>
    </div>

    <div v-else class="collection-empty">
      <p class="empty-text">
        收一次班费就建一个批次：勾上谁交了，收入自动按「已交人数 × 每人金额」算出来。
      </p>
      <AppButton size="sm" variant="secondary" @click="emit('create')">新建收费批次</AppButton>
    </div>
  </section>
</template>

<style scoped>
.collection-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: 32px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.section-count {
  padding: 1px 7px;
  border-radius: var(--radius-full);
  background: var(--color-primary-soft);
  color: var(--color-primary-dark);
  font-size: var(--font-caption);
  font-variant-numeric: tabular-nums;
}

.collection-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--card-gap);
}

.collection-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--spacing-card);
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  text-align: left;
  cursor: pointer;
  transition:
    transform var(--duration-base) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out);
}

@media (hover: hover) {
  .collection-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-hover);
  }
}

.collection-card:active {
  transform: translateY(0);
}

.collection-card:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.card-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.card-title {
  flex: 1;
  min-width: 0;
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-arrow {
  flex-shrink: 0;
  color: var(--color-text-tertiary);
}

.card-meta {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.card-dot {
  color: var(--color-border-emphasis);
}

.card-progress {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.progress-track {
  flex: 1;
  min-width: 0;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--color-primary-soft);
  overflow: hidden;
}

.progress-fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  transition: width var(--duration-base) var(--ease-out);
}

.progress-text {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  font-size: var(--font-caption);
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}

.card-amount {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.card-amount-value {
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-success-strong);
  font-variant-numeric: tabular-nums;
}

.collection-empty {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
  padding: var(--spacing-card);
  background: var(--color-bg-white);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-card);
}

.empty-text {
  flex: 1;
  min-width: 200px;
  font-size: var(--font-secondary);
  line-height: 1.6;
  color: var(--color-text-tertiary);
}

@media (max-width: 900px) {
  .collection-list {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
