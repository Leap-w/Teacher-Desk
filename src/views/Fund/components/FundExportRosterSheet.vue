<script lang="ts">
import type { FundCollection, FundRosterRow } from '@/types/fund'

/** 一页上要印的一个收费批次：批次本体 + 名单 + 已交人数 / 已收金额 */
export interface FundExportBatch {
  collection: FundCollection
  rows: FundRosterRow[]
  paid: number
  total: number
  income: number
}
</script>

<script setup lang="ts">
import { formatMoney } from '@/utils/fund'

/**
 * FundExportRosterSheet — 学生缴费名单（v3.6.0，规格第十节第 2 页）。
 *
 * 每个批次一块：抬头一行（名称 / 每人金额 / 日期 / 已交 x/y / 已收多少），
 * 下面按**六列排名字**，交了的名字前一个 `✓`，没交的一个 `○`。
 *
 * 为什么六列：一个班六十多人，一列排下来要一米长的纸；六列正好一屏排完。
 * 为什么用 `✓` / `○` 而不是 emoji：这两个是普通文字字形，任何字体里都有，
 * 黑白打印也分得清——`✅` / `❌` 打出来是两个灰块。
 *
 * **名单与屏幕上是同一份**（`store.rosterOf`）：重名带消歧后缀，
 * 已退档的学生仍在名单里（他那笔钱确实收过），带「已退档」标记。
 */
defineProps<{
  batches: FundExportBatch[]
}>()
</script>

<template>
  <div class="ex-roster">
    <section v-for="batch in batches" :key="batch.collection.id" class="ex-batch">
      <header class="batch-head">
        <h3 class="batch-title">{{ batch.collection.title }}</h3>
        <span class="batch-meta">
          每人 {{ formatMoney(batch.collection.amountPerStudent) }} · {{ batch.collection.date }} ·
          已交 {{ batch.paid }}/{{ batch.total }}
        </span>
        <span class="batch-amount">{{ formatMoney(batch.income) }}</span>
      </header>

      <ul v-if="batch.rows.length" class="name-grid">
        <li
          v-for="row in batch.rows"
          :key="row.studentId"
          class="name-item"
          :class="{ 'is-paid': row.paid }"
        >
          <span class="name-mark" aria-hidden="true">{{ row.paid ? '✓' : '○' }}</span>
          <span class="name-text">{{ row.name }}</span>
          <span v-if="!row.active" class="name-tag">已退档</span>
        </li>
      </ul>
      <p v-else class="batch-empty">本批次没有可列出的学生。</p>
    </section>
  </div>
</template>

<style scoped>
.ex-roster {
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.batch-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-border-strong);
}

.batch-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
}

.batch-meta {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.batch-amount {
  margin-left: auto;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-success-strong);
}

.name-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 0 16px;
  margin-top: 10px;
  list-style: none;
}

.name-item {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  font-size: 12px;
  color: var(--color-text-secondary);
  overflow: hidden;
}

.name-item.is-paid {
  color: var(--color-text-primary);
}

.name-mark {
  flex-shrink: 0;
  width: 12px;
  font-size: 12px;
  color: var(--color-text-tertiary);
}

.name-item.is-paid .name-mark {
  color: var(--color-success-strong);
}

.name-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.name-tag {
  flex-shrink: 0;
  padding: 0 4px;
  border-radius: 6px;
  background: var(--color-warning-soft);
  color: var(--color-warning-strong);
  font-size: 10px;
}

.batch-empty {
  margin-top: 10px;
  font-size: 12px;
  color: var(--color-text-tertiary);
}
</style>
