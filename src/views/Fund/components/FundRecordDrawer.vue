<script setup lang="ts">
import { computed, reactive, watch } from 'vue'

import {
  AppButton,
  AppDrawer,
  AppField,
  AppInput,
  AppSegmented,
  AppTextarea,
} from '@/components/ui'
import { useNow } from '@/composables/useToday'
import { useToast } from '@/composables/useToast'
import { useFundStore } from '@/stores/fund'
import { formatDateKey, isDateKey } from '@/utils/date'
import { formatMoney, parseAmount, presetCategories } from '@/utils/fund'
import FundCategoryPicker from './FundCategoryPicker.vue'
import type { FundRecord, FundRecordInput, FundRecordType } from '@/types/fund'

/**
 * FundRecordDrawer — 记一笔收入 / 支出（v3.6.0，规格第五、六节）。
 *
 * 收入与支出**共用这一个抽屉**：两者的字段逐项对应（标题 / 金额 / 日期 / 分类 / 备注），
 * 差别只有分类那一排预设。拆成两个抽屉会让「这笔记错方向了」变成关掉重开，
 * 而这里改一下顶部的方向开关就行（store 也允许改方向，见 `updateRecord`）。
 */
interface Props {
  modelValue: boolean
  /** 传入则为编辑模式 */
  record?: FundRecord
  /** 新增时的默认方向（由页面上的「+」选择的入口决定） */
  defaultType?: FundRecordType
}

const props = withDefaults(defineProps<Props>(), {
  record: undefined,
  defaultType: 'expense',
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  submit: [payload: FundRecordInput]
}>()

const fundStore = useFundStore()
const toast = useToast()
const now = useNow()

const isEdit = computed(() => Boolean(props.record))

const TYPE_OPTIONS: { value: FundRecordType; label: string }[] = [
  { value: 'income', label: '收入' },
  { value: 'expense', label: '支出' },
]

interface FormState {
  type: FundRecordType
  title: string
  /** 金额保持字符串：`12.` 这种敲到一半的输入不该被数字类型吃掉小数点 */
  amount: string
  date: string
  category: string
  note: string
}

/** 新表单：日期默认今天（绝大多数记账就是记今天），分类默认该方向的第一项 */
function blankForm(type: FundRecordType): FormState {
  return {
    type,
    title: '',
    amount: '',
    date: formatDateKey(now.value),
    category: presetCategories(type)[0]?.name ?? '',
    note: '',
  }
}

const form = reactive<FormState>(blankForm(props.defaultType))
const errors = reactive({ title: '', amount: '', date: '', category: '' })

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    Object.assign(form, blankForm(props.defaultType))
    for (const key of Object.keys(errors) as (keyof typeof errors)[]) errors[key] = ''
    const record = props.record
    if (!record) return
    Object.assign(form, {
      type: record.type,
      title: record.title,
      amount: String(record.amount),
      date: record.date,
      category: record.category,
      note: record.note ?? '',
    })
  },
)

/** 输入框里当前这串数字读懂之后的样子（随敲随显，教师能当场看出有没有多打一个 0） */
const amountPreview = computed(() => {
  const value = parseAmount(form.amount)
  return value === null ? '' : formatMoney(value)
})

/**
 * 换方向时把分类一起带过去。
 * 不这么做的话，把一笔支出改成收入会留下「收入 / 卫生用品」这种记录——
 * 数据本身合法，但两个月后没人能看出它是什么意思。
 */
function onTypeChange(next: FundRecordType) {
  form.type = next
  const options = fundStore.categoryNamesOf(next)
  if (!options.includes(form.category)) {
    form.category = presetCategories(next)[0]?.name ?? ''
  }
}

function validate(): boolean {
  errors.title = form.title.trim() ? '' : '请填写标题'
  const amount = parseAmount(form.amount)
  errors.amount = amount === null ? '请填写大于 0 的金额（最多两位小数）' : ''
  errors.date = isDateKey(form.date) ? '' : '请选择日期'
  errors.category = form.category.trim() ? '' : '请选择分类'
  return !errors.title && !errors.amount && !errors.date && !errors.category
}

/**
 * 提交：**不关抽屉**——关不关由页面按写入结果决定（与其余模块同口径）。
 * 写入被拒时已填内容都留着，改一改就能重试。
 */
function submit() {
  if (!validate()) {
    toast.danger(errors.title || errors.amount || errors.date || errors.category)
    return
  }
  const amount = parseAmount(form.amount)
  if (amount === null) return
  const note = form.note.trim()
  emit('submit', {
    type: form.type,
    title: form.title.trim(),
    amount,
    date: form.date,
    category: form.category.trim(),
    ...(note ? { note } : {}),
  })
}

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <AppDrawer
    :model-value="modelValue"
    :title="isEdit ? '编辑记录' : '记一笔'"
    :width="460"
    @update:model-value="close"
  >
    <form class="fund-form" @submit.prevent>
      <AppField label="方向" required>
        <AppSegmented
          :options="TYPE_OPTIONS"
          :model-value="form.type"
          label="收支方向"
          @update:model-value="onTypeChange"
        />
      </AppField>

      <AppField label="标题" required :error="errors.title" hint="如 收第二次班费 / 买扫把和拖把">
        <AppInput
          v-model="form.title"
          :maxlength="30"
          :error="!!errors.title"
          placeholder="这笔钱是干什么的"
        />
      </AppField>

      <div class="form-grid">
        <AppField
          label="金额（元）"
          required
          :error="errors.amount"
          :hint="amountPreview ? `= ${amountPreview}` : '只填数字，不填正负号'"
        >
          <!-- type=text + inputmode=decimal：手机上照样弹数字键盘，
               同时躲开 number 输入框把「12.」当成非法值清空的老毛病 -->
          <AppInput
            v-model="form.amount"
            inputmode="decimal"
            :error="!!errors.amount"
            placeholder="0.00"
          />
        </AppField>

        <AppField label="日期" required :error="errors.date">
          <AppInput v-model="form.date" type="date" :error="!!errors.date" />
        </AppField>
      </div>

      <AppField
        label="分类"
        required
        :error="errors.category"
        :hint="form.type === 'expense' ? '常用的支出类型可以自己加，下次直接选' : ''"
      >
        <FundCategoryPicker v-model="form.category" :type="form.type" />
      </AppField>

      <AppField label="备注" hint="可选">
        <AppTextarea
          v-model="form.note"
          :rows="2"
          :maxlength="100"
          placeholder="补一句话，比如谁经手"
        />
      </AppField>
    </form>

    <template #footer>
      <AppButton variant="ghost" @click="close">取消</AppButton>
      <AppButton @click="submit">保存</AppButton>
    </template>
  </AppDrawer>
</template>

<style scoped>
.fund-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}

@media (max-width: 420px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
