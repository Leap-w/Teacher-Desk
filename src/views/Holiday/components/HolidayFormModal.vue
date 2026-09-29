<script setup lang="ts">
import { ref, watch } from 'vue'

import { AppButton, AppField, AppInput, AppModal, AppTextarea } from '@/components/ui'
import { isDateKey } from '@/utils/date'
import type { Holiday, HolidayInput } from '@/types/holiday'

/**
 * HolidayFormModal — 新建 / 编辑自定义假期。
 *
 * 起止日期填反了**不拦**：`Holiday` 的数据层会把两者交换（`utils/holiday.ts` 的
 * `normalizeHoliday`），这里再挡一道只会让教师对着「开始不能晚于结束」发呆，
 * 而他真正想建的就是那个假期，只是两个框填的顺序反了。
 *
 * 虚拟周末不会走到这里——它没有编辑入口，它的日期由日历决定（见 store 的 `updateHoliday`）。
 */
const props = defineProps<{
  modelValue: boolean
  /** 传了就是编辑模式；不传是新建 */
  holiday?: Holiday
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  submit: [payload: HolidayInput]
}>()

const name = ref('')
const startDate = ref('')
const endDate = ref('')
const note = ref('')
const error = ref('')

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    name.value = props.holiday?.name ?? ''
    startDate.value = props.holiday?.startDate ?? ''
    endDate.value = props.holiday?.endDate ?? ''
    note.value = props.holiday?.note ?? ''
    error.value = ''
  },
  { immediate: true },
)

function close(): void {
  emit('update:modelValue', false)
}

function submit(): void {
  const trimmed = name.value.trim()
  if (!trimmed) {
    error.value = '请填假期名称'
    return
  }
  if (!isDateKey(startDate.value) || !isDateKey(endDate.value)) {
    error.value = '请选择开始与结束日期'
    return
  }
  error.value = ''
  emit('submit', {
    name: trimmed,
    startDate: startDate.value,
    endDate: endDate.value,
    note: note.value.trim(),
  })
}
</script>

<template>
  <AppModal
    :model-value="modelValue"
    :title="holiday ? '编辑假期' : '新建假期'"
    :width="420"
    @update:model-value="close"
  >
    <!-- 表单仅作语义分组：按钮在弹窗 footer（表单外的兄弟节点） -->
    <form class="holiday-form" @submit.prevent>
      <AppField label="假期名称" required :error="error">
        <AppInput v-model="name" placeholder="如：国庆、藏历新年、雪顿节" :error="!!error" />
      </AppField>

      <div class="date-row">
        <AppField label="开始日期" required>
          <AppInput v-model="startDate" type="date" />
        </AppField>
        <AppField label="结束日期" required>
          <AppInput v-model="endDate" type="date" />
        </AppField>
      </div>

      <AppField label="备注" hint="选填（如「放假前发家长通知」）">
        <AppTextarea v-model="note" :rows="2" placeholder="选填" />
      </AppField>
    </form>

    <template #footer>
      <AppButton variant="ghost" @click="close">取消</AppButton>
      <AppButton @click="submit">{{ holiday ? '保存' : '创建' }}</AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.holiday-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.date-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}
</style>
