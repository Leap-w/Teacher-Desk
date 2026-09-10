<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { AppButton, AppField, AppInput, AppModal, AppSelect } from '@/components/ui'
import { useNow } from '@/composables/useToday'
import { formatDateKey } from '@/utils/date'
import { HALF_DAY_OPTIONS, formatLeavePeriod, formatLeavePoint, halfDayKey } from '@/utils/leave'
import type { HalfDay, LeavePoint, LeaveRecord } from '@/types/leave'

interface Props {
  modelValue: boolean
  record?: LeaveRecord
  /** left = 离校登记，back = 返校登记 */
  mode: 'left' | 'back'
}

const props = withDefaults(defineProps<Props>(), {
  record: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: [point: LeavePoint]
}>()

const now = useNow()
const date = ref('')
const half = ref<HalfDay>('am')
const error = ref('')

const isBack = computed(() => props.mode === 'back')
const verb = computed(() => (isBack.value ? '返校' : '离校'))

/** 此刻的时间点（与表单同款半天粒度），用于「登记的是既成事实」这条守卫 */
const nowPoint = computed<LeavePoint>(() => ({
  date: formatDateKey(now.value),
  half: now.value.getHours() < 12 ? 'am' : 'pm',
}))

/** 已登记过 → 本次是修改（时间记错了不必删记录重建） */
const existing = computed(() =>
  isBack.value ? props.record?.backToSchool : props.record?.leftSchool,
)

/** 参照的另一端：离校不得晚于已登记的返校，返校不得早于离校 */
const counterpart = computed(() =>
  isBack.value ? props.record?.leftSchool : props.record?.backToSchool,
)

const title = computed(() => `${existing.value ? '修改' : '登记'}${verb.value}`)

const ruleHint = computed(() =>
  isBack.value ? '返校时间不能早于离校时间' : '离校时间不能晚于已登记的返校时间',
)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    error.value = ''
    if (existing.value) {
      date.value = existing.value.date
      half.value = existing.value.half
      return
    }
    // 默认此刻：登记的多是刚发生的事；上午点开就是上午
    const current = new Date()
    date.value = formatDateKey(current)
    half.value = current.getHours() < 12 ? 'am' : 'pm'
  },
)

function validate(): boolean {
  if (!date.value) {
    error.value = '请选择日期'
    return false
  }
  const point: LeavePoint = { date: date.value, half: half.value }
  // 登记的是既成事实：未来的时间点必然是填错了（选错年份最常见），
  // 放行会让卡片立刻显示「已返校」这种没发生过的状态（Phase 5 口径）
  if (halfDayKey(point) > halfDayKey(nowPoint.value)) {
    error.value = `${verb.value}时间不能晚于现在`
    return false
  }
  const other = counterpart.value
  if (other) {
    const outOfOrder = isBack.value
      ? halfDayKey(point) < halfDayKey(other)
      : halfDayKey(point) > halfDayKey(other)
    if (outOfOrder) {
      error.value = ruleHint.value
      return false
    }
  }
  error.value = ''
  return true
}

/**
 * 确认：不在这里关弹窗——由页面按写入结果决定
 * （记录已被另一处改动时保持打开，教师改一改即可重试，与抽屉同口径）。
 */
function confirm() {
  if (!validate()) return
  emit('confirm', { date: date.value, half: half.value })
}

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <AppModal :model-value="modelValue" :title="title" :width="400" @update:model-value="close">
    <p class="confirm-text">
      {{ record ? record.studentName : '' }} 请假时段：
      <strong>{{ record ? formatLeavePeriod(record.start, record.end) : '' }}</strong>
    </p>

    <div class="form-grid">
      <AppField label="日期" required :error="error">
        <AppInput v-model="date" type="date" :error="!!error" />
      </AppField>

      <AppField label="时段">
        <AppSelect v-model="half" :options="HALF_DAY_OPTIONS" />
      </AppField>
    </div>

    <p v-if="counterpart" class="rule-hint">
      {{ isBack ? '已登记离校' : '已登记返校' }}：{{ formatLeavePoint(counterpart) }}
    </p>

    <template #footer>
      <AppButton variant="ghost" @click="close">取消</AppButton>
      <AppButton @click="confirm">确定{{ verb }}</AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.confirm-text {
  font-size: var(--text-sm);
  line-height: 1.7;
  color: var(--color-text-secondary);
}

.confirm-text strong {
  color: var(--color-text);
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
  margin-top: var(--space-4);
}

.rule-hint {
  margin-top: var(--space-2);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}
</style>
