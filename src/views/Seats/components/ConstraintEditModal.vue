<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { AppButton, AppModal, AppSelect } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useConstraintStore } from '@/stores/constraint'
import { formatStudentShortName } from '@/utils/student'
import type { Student } from '@/types'
import type { SeatConstraintType } from '@/types/constraint'

/**
 * 添加座位约束弹窗（基础版）：选类型（不能同桌 / 不能相邻）+ 选第二位学生 → 生成一条约束。
 * 可由信息卡（预设学生 A = 卡主）或约束面板（无预设，自行选 A / B）打开。
 */

interface Props {
  modelValue: boolean
  /** 预设约束主体学生（信息卡入口）；缺省需自行选择 */
  presetStudent?: Student
  /** 候选学生（全部活跃学生） */
  students: Student[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [open: boolean]
}>()

const toast = useToast()
const constraintStore = useConstraintStore()

const TYPE_DESCRIPTIONS: Record<'no-deskmate' | 'no-adjacent', string> = {
  'no-deskmate': '两人不得坐在同一桌',
  'no-adjacent': '两人不得左右 / 前后相邻',
}

const constraintType = ref<SeatConstraintType>('no-deskmate')
const studentAId = ref('')
const studentBId = ref('')

/** 学生下拉项：姓名（学号后四位），重复姓名可凭后四位区分 */
const studentOptions = computed(() =>
  props.students.map((student) => ({
    value: student.id,
    label: formatStudentShortName(student),
  })),
)

/** B 候选排除 A（预设时 A 固定在卡主，避免选出自己） */
const studentBOptions = computed(() =>
  studentOptions.value.filter((option) => option.value !== studentAId.value),
)

const presetName = computed(() =>
  props.presetStudent ? formatStudentShortName(props.presetStudent) : '',
)

/** 打开时重置为默认值 */
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    constraintType.value = 'no-deskmate'
    studentAId.value = props.presetStudent?.id ?? ''
    studentBId.value = ''
  },
)

/** A 变化后若 B 撞上 A（曾以 A 为另一人）→ 清空 B 重选 */
watch(studentAId, (id) => {
  if (studentBId.value === id) studentBId.value = ''
})

/** 校验：A/B 必选且互异（预设时 A 固定） */
const canSubmit = computed(() => {
  if (!studentAId.value || !studentBId.value) return false
  return studentAId.value !== studentBId.value
})

function close() {
  emit('update:modelValue', false)
}

function submit() {
  if (!canSubmit.value) return
  const created = constraintStore.add({
    studentA: studentAId.value,
    studentB: studentBId.value,
    type: constraintType.value,
  })
  if (!created) {
    toast.info('该约束已存在（同一对学生的同类型约束）')
    return
  }
  toast.success(`已添加约束「${typeLabel(constraintType.value)}」`)
  close()
}

/** 类型标签（本弹窗只出现手工录入的两类） */
function typeLabel(type: SeatConstraintType): string {
  if (type === 'no-deskmate') return '不能同桌'
  if (type === 'no-adjacent') return '不能相邻'
  return type
}
</script>

<template>
  <AppModal :model-value="modelValue" title="添加座位约束" :width="380" @update:model-value="close">
    <div class="edit-form">
      <div class="edit-field">
        <span class="edit-label">约束类型</span>
        <div class="edit-types" role="radiogroup" aria-label="约束类型">
          <button
            v-for="type in ['no-deskmate', 'no-adjacent']"
            :key="type"
            type="button"
            role="radio"
            :aria-checked="constraintType === type"
            class="edit-type"
            :class="{ 'is-active': constraintType === type }"
            @click="constraintType = type as SeatConstraintType"
          >
            <strong>{{ typeLabel(type as SeatConstraintType) }}</strong>
            <small>{{ TYPE_DESCRIPTIONS[type as 'no-deskmate' | 'no-adjacent'] }}</small>
          </button>
        </div>
      </div>

      <div class="edit-field">
        <span class="edit-label">学生 A</span>
        <p v-if="presetName" class="edit-fixed">{{ presetName }}</p>
        <AppSelect
          v-else
          v-model="studentAId"
          :options="studentOptions"
          placeholder="选择学生"
          aria-label="选择学生 A"
        />
      </div>

      <div class="edit-field">
        <span class="edit-label">学生 B（另一位学生）</span>
        <AppSelect
          v-model="studentBId"
          :options="studentBOptions"
          placeholder="选择学生"
          aria-label="选择学生 B"
        />
      </div>
    </div>

    <template #footer>
      <AppButton variant="ghost" @click="close">取消</AppButton>
      <AppButton :disabled="!canSubmit" @click="submit">添加约束</AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.edit-form {
  display: grid;
  gap: var(--space-4);
}

.edit-field {
  display: grid;
  gap: var(--space-2);
}

.edit-label {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.edit-fixed {
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--color-fill-disabled);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
}

.edit-types {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2);
}

.edit-type {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  padding: 10px 12px;
  font: inherit;
  color: var(--color-text);
  cursor: pointer;
  text-align: left;
  transition:
    border-color var(--transition-fast),
    background var(--transition-fast);
}

.edit-type strong {
  font-size: var(--text-sm);
}

.edit-type small {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  line-height: 1.5;
}

.edit-type:hover {
  border-color: var(--color-primary);
}

.edit-type.is-active {
  border-color: var(--color-primary-strong);
  background: var(--color-primary-soft);
}

.edit-type.is-active strong {
  color: var(--color-primary-strong);
}

.edit-type:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}
</style>
