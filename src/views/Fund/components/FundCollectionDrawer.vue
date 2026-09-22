<script setup lang="ts">
import { computed, reactive, watch } from 'vue'

import { AppButton, AppDrawer, AppField, AppInput } from '@/components/ui'
import { useNow } from '@/composables/useToday'
import { useToast } from '@/composables/useToast'
import { formatDateKey, isDateKey } from '@/utils/date'
import { formatMoney, parseAmount } from '@/utils/fund'
import type { FundCollection, FundCollectionInput } from '@/types/fund'

/**
 * FundCollectionDrawer — 新建 / 编辑一个收费批次（v3.6.0，规格第八节）。
 *
 * 这里只填**三件事**：这批叫什么、每人多少钱、哪天收的。
 * 名单不在这里建、金额不在这里填——名单从学生档案来（新转来的学生自然在名单里），
 * 收入由「已交人数 × 每人金额」当场算。少一个可填的金额字段，就少一条对不上的账。
 *
 * 编辑时若已经有人交了费，改每人金额会**当场显示重算结果**：
 * 「已交 61 人」这个事实不变，变的是乘出来的钱，教师得看见自己要改的是多大一个数。
 */
interface Props {
  modelValue: boolean
  /** 传入则为编辑模式 */
  collection?: FundCollection
  /** 编辑时的已交人数（用来预告改金额的后果） */
  paidCount?: number
}

const props = withDefaults(defineProps<Props>(), {
  collection: undefined,
  paidCount: 0,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  submit: [payload: FundCollectionInput]
}>()

const now = useNow()
const toast = useToast()

const isEdit = computed(() => Boolean(props.collection))

interface FormState {
  title: string
  amount: string
  date: string
}

function blankForm(): FormState {
  return { title: '', amount: '', date: formatDateKey(now.value) }
}

const form = reactive<FormState>(blankForm())
const errors = reactive({ title: '', amount: '', date: '' })

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    Object.assign(form, blankForm())
    errors.title = ''
    errors.amount = ''
    errors.date = ''
    const collection = props.collection
    if (!collection) return
    Object.assign(form, {
      title: collection.title,
      amount: String(collection.amountPerStudent),
      date: collection.date,
    })
  },
)

const amountValue = computed(() => parseAmount(form.amount))

/** 改金额之后这一批会变成多少钱（只在「已有人交」且金额确实变了时显示） */
const recomputeHint = computed(() => {
  const collection = props.collection
  if (!collection || props.paidCount <= 0) return ''
  const next = amountValue.value
  if (next === null || next === collection.amountPerStudent) return ''
  return `每人金额改了：已交 ${props.paidCount} 人 × ${formatMoney(next)} = ${formatMoney(props.paidCount * next)}`
})

function validate(): boolean {
  errors.title = form.title.trim() ? '' : '请填写批次名称'
  errors.amount = amountValue.value === null ? '请填写大于 0 的每人金额（最多两位小数）' : ''
  errors.date = isDateKey(form.date) ? '' : '请选择收费日期'
  return !errors.title && !errors.amount && !errors.date
}

function submit() {
  if (!validate()) {
    toast.danger(errors.title || errors.amount || errors.date)
    return
  }
  const amount = amountValue.value
  if (amount === null) return
  emit('submit', { title: form.title.trim(), amountPerStudent: amount, date: form.date })
}

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <AppDrawer
    :model-value="modelValue"
    :title="isEdit ? '编辑收费批次' : '新建收费批次'"
    :width="440"
    @update:model-value="close"
  >
    <form class="collection-form" @submit.prevent>
      <AppField label="批次名称" required :error="errors.title" hint="如 第一次班费 / 秋游活动费">
        <AppInput
          v-model="form.title"
          :maxlength="20"
          :error="!!errors.title"
          placeholder="这批收的是什么"
        />
      </AppField>

      <AppField
        label="每人金额（元）"
        required
        :error="errors.amount"
        hint="全班按这个数算，收入 = 已交人数 × 每人金额"
      >
        <AppInput
          v-model="form.amount"
          inputmode="decimal"
          :error="!!errors.amount"
          placeholder="0.00"
        />
      </AppField>

      <AppField label="收费日期" required :error="errors.date">
        <AppInput v-model="form.date" type="date" :error="!!errors.date" />
      </AppField>

      <p v-if="recomputeHint" class="recompute-hint">{{ recomputeHint }}</p>

      <p class="form-note">
        名单来自学生档案，建档时自动带上全班学生；勾选已交的人即可，不用手填金额。
      </p>
    </form>

    <template #footer>
      <AppButton variant="ghost" @click="close">取消</AppButton>
      <AppButton @click="submit">保存</AppButton>
    </template>
  </AppDrawer>
</template>

<style scoped>
.collection-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.recompute-hint {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-warning-soft);
  color: var(--color-warning-strong);
  font-size: var(--font-caption);
  line-height: 1.6;
}

.form-note {
  font-size: var(--font-caption);
  line-height: 1.6;
  color: var(--color-text-tertiary);
}
</style>
