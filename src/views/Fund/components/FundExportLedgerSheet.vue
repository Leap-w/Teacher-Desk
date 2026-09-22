<script setup lang="ts">
import { formatMoney } from '@/utils/fund'
import { signedAmountText } from '@/utils/fundExport'
import type { FundFlowEntry, FundTotals } from '@/types/fund'

/**
 * FundExportLedgerSheet — 账页正文：合计 + 收支流水表（v3.6.0，规格第十节第 1 页）。
 *
 * 三处口径，改之前先读：
 *
 * ① **合计恒为「全部」口径**，与页面上的「本月 / 本学期」切换无关。导出的是账本本身，
 *    不是「我正在看的那一屏」；跟着切换走的话，同一份文件在不同的切换状态下导出来是两个数。
 *    每一页都印合计：账页前后翻动时，不必回到第 1 页才知道余额。
 *
 * ② **表内日期用 `2026-09-03` 键**，不用中文日期。表格是要被对照和排序的，
 *    中文日期按文字排序会乱（`2026年10月1日` 排在 `2026年9月3日` 前面）。
 *
 * ③ **分类只写名字，不写 emoji**。界面上的 🧹 是给屏幕看的：打印出来是一个灰块，
 *    黑白打印更分不清。图标由列表页负责，纸面认文字。
 */
defineProps<{
  entries: FundFlowEntry[]
  totals: FundTotals
}>()
</script>

<template>
  <div class="ex-ledger">
    <div class="ex-summary">
      <div class="sum-item is-balance">
        <span class="sum-label">当前余额</span>
        <span class="sum-value">{{ formatMoney(totals.balance) }}</span>
      </div>
      <div class="sum-item">
        <span class="sum-label">总收入</span>
        <span class="sum-value is-income">{{ formatMoney(totals.income) }}</span>
      </div>
      <div class="sum-item">
        <span class="sum-label">总支出</span>
        <span class="sum-value is-expense">{{ formatMoney(totals.expense) }}</span>
      </div>
      <div class="sum-item">
        <span class="sum-label">流水笔数</span>
        <span class="sum-value">{{ totals.count }}</span>
      </div>
      <span class="sum-scope">全部收支</span>
    </div>

    <table class="ex-table">
      <colgroup>
        <col style="width: 92px" />
        <col style="width: 54px" />
        <col style="width: 96px" />
        <col />
        <col style="width: 118px" />
        <col style="width: 220px" />
      </colgroup>
      <thead>
        <tr>
          <th>日期</th>
          <th>类型</th>
          <th>分类</th>
          <th>标题</th>
          <th class="is-num">金额（元）</th>
          <th>备注</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="entry in entries" :key="entry.id">
          <td class="is-date">{{ entry.date }}</td>
          <td>{{ entry.type === 'income' ? '收入' : '支出' }}</td>
          <td>{{ entry.category }}</td>
          <td class="is-title">
            {{ entry.title }}
            <span v-if="entry.kind === 'collection'" class="ex-tag">批次</span>
          </td>
          <td class="is-num" :class="entry.type === 'income' ? 'is-income' : 'is-expense'">
            {{ signedAmountText(entry) }}
          </td>
          <td class="is-note">{{ entry.note ?? '' }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.ex-ledger {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ex-summary {
  display: flex;
  align-items: flex-end;
  gap: 40px;
  padding: 12px 18px;
  border-radius: 12px;
  background: var(--color-primary-bg);
}

.sum-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sum-label {
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.sum-value {
  font-size: 20px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.sum-item.is-balance .sum-value {
  font-size: 26px;
}

.sum-value.is-income {
  color: var(--color-success-strong);
}

.sum-value.is-expense {
  color: var(--color-danger-strong);
}

.sum-scope {
  margin-left: auto;
  padding-bottom: 3px;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.ex-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.ex-table th {
  padding: 8px 8px;
  border-bottom: 1px solid var(--color-border-strong);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
  text-align: left;
}

.ex-table td {
  height: 30px;
  padding: 0 8px;
  border-bottom: 1px solid var(--color-border-divider);
  font-size: 13px;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ex-table .is-num {
  text-align: right;
}

.ex-table td.is-num {
  font-weight: 600;
}

.ex-table td.is-num.is-income {
  color: var(--color-success-strong);
}

.ex-table td.is-num.is-expense {
  color: var(--color-danger-strong);
}

.ex-table td.is-date {
  color: var(--color-text-secondary);
}

.ex-table td.is-note {
  color: var(--color-text-secondary);
}

.ex-tag {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--color-primary-soft);
  color: var(--color-primary-dark);
  font-size: 10px;
}
</style>
