<script setup lang="ts">
import { seatBlockLabel, seatPositionLong } from '@/utils/seat'
import type { SeatCompareEntry } from '@/utils/seat'

/**
 * 导出用「方案对比 · 变化摘要」静态页（纯展示，供 html-to-image 快照为 PDF 第二页）。
 * 文案与页面内对比弹窗同源：条目 = 姓名（学号后四位）+ 位置变化行 + 区块变化行（仅跨区时）。
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

function positionText(seat: SeatCompareEntry['toSeat']): string {
  return seat ? seatPositionLong(seat.row, seat.col) : '未就座'
}

/** 位置变化行：第2排第3列 → 第4排第2列 */
function moveLine(entry: SeatCompareEntry): string {
  return `${entry.fromSeat ? positionText(entry.fromSeat) : '未就座'} → ${positionText(entry.toSeat)}`
}

/** 区块变化行：仅跨区块时展示（左区 → 中区） */
function zoneLine(entry: SeatCompareEntry): string | undefined {
  const from = entry.fromSeat?.block
  const to = entry.toSeat.block
  if (!from || from === to) return undefined
  return `${seatBlockLabel(from)} → ${seatBlockLabel(to)}`
}
</script>

<template>
  <div class="ex-summary">
    <header class="ex-header">
      <h3 class="ex-title">{{ title }}</h3>
      <p class="ex-meta">{{ subtitle }}</p>
    </header>

    <ul class="ex-list">
      <li v-for="entry in entries" :key="entry.studentId" class="ex-entry">
        <p class="ex-name">{{ entry.name }}</p>
        <p class="ex-line">{{ moveLine(entry) }}</p>
        <p v-if="zoneLine(entry)" class="ex-line is-zone">{{ zoneLine(entry) }}</p>
      </li>
    </ul>

    <p class="ex-total">共调整 {{ total }} 人。</p>
  </div>
</template>

<style scoped>
.ex-summary {
  width: 620px;
  padding: 14px 18px 16px;
  background: #fff;
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
  font-weight: 700;
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
  border-radius: 8px;
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
