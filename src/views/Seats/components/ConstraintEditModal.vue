<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { AppButton, AppModal, AppSelect } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useConstraintStore } from '@/stores/constraint'
import { CONSTRAINT_TYPE_LABELS, isPairConstraintType } from '@/utils/constraint'
import {
  ADJACENT_RULE_NOTE,
  BACK_ROW_MIN,
  FRONT_ROW_LIMIT,
  SAME_DESK_RULE_NOTE,
} from '@/utils/seat'
import { buildNameCounts, formatStudentShortName } from '@/utils/student'
import { DEFAULT_CLASSROOM_CONFIG } from '@/types/classroom'
import type { Student } from '@/types'
import type { SeatConstraintType } from '@/types/constraint'

/**
 * 添加座位约束弹窗：选类型（不能同桌 / 不能相邻 / 坐后排 / 坐前排 / 同区块）+ 选学生 → 生成一条约束。
 * 双人型（isPairConstraintType）需选第二位学生 B；坐后排 / 坐前排只作用于主体学生 A。
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

/** 类型展示顺序（标签取共享的 CONSTRAINT_TYPE_LABELS，避免两处维护） */
const TYPE_ORDER: readonly SeatConstraintType[] = [
  'no-deskmate',
  'no-adjacent',
  'back-row',
  'front-row',
  'same-block',
]

/**
 * 各类型的一句话说明（硬约束 = 必须满足，软规则 = 自动排座尽量满足）。
 * 「同桌 / 相邻」的说法与判定**同源**（`utils/seat.ts` 的文案常量，V1.1.2 Phase 2 统一）：
 * 说明里少写一句「隔着过道不算」，教师就会按错的预期去提约束。
 */
const TYPE_DESCRIPTIONS: Record<SeatConstraintType, string> = {
  'no-deskmate': `${SAME_DESK_RULE_NOTE}`,
  'no-adjacent': `${ADJACENT_RULE_NOTE}`,
  'back-row': `尽量安排在第 ${BACK_ROW_MIN}–${DEFAULT_CLASSROOM_CONFIG.rows} 排`,
  'front-row': `尽量安排在第 1–${FRONT_ROW_LIMIT} 排`,
  'same-block': '两人尽量在同一列块',
}

const constraintType = ref<SeatConstraintType>('no-deskmate')
const studentAId = ref('')
const studentBId = ref('')

/** 重名消歧计数：候选名单就是这份 `students`（v3.3.1） */
const nameCounts = computed(() => buildNameCounts(props.students))

/** 学生下拉项：默认姓名；重名且填了身份证尾号的显示「姓名（尾号）」 */
const studentOptions = computed(() =>
  props.students.map((student) => ({
    value: student.id,
    label: formatStudentShortName(student, nameCounts.value),
  })),
)

/** B 候选排除 A（预设时 A 固定在卡主，避免选出自己） */
const studentBOptions = computed(() =>
  studentOptions.value.filter((option) => option.value !== studentAId.value),
)

const presetName = computed(() =>
  props.presetStudent ? formatStudentShortName(props.presetStudent, nameCounts.value) : '',
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

/** 当前类型是否需要第二位学生（判定与 store / 求解器同源） */
const needsStudentB = computed(() => isPairConstraintType(constraintType.value))

/** 校验：A 必选；双人型还需 B 且与 A 互异（预设时 A 固定为卡主） */
const canSubmit = computed(() => {
  if (!studentAId.value) return false
  if (!needsStudentB.value) return true
  return Boolean(studentBId.value) && studentBId.value !== studentAId.value
})

function close() {
  emit('update:modelValue', false)
}

function submit() {
  if (!canSubmit.value) return
  const created = constraintStore.add({
    studentA: studentAId.value,
    // 单人型不携带学生 B（同一学生 + 同类型的规则不因 B 字段残留而重复）
    studentB: needsStudentB.value ? studentBId.value : undefined,
    type: constraintType.value,
  })
  if (!created) {
    toast.info('该约束已存在，未重复添加')
    return
  }
  toast.success(`已添加约束「${typeLabel(constraintType.value)}」`)
  close()
}

/** 类型标签（取共享常量，与列表 / 检查消息同源） */
function typeLabel(type: SeatConstraintType): string {
  return CONSTRAINT_TYPE_LABELS[type]
}
</script>

<template>
  <AppModal :model-value="modelValue" title="添加座位约束" :width="380" @update:model-value="close">
    <div class="edit-form">
      <div class="edit-field">
        <span class="edit-label">约束类型</span>
        <div class="edit-types" role="radiogroup" aria-label="约束类型">
          <button
            v-for="type in TYPE_ORDER"
            :key="type"
            type="button"
            role="radio"
            :aria-checked="constraintType === type"
            class="edit-type"
            :class="{ 'is-active': constraintType === type }"
            @click="constraintType = type"
          >
            <strong>{{ typeLabel(type) }}</strong>
            <small>{{ TYPE_DESCRIPTIONS[type] }}</small>
          </button>
        </div>
        <p class="edit-hint">
          「不能同桌 / 不能相邻」是自动排座的硬约束；「坐后排 / 坐前排 /
          同区块」是软规则（尽量满足）。
        </p>
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

      <div v-if="needsStudentB" class="edit-field">
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

.edit-hint {
  font-size: var(--text-xs);
  line-height: 1.7;
  color: var(--color-text-faint);
}

.edit-types {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2);
}

/* 5 个类型位：末项（同区块）独占整行，避免右侧留空 */
.edit-type:last-child {
  grid-column: 1 / -1;
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
