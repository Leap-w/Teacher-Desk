<script setup lang="ts">
import { computed } from 'vue'

import { useCountdownSettings } from '@/composables/useCountdownSettings'

/**
 * WorkTimeCard — 工作时光（V2.1.0-beta · Phase UI-5C）：
 * Control Center 第二层。数据 = useCountdownSettings（与首页 Hero 共用，零新数据）：
 * 支教天数（本学期已过）/ 本学期进度（渐变进度条 + 三点轴）/ 当前学年（派生）。
 */
const countdown = useCountdownSettings()

const daysWorked = computed(() => countdown.daysPassed.value)
const termProgress = computed(() => countdown.progress.value)
const termStart = computed(() => countdown.settings.value.startDate)
const termEnd = computed(() => countdown.settings.value.targetDate)

/** 当前学年：8 月起算新学年（如 2026-09 → 2026–2027） */
const schoolYear = computed(() => {
  const now = new Date()
  const year = now.getFullYear()
  return now.getMonth() >= 7 ? `${year}–${year + 1} 学年` : `${year - 1}–${year} 学年`
})

const fmtDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime())
    ? iso
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}
</script>

<template>
  <section class="work-time">
    <header class="wt-head">
      <h3 class="wt-title">工作时光</h3>
      <span class="wt-year">{{ schoolYear }}</span>
    </header>

    <div class="wt-nums">
      <div class="wt-num">
        <span class="wt-num__value">{{ daysWorked }}</span>
        <span class="wt-num__label">支教天数</span>
      </div>
      <div class="wt-num">
        <span class="wt-num__value">{{ termProgress }}<i class="wt-pct">%</i></span>
        <span class="wt-num__label">本学期进度</span>
      </div>
    </div>

    <div class="term-progress">
      <div class="term-progress__track">
        <div class="term-progress__fill" :style="{ width: termProgress + '%' }"></div>
      </div>
      <div class="term-progress__axis">
        <span class="axis-node">
          <span class="axis-dot" aria-hidden="true"></span>
          开学 · {{ fmtDate(termStart) }}
        </span>
        <span class="axis-node axis-node--now">今天 · {{ termProgress }}%</span>
        <span class="axis-node">
          期末 · {{ fmtDate(termEnd) }}
          <span class="axis-dot axis-dot--end" aria-hidden="true"></span>
        </span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.work-time {
  padding: var(--space-5) var(--space-5) var(--space-4);
  border: var(--border-hairline-width) solid var(--color-border-light);
  border-radius: var(--radius-xl);
  background: var(--bg-card);
  box-shadow: var(--shadow-xs);
}

.wt-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
}

.wt-title {
  margin: 0;
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.wt-year {
  font-size: var(--font-caption);
  font-weight: var(--font-weight-medium);
  color: var(--color-primary-strong);
}

.wt-nums {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
  margin: var(--space-4) 0;
}

.wt-num {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--color-primary-bg);
}

.wt-num__value {
  font-size: var(--font-num-lg);
  font-weight: var(--font-weight-semibold);
  line-height: 1.1;
  color: var(--color-primary-strong);
  font-variant-numeric: tabular-nums;
}

.wt-pct {
  font-style: normal;
  font-size: var(--text-md);
  margin-left: 2px;
}

.wt-num__label {
  font-size: var(--font-caption);
  color: var(--color-text-secondary);
}

/* 渐变进度条 + 三点轴（沿用原实现，数据同源） */
.term-progress__track {
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--color-bg-subtle);
  overflow: hidden;
}

.term-progress__fill {
  height: 100%;
  border-radius: var(--radius-full);
  background: linear-gradient(90deg, var(--color-gold), var(--color-sky), var(--color-primary));
  transition: width 600ms var(--ease-spring);
}

.term-progress__axis {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-top: var(--space-2);
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.axis-node {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.axis-node--now {
  color: var(--color-primary-strong);
  font-weight: var(--font-weight-semibold);
}

.axis-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-primary);
}

.axis-dot--end {
  background: var(--color-gold);
}
</style>
