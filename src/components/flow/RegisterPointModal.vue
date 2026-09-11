<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { AppButton, AppField, AppInput, AppModal, AppSelect } from '@/components/ui'
import { useNow } from '@/composables/useToday'
import {
  HALF_DAY_OPTIONS,
  REGISTER_MODE_LABELS,
  dayPointOf,
  formatDayPoint,
  oppositeMode,
  pickRegisterPoint,
  registerPointError,
} from '@/utils/point'
import type { DayPoint, HalfDay, RegisterEndpoints, RegisterMode } from '@/types/point'

/**
 * 离校 / 返校登记弹窗（Phase 7A 抽自请假的 LeaveRegisterModal）。
 *
 * 只认「日期 + 上午 / 下午」这一个形状，不认识具体模块的记录长什么样：
 * 记录相关的上下文（谁的、哪一段）由调用方经 `#context` 插槽给，
 * 两个端点从 `endpoints` 里按 `mode` 取——调用方直接把记录传进来即可（`RegisterEndpoints`）。
 *
 * 当前唯一调用方是请假模块；Phase 7B 的周末返家按拍板口径不记离校 / 返校时刻，
 * 因此没有接到这里（见 `types/weekend.ts` 与开发手册 §9.17）。
 */

interface Props {
  modelValue: boolean
  /** left = 离校登记，back = 返校登记 */
  mode: RegisterMode
  /** 记录上的两个端点：本端已有值即「修改」，另一端作时间线参照 */
  endpoints?: RegisterEndpoints
}

const props = withDefaults(defineProps<Props>(), {
  endpoints: () => ({}),
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: [point: DayPoint]
}>()

const now = useNow()
const date = ref('')
const half = ref<HalfDay>('am')
const error = ref('')

const verb = computed(() => REGISTER_MODE_LABELS[props.mode])

/** 此刻的时间点（与表单同款半天粒度），用于「登记的是既成事实」这条守卫与默认值 */
const nowPoint = computed<DayPoint>(() => dayPointOf(now.value))

/** 本端已登记过的时间 → 本次是修改（时间记错了不必删记录重建） */
const existing = computed(() => pickRegisterPoint(props.endpoints, props.mode))

/** 参照的另一端：离校不得晚于已登记的返校，返校不得早于离校 */
const counterpart = computed(() => pickRegisterPoint(props.endpoints, oppositeMode(props.mode)))

const title = computed(() => `${existing.value ? '修改' : '登记'}${verb.value}`)

/** 另一端已登记时给一行提示，教师一眼能看到「时间线现在摆在哪」 */
const counterpartHint = computed(() =>
  counterpart.value
    ? `已登记${REGISTER_MODE_LABELS[oppositeMode(props.mode)]}：${formatDayPoint(counterpart.value)}`
    : '',
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
    // 默认此刻：登记的多是刚发生的事；上午点开就是上午。
    // 用共享时钟的值（与守卫同源），不另取 `new Date()`——否则跨半天边界时
    // 默认值可能比守卫认定的「现在」晚半步，教师不动默认值反而被拦下。
    date.value = nowPoint.value.date
    half.value = nowPoint.value.half
  },
)

/**
 * 确认：不在这里关弹窗——由页面按写入结果决定
 * （记录已被另一处改动时保持打开，教师改一改即可重试，与抽屉同口径）。
 */
function confirm() {
  if (!date.value) {
    error.value = '请选择日期'
    return
  }
  const message = registerPointError({
    point: { date: date.value, half: half.value },
    now: nowPoint.value,
    mode: props.mode,
    counterpart: counterpart.value,
  })
  if (message) {
    error.value = message
    return
  }
  error.value = ''
  emit('confirm', { date: date.value, half: half.value })
}

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <AppModal :model-value="modelValue" :title="title" :width="400" @update:model-value="close">
    <p class="context-text"><slot name="context" /></p>

    <div class="form-grid">
      <AppField label="日期" required :error="error">
        <AppInput v-model="date" type="date" :error="!!error" />
      </AppField>

      <AppField label="时段">
        <AppSelect v-model="half" :options="HALF_DAY_OPTIONS" />
      </AppField>
    </div>

    <p v-if="counterpartHint" class="rule-hint">{{ counterpartHint }}</p>

    <template #footer>
      <AppButton variant="ghost" @click="close">取消</AppButton>
      <AppButton @click="confirm">确定{{ verb }}</AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.context-text {
  font-size: var(--text-sm);
  line-height: 1.7;
  color: var(--color-text-secondary);
}

/* 插槽内容在调用方作用域里编译，子组件的 scoped 样式要经 :slotted 才够得着 */
.context-text :slotted(strong) {
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
