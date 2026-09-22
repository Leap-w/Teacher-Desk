<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { AppSegmented } from '@/components/ui'
import { FUND_RANGE_LABELS, formatMoney } from '@/utils/fund'
import type { FundRange } from '@/types/fund'

/**
 * FundHero — 班费余额卡（v3.6.0）：当前余额 + 总收入 / 总支出 + 统计范围切换。
 *
 * **余额恒为全部收支的净额**，不随切换变：账上现在有多少钱不因为「我正在看本月」而改变，
 * 把它跟着范围一起变会得到一个叫「余额」的月度结余，那是另一个数（也是另一种误导）。
 * 收入 / 支出 / 笔数跟着切换走，卡片上写清当前是哪个口径。
 */
const props = defineProps<{
  /** 当前余额（全部口径） */
  balance: number
  /** 所选范围内的收入 / 支出 / 笔数 */
  income: number
  expense: number
  count: number
  range: FundRange
}>()

const emit = defineEmits<{ 'update:range': [FundRange] }>()

const RANGE_OPTIONS: { value: FundRange; label: string }[] = (
  Object.keys(FUND_RANGE_LABELS) as FundRange[]
).map((value) => ({ value, label: FUND_RANGE_LABELS[value] }))

const rangeLabel = computed(() => FUND_RANGE_LABELS[props.range])

/** 余额为负（支出超过收入）时数字用告警色——不是错误，但教师该一眼看见 */
const isOverspent = computed(() => props.balance < 0)

/** 进入渐入（与其余模块的 Hero 同一手感） */
const entered = ref(false)
onMounted(() => {
  requestAnimationFrame(() => {
    entered.value = true
  })
})
</script>

<template>
  <div class="fund-hero" :class="{ 'is-entered': entered }">
    <div class="hero-head">
      <span class="hero-label">当前余额</span>
      <span class="hero-scope">全部收支净额</span>
    </div>

    <p class="hero-balance" :class="{ 'is-negative': isOverspent }">
      {{ formatMoney(balance) }}
    </p>

    <div class="hero-metrics">
      <div class="hero-metric">
        <span class="hero-metric-label">总收入</span>
        <span class="hero-metric-value is-income">{{ formatMoney(income) }}</span>
      </div>
      <span class="hero-divider" aria-hidden="true" />
      <div class="hero-metric">
        <span class="hero-metric-label">总支出</span>
        <span class="hero-metric-value is-expense">{{ formatMoney(expense) }}</span>
      </div>
      <span class="hero-divider" aria-hidden="true" />
      <div class="hero-metric">
        <span class="hero-metric-label">流水笔数</span>
        <span class="hero-metric-value">{{ count }}</span>
      </div>
    </div>

    <div class="hero-switch">
      <AppSegmented
        :options="RANGE_OPTIONS"
        :model-value="range"
        label="统计范围"
        @update:model-value="emit('update:range', $event)"
      />
      <span class="hero-switch-hint">收入 / 支出 / 笔数按「{{ rangeLabel }}」统计</span>
    </div>
  </div>
</template>

<style scoped>
.fund-hero {
  padding: var(--spacing-lg) var(--spacing-xl);
  border-radius: var(--radius-xl);
  background: linear-gradient(
    120deg,
    var(--color-primary-bg) 0%,
    rgba(107, 158, 133, 0.08) 55%,
    transparent 100%
  );
  border: 1px solid var(--color-border-light);
  opacity: 0;
  transform: translateY(6px);
  transition:
    opacity var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}

.fund-hero.is-entered {
  opacity: 1;
  transform: translateY(0);
}

.hero-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.hero-label {
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
}

.hero-scope {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

/* 余额：整个模块唯一的巨幅数字（展示级刻度用令牌，不手写 px） */
.hero-balance {
  margin-top: var(--space-2);
  font-size: var(--font-num-2xl);
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.02em;
  line-height: 1.15;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}

.hero-balance.is-negative {
  color: var(--color-danger-strong);
}

.hero-metrics {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  margin-top: var(--space-4);
  flex-wrap: wrap;
}

.hero-metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.hero-metric-label {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.hero-metric-value {
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}

/* 收入绿 / 支出红用 -strong 档：浅底上才够对比（同 LeaveStats 的取色口径） */
.hero-metric-value.is-income {
  color: var(--color-success-strong);
}

.hero-metric-value.is-expense {
  color: var(--color-danger-strong);
}

.hero-divider {
  width: 1px;
  height: 26px;
  background: var(--color-border);
}

.hero-switch {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin-top: var(--space-5);
  flex-wrap: wrap;
}

.hero-switch-hint {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

@media (max-width: 640px) {
  .fund-hero {
    padding: var(--spacing-card);
  }

  .hero-balance {
    font-size: var(--font-num-lg);
  }

  .hero-metrics {
    gap: var(--space-4);
  }
}
</style>
