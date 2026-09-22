<script setup lang="ts">
import { computed } from 'vue'
import { ArrowDownLeft, ArrowUpRight, Pencil, Trash2 } from 'lucide-vue-next'

import { AppButton, AppModal } from '@/components/ui'
import { formatFundDate, formatFlowAmount, categoryIcon } from '@/utils/fund'
import type { FundRecord } from '@/types/fund'

/**
 * FundRecordDetail — 一笔流水的详情（v3.6.0，规格第七节）。
 *
 * 只读展示 + 两个动作（编辑 / 删除），**自己不改数据**：删除要过二次确认，
 * 确认弹窗与写入都由页面持有——与请假记录同一条分工（详情组件不知道「删除」之后该发生什么）。
 *
 * 金额用 `+¥ / -¥` 与绿红双色，和列表上那一行完全一致：
 * 从列表点进详情是同一个数的同一个样子，不需要再认一遍。
 */
const props = defineProps<{
  modelValue: boolean
  record?: FundRecord
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  edit: [record: FundRecord]
  remove: [record: FundRecord]
}>()

const isIncome = computed(() => props.record?.type === 'income')
const icon = computed(() =>
  props.record ? categoryIcon(props.record.category, props.record.type) : '',
)

/** 录入时刻 `2026-09-23 14:05`（本地时区）——同一天记了好几笔时用来分辨先后 */
const createdLabel = computed(() => {
  const raw = props.record?.createdAt
  if (!raw) return ''
  const time = new Date(raw)
  if (Number.isNaN(time.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}`
})

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <AppModal :model-value="modelValue" title="记录详情" :width="420" @update:model-value="close">
    <div v-if="record" class="detail">
      <div class="detail-head">
        <span class="detail-icon" :class="isIncome ? 'is-income' : 'is-expense'" aria-hidden="true">
          <span v-if="icon">{{ icon }}</span>
          <ArrowDownLeft v-else-if="isIncome" :size="20" :stroke-width="2" />
          <ArrowUpRight v-else :size="20" :stroke-width="2" />
        </span>
        <div class="detail-head-text">
          <p class="detail-title">{{ record.title }}</p>
          <p class="detail-sub">{{ isIncome ? '收入' : '支出' }} · {{ record.category }}</p>
        </div>
      </div>

      <p class="detail-amount" :class="isIncome ? 'is-income' : 'is-expense'">
        {{ formatFlowAmount(record) }}
      </p>

      <dl class="detail-rows">
        <div class="detail-row">
          <dt>日期</dt>
          <dd>{{ formatFundDate(record.date) }}</dd>
        </div>
        <div v-if="record.note" class="detail-row">
          <dt>备注</dt>
          <dd class="is-note">{{ record.note }}</dd>
        </div>
        <div v-if="createdLabel" class="detail-row">
          <dt>录入时间</dt>
          <dd class="is-muted">{{ createdLabel }}</dd>
        </div>
      </dl>
    </div>

    <template #footer>
      <AppButton v-if="record" variant="ghost" @click="emit('remove', record)">
        <Trash2 :size="16" :stroke-width="2" aria-hidden="true" />
        删除
      </AppButton>
      <AppButton v-if="record" @click="emit('edit', record)">
        <Pencil :size="16" :stroke-width="2" aria-hidden="true" />
        编辑
      </AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.detail-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.detail-icon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  font-size: 20px;
  line-height: 1;
}

.detail-icon.is-income {
  background: var(--color-success-soft);
  color: var(--color-success-strong);
}

.detail-icon.is-expense {
  background: var(--color-danger-soft);
  color: var(--color-danger-strong);
}

.detail-head-text {
  min-width: 0;
}

.detail-title {
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  overflow-wrap: anywhere;
}

.detail-sub {
  margin-top: 2px;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.detail-amount {
  font-size: var(--font-num-lg);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}

.detail-amount.is-income {
  color: var(--color-success-strong);
}

.detail-amount.is-expense {
  color: var(--color-danger-strong);
}

.detail-rows {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border-divider);
}

.detail-row {
  display: flex;
  gap: var(--space-4);
  font-size: var(--font-secondary);
}

.detail-row dt {
  flex-shrink: 0;
  width: 4.5em;
  color: var(--color-text-tertiary);
}

.detail-row dd {
  flex: 1;
  min-width: 0;
  color: var(--color-text-primary);
  overflow-wrap: anywhere;
}

.detail-row dd.is-note {
  white-space: pre-wrap;
}

.detail-row dd.is-muted {
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}
</style>
