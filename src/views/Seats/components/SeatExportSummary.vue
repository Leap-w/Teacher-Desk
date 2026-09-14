<script setup lang="ts">
import { seatChangeMoveLine, seatChangeZoneLine } from '@/utils/seat'
import type { SeatCompareEntry } from '@/utils/seat'

/**
 * 导出用「方案对比 · 变化摘要」静态页（纯展示，供 html-to-image 快照为 PDF 第二页）。
 * 文案与页面内对比弹窗**真·同源**：位置 / 区块变化行都由 utils/seat.ts 的
 * seatChangeMoveLine / seatChangeZoneLine 生成（原先两处各存一份副本，
 * 弹窗与 PDF 有漂移风险）。条目 = 姓名（学号后四位）+ 位置变化行 + 区块变化行（仅跨区时）。
 */

interface Props {
  /** 大标题（如「高一9班 座位表 · 方案对比」） */
  title: string
  /** 副标题：A 方案名 → B 方案名 · 导出日期 */
  subtitle: string
  entries: SeatCompareEntry[]
  total: number
}

defineProps<Props>()
</script>

<template>
  <div class="ex-summary theme-force-light">
    <header class="ex-header">
      <h3 class="ex-title">{{ title }}</h3>
      <p class="ex-meta">{{ subtitle }}</p>
    </header>

    <ul class="ex-list">
      <li v-for="entry in entries" :key="entry.studentId" class="ex-entry">
        <p class="ex-name">{{ entry.name }}</p>
        <p class="ex-line">{{ seatChangeMoveLine(entry) }}</p>
        <p v-if="seatChangeZoneLine(entry)" class="ex-line is-zone">
          {{ seatChangeZoneLine(entry) }}
        </p>
      </li>
    </ul>

    <p class="ex-total">共调整 {{ total }} 人。</p>
  </div>
</template>

<style scoped>
.ex-summary {
  width: 620px;
  padding: 14px 18px 16px;
  background: var(--bg-card);
  color: var(--color-text);
}

.ex-header {
  padding-bottom: 10px;
  border-bottom: 2px solid var(--color-border);
  text-align: center;
}

.ex-title {
  margin: 0;
  font-size: 20px;
  font-weight: var(--font-weight-semibold);
  letter-spacing: 2px;
}

.ex-meta {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--color-text-secondary);
}

.ex-list {
  display: grid;
  gap: 8px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.ex-entry {
  padding: 8px 10px;
  border-radius: var(--radius-xs);
  background: var(--color-fill-disabled);
}

.ex-name {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text);
}

.ex-line {
  margin: 3px 0 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--color-text-secondary);
}

.ex-line.is-zone {
  color: var(--color-primary-strong);
}

.ex-total {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--color-text-secondary);
}
</style>
