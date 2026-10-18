<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { AppButton, AppField, AppInput, AppModal, AppTextarea } from '@/components/ui'
import { isDateKey } from '@/utils/date'
import { weekendKeyOfHolidayId } from '@/utils/holiday'
import type { Holiday, HolidayInput } from '@/types/holiday'

/**
 * HolidayFormModal — 新建假期 / 编辑假期（含自动生成的周末，v3.7.6）。
 *
 * 起止日期填反了**不拦**：`Holiday` 的数据层会把两者交换（`utils/holiday.ts` 的
 * `normalizeHoliday`），这里再挡一道只会让教师对着「开始不能晚于结束」发呆，
 * 而他真正想建的就是那个假期，只是两个框填的顺序反了。
 *
 * 编辑自动周末时，表单按「它当前的样子」（没有编辑过就是日期范围名称 + 周六周日）预填；
 * 保存后 store 会落一条同 id 的覆盖记录，重新计算周末不会覆盖用户修改。
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

const isWeekend = computed(() => weekendKeyOfHolidayId(props.holiday?.id) !== undefined)

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
    :title="holiday ? (isWeekend ? '编辑周末' : '编辑假期') : '新建假期'"
    :width="420"
    @update:model-value="close"
  >
    <!-- 表单仅作语义分组：按钮在弹窗 footer（表单外的兄弟节点） -->
    <form class="holiday-form" @submit.prevent>
      <p v-if="isWeekend" class="weekend-hint">
        这是系统按周末自动生成的记录。可以改名称、起止日期和备注，保存后会一直保留；
        重新计算周末或切换学期都不会覆盖。
      </p>

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

.weekend-hint {
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-fill-disabled);
  font-size: var(--text-sm);
  line-height: 1.7;
  color: var(--color-text-secondary);
}
</style>
