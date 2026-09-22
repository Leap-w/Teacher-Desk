<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, Pencil, Trash2, UserMinus, X } from 'lucide-vue-next'

import { AppButton, AppDrawer, AppInput, AppModal } from '@/components/ui'
import { collectionIncome, collectionPaidCount, formatFundDate, formatMoney } from '@/utils/fund'
import type { FundCollection, FundRosterRow } from '@/types/fund'

/**
 * FundCollectionDetail — 一个收费批次的缴费名单（v3.6.0，规格第八节）。
 *
 * 一屏讲完「这批收得怎么样」：已交 61/62、已收多少钱、谁交了谁没交。
 * 名单来自学生档案（在读的当场派生），**勾一下就能改**——钱数跟着勾选实时变，
 * 没有「勾了还要再改一次金额」这一步。
 *
 * 两个动作的分工：
 * - 勾选 / 取消某个学生 → 直接 emit `toggle`，立刻落库（这是这个界面存在的主要理由，不值得加门槛）。
 * - 「全部标为未交」会一次抹掉几十个勾 → **就地弹一次确认**再 emit。
 *   它的反向「全部标为已交」不确认：勾错了单个勾回来就是了，两个方向的风险不对称。
 * - 删除整个批次与编辑批次信息都交给页面（页面持有那两处确认与表单）。
 */
const props = defineProps<{
  modelValue: boolean
  collection?: FundCollection
  /** 名单（已按学号排序、姓名已含消歧后缀；由页面从 store 派生） */
  rows: FundRosterRow[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  toggle: [studentId: string]
  'set-all': [paid: boolean]
  edit: []
  remove: []
}>()

const keyword = ref('')
const confirmOpen = ref(false)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    keyword.value = ''
    confirmOpen.value = false
  },
)

const paidCount = computed(() => (props.collection ? collectionPaidCount(props.collection) : 0))
const income = computed(() => (props.collection ? collectionIncome(props.collection) : 0))
const percent = computed(() =>
  props.rows.length ? Math.round((paidCount.value / props.rows.length) * 100) : 0,
)

/** 搜姓名或学号：六十多人的名单，翻找不如搜 */
const visibleRows = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text) return props.rows
  return props.rows.filter(
    (row) =>
      row.name.toLowerCase().includes(text) ||
      (row.student?.studentNo ?? '').toLowerCase().includes(text),
  )
})

const allPaid = computed(() => props.rows.length > 0 && paidCount.value === props.rows.length)

/**
 * 「全部未交」到底会清掉几个勾、留下几个：**store 的 `setAllPaid(false)` 只作用于在读学生**
 * （已退档学生那笔钱确实收过，不该被一次误点抹掉），所以确认文案不能笼统说「全部 N 人」——
 * 说大了教师会以为点下去收入一定归零，说小了又解释不了余额为什么没变。
 */
const activePaidCount = computed(() => props.rows.filter((row) => row.active && row.paid).length)
const retiredPaidCount = computed(() => props.rows.filter((row) => !row.active && row.paid).length)

function confirmSetAllUnpaid() {
  confirmOpen.value = false
  emit('set-all', false)
}

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <AppDrawer
    :model-value="modelValue"
    :title="collection ? collection.title : '缴费名单'"
    :width="460"
    @update:model-value="close"
  >
    <div class="roster">
      <div class="roster-summary">
        <div class="summary-main">
          <div class="summary-count">
            <span class="count-paid">{{ paidCount }}</span>
            <span class="count-total">/{{ rows.length }}</span>
            <span class="count-label">已交</span>
          </div>
          <div class="summary-amount">
            <span class="amount-value">{{ formatMoney(income) }}</span>
            <span class="amount-label">已收</span>
          </div>
        </div>

        <span
          class="progress-track"
          role="progressbar"
          :aria-valuenow="paidCount"
          :aria-valuemin="0"
          :aria-valuemax="rows.length"
          :aria-valuetext="`已交 ${paidCount} 人，共 ${rows.length} 人`"
        >
          <span class="progress-fill" :style="{ width: `${percent}%` }" />
        </span>

        <p v-if="collection" class="summary-meta">
          每人 {{ formatMoney(collection.amountPerStudent) }} ·
          {{ formatFundDate(collection.date) }}
        </p>
      </div>

      <div class="roster-tools">
        <AppInput v-model="keyword" size="sm" clearable placeholder="搜姓名或学号" />
        <div class="tool-actions">
          <AppButton
            size="sm"
            variant="secondary"
            :disabled="allPaid"
            @click="emit('set-all', true)"
          >
            全部已交
          </AppButton>
          <AppButton
            size="sm"
            variant="ghost"
            :disabled="paidCount === 0"
            @click="confirmOpen = true"
          >
            全部未交
          </AppButton>
        </div>
      </div>

      <div v-if="visibleRows.length" class="roster-list" role="list">
        <button
          v-for="row in visibleRows"
          :key="row.studentId"
          type="button"
          class="roster-row"
          role="listitem"
          :class="{ 'is-paid': row.paid }"
          :aria-pressed="row.paid ? 'true' : 'false'"
          @click="emit('toggle', row.studentId)"
        >
          <span class="row-check" :class="row.paid ? 'is-paid' : 'is-unpaid'" aria-hidden="true">
            <Check v-if="row.paid" :size="13" :stroke-width="3" />
            <X v-else :size="13" :stroke-width="2.5" />
          </span>
          <span class="row-name">{{ row.name }}</span>
          <span v-if="!row.active" class="row-tag">
            <UserMinus :size="12" :stroke-width="2" aria-hidden="true" />
            已退档
          </span>
          <span class="row-state" :class="row.paid ? 'is-paid' : 'is-unpaid'">
            {{ row.paid ? '已交' : '未交' }}
          </span>
        </button>
      </div>

      <p v-else class="roster-hint">
        {{ rows.length ? '没有匹配的学生' : '档案里还没有学生，先去「学生档案」建档。' }}
      </p>
    </div>

    <template #footer>
      <AppButton variant="ghost" @click="emit('remove')">
        <Trash2 :size="16" :stroke-width="2" aria-hidden="true" />
        删除批次
      </AppButton>
      <AppButton @click="emit('edit')">
        <Pencil :size="16" :stroke-width="2" aria-hidden="true" />
        编辑信息
      </AppButton>
    </template>
  </AppDrawer>

  <AppModal v-model="confirmOpen" title="全部标为未交" :width="380">
    <p v-if="retiredPaidCount === 0" class="confirm-text">
      确定把 <strong>{{ rows.length }}</strong> 名学生全部标为未交吗？已交的
      <strong>{{ paidCount }}</strong> 个勾会一起清掉，这一批的收入随之归零。此操作无法撤销。
    </p>
    <p v-else class="confirm-text">
      确定取消在读学生的已交标记吗？其中已交的
      <strong>{{ activePaidCount }}</strong> 个勾会清掉，收入随之减少。另有
      <strong>{{ retiredPaidCount }}</strong>
      名已退档学生保留已交（他们那笔钱确实收过），所以收入不会归零。此操作无法撤销。
    </p>
    <template #footer>
      <AppButton variant="ghost" @click="confirmOpen = false">取消</AppButton>
      <AppButton variant="danger" @click="confirmSetAllUnpaid">全部标为未交</AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.roster {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.roster-summary {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--spacing-card);
  border-radius: var(--radius-lg);
  background: var(--color-primary-bg);
}

.summary-main {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-4);
}

.summary-count {
  display: flex;
  align-items: baseline;
  gap: 2px;
  font-variant-numeric: tabular-nums;
}

.count-paid {
  font-size: var(--font-num-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-primary-dark);
  line-height: 1.1;
}

.count-total {
  font-size: var(--text-lg);
  color: var(--color-text-secondary);
}

.count-label {
  margin-left: var(--space-1);
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.summary-amount {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
}

.amount-value {
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-success-strong);
  font-variant-numeric: tabular-nums;
}

.amount-label {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.progress-track {
  display: block;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--color-bg-white);
  overflow: hidden;
}

.progress-fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  transition: width var(--duration-base) var(--ease-out);
}

.summary-meta {
  font-size: var(--font-caption);
  color: var(--color-text-secondary);
}

.roster-tools {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.tool-actions {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.roster-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.roster-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background var(--transition-fast);
}

@media (hover: hover) {
  .roster-row:hover {
    background: var(--bg-hover);
  }
}

.roster-row:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.row-check {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
}

.row-check.is-paid {
  background: var(--color-success-strong);
  color: var(--color-text-inverse);
}

.row-check.is-unpaid {
  background: var(--color-bg-subtle);
  border: 1px solid var(--color-border);
  color: var(--color-text-tertiary);
}

.row-name {
  flex: 1;
  min-width: 0;
  font-size: var(--font-content);
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.roster-row.is-paid .row-name {
  font-weight: var(--font-weight-medium);
}

.row-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  padding: 1px 7px;
  border-radius: var(--radius-full);
  background: var(--color-warning-soft);
  color: var(--color-warning-strong);
  font-size: var(--font-caption);
}

.row-state {
  flex-shrink: 0;
  font-size: var(--font-caption);
  font-variant-numeric: tabular-nums;
}

.row-state.is-paid {
  color: var(--color-success-strong);
}

.row-state.is-unpaid {
  color: var(--color-text-tertiary);
}

.roster-hint {
  padding: var(--space-5) 0;
  text-align: center;
  font-size: var(--font-secondary);
  color: var(--color-text-tertiary);
}

.confirm-text {
  font-size: var(--font-secondary);
  line-height: 1.7;
  color: var(--color-text-secondary);
}

.confirm-text strong {
  color: var(--color-text-primary);
}
</style>
