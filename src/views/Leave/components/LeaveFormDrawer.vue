<script setup lang="ts">
import { computed, reactive, watch } from 'vue'

import { AppButton, AppDrawer, AppField, AppInput, AppSelect, AppTextarea } from '@/components/ui'
import { useNow } from '@/composables/useToday'
import { useToast } from '@/composables/useToast'
import { useLeaveStore } from '@/stores/leave'
import { useStudentStore } from '@/stores/student'
import { formatDateKey } from '@/utils/date'
import { HALF_DAY_OPTIONS, halfDayKey, isDayPoint } from '@/utils/point'
import {
  KNOWN_LEAVE_TYPES,
  LEAVE_STATUS_LABELS,
  LEAVE_TYPE_OPTIONS,
  formatLeaveDuration,
  formatLeavePeriod,
} from '@/utils/leave'
import { formatStudentShortName } from '@/utils/student'
import type { LeaveInput, LeaveRecord, LeaveType } from '@/types/leave'
import type { HalfDay } from '@/types/point'
import type { SelectOption } from '@/types'

interface Props {
  modelValue: boolean
  /** 传入则为编辑模式，否则为新增 */
  record?: LeaveRecord
}

const props = withDefaults(defineProps<Props>(), {
  record: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  submit: [payload: LeaveInput]
}>()

const toast = useToast()
const leaveStore = useLeaveStore()
const studentStore = useStudentStore()
const now = useNow()

const isEdit = computed(() => Boolean(props.record))

interface FormState {
  /** undefined = 尚未选择（下拉显示占位项） */
  studentId: string | undefined
  type: LeaveType | undefined
  startDate: string
  startHalf: HalfDay
  endDate: string
  endHalf: HalfDay
  reason: string
}

/** 默认「今天上午 → 今天下午」整天：最常见的请假形态，教师改一下即可 */
function blankForm(): FormState {
  const today = formatDateKey(now.value)
  return {
    studentId: undefined,
    type: undefined,
    startDate: today,
    startHalf: 'am',
    endDate: today,
    endHalf: 'pm',
    reason: '',
  }
}

const form = reactive<FormState>(blankForm())
const errors = reactive({ studentId: '', type: '', startDate: '', endDate: '', reason: '' })

/**
 * 学生选项：按学号升序（花名册顺序，六十多人的名单里比录入顺序好找）。
 * 编辑一条「学生已被删除」的待处理记录时，补一个占位项，避免下拉显示成空白。
 */
const studentOptions = computed<SelectOption<string>[]>(() => {
  const options: SelectOption<string>[] = [...studentStore.activeStudents]
    .sort((a, b) => a.studentNo.localeCompare(b.studentNo))
    .map((student) => ({
      label: formatStudentShortName(student, studentStore.nameCounts),
      value: student.id,
    }))
  const record = props.record
  if (record && !studentStore.activeStudents.some((item) => item.id === record.studentId)) {
    options.unshift({
      label: `${record.studentName}（已不在档案）`,
      value: record.studentId,
      disabled: true,
    })
  }
  return options
})

const startPoint = computed(() => ({ date: form.startDate, half: form.startHalf }))
const endPoint = computed(() => ({ date: form.endDate, half: form.endHalf }))

/** 时段合法（两个日期都填了且结束不早于开始）时的时长文案，随填随显 */
const durationText = computed(() => {
  if (!form.startDate || !form.endDate) return ''
  if (halfDayKey(endPoint.value) < halfDayKey(startPoint.value)) return ''
  return `共 ${formatLeaveDuration(startPoint.value, endPoint.value)}`
})

/**
 * 重叠提示（**只提示不拦截**）：是否允许同一时段再次请假由教师判断，
 * 应用不替他做决定（§11.5）。已驳回的记录不算——那意味着这次请假不成立。
 */
const overlapHint = computed(() => {
  if (!form.studentId || !durationText.value) return ''
  const existing = leaveStore.overlappingLeaves(
    form.studentId,
    startPoint.value,
    endPoint.value,
    props.record?.id,
  )
  const first = existing[0]
  if (!first) return ''
  const suffix = existing.length > 1 ? `等 ${existing.length} 条` : ''
  return `该学生在此时段已有请假记录：${formatLeavePeriod(first.start, first.end)}（${LEAVE_STATUS_LABELS[first.status]}）${suffix}。仅作提醒，仍可提交。`
})

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    Object.assign(form, blankForm())
    errors.studentId = ''
    errors.type = ''
    errors.startDate = ''
    errors.endDate = ''
    errors.reason = ''
    const record = props.record
    if (!record) return
    Object.assign(form, {
      studentId: record.studentId,
      type: record.type,
      startDate: record.start.date,
      startHalf: record.start.half,
      endDate: record.end.date,
      endHalf: record.end.half,
      reason: record.reason,
    })
  },
)

// 改了时段就清掉上一次的到期报错，避免旧提示一直挂着（与课程抽屉同口径）
watch(
  () => [form.startDate, form.startHalf, form.endDate, form.endHalf],
  () => {
    errors.endDate = ''
  },
)

function validate(): boolean {
  errors.studentId = form.studentId ? '' : '请选择学生'
  errors.type = form.type ? '' : '请选择请假类型'
  errors.startDate = form.startDate ? '' : '请选择开始日期'
  errors.endDate = form.endDate ? '' : '请选择结束日期'
  if (!errors.startDate && !errors.endDate) {
    if (!isDayPoint(startPoint.value) || !isDayPoint(endPoint.value)) {
      errors.endDate = '日期格式不正确'
    } else if (halfDayKey(endPoint.value) < halfDayKey(startPoint.value)) {
      errors.endDate = '结束时段不能早于开始时段'
    }
  }
  errors.reason = form.reason.trim() ? '' : '请填写请假原因'
  return !errors.studentId && !errors.type && !errors.startDate && !errors.endDate && !errors.reason
}

/**
 * 提交：这里**不关抽屉**——关不关由页面按写入结果决定。
 * 写入被拒时抽屉与已填内容都留着，教师改一改就能重试（与课程抽屉同口径）。
 */
function submit() {
  if (!validate()) {
    // 手机上抽屉内容会滚动，出错字段可能不在视口内，光靠字段内联提示等于没反馈
    toast.danger(
      errors.studentId || errors.type || errors.startDate || errors.endDate || errors.reason,
    )
    return
  }
  const type = KNOWN_LEAVE_TYPES.find((item) => item === form.type)
  const studentId = form.studentId
  if (!type || !studentId) return
  emit('submit', {
    studentId,
    type,
    start: { ...startPoint.value },
    end: { ...endPoint.value },
    reason: form.reason.trim(),
  })
}

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <AppDrawer
    :model-value="modelValue"
    :title="isEdit ? '编辑请假' : '新增请假'"
    :width="440"
    @update:model-value="close"
  >
    <!-- 表单仅作语义分组：保存 / 取消在抽屉 footer（表单外的兄弟节点），回车保存未接线，
         保留 prevent 只为兜住浏览器可能的隐式提交（否则整页刷新，未保存内容全丢） -->
    <form class="leave-form" @submit.prevent>
      <AppField label="学生" required :error="errors.studentId">
        <AppSelect
          v-model="form.studentId"
          :options="studentOptions"
          :error="!!errors.studentId"
          placeholder="请选择学生"
        />
      </AppField>

      <AppField label="请假类型" required :error="errors.type">
        <AppSelect
          v-model="form.type"
          :options="LEAVE_TYPE_OPTIONS"
          :error="!!errors.type"
          placeholder="请选择类型"
        />
      </AppField>

      <div class="form-grid">
        <AppField label="开始日期" required :error="errors.startDate">
          <AppInput v-model="form.startDate" type="date" :error="!!errors.startDate" />
        </AppField>

        <AppField label="开始时段">
          <AppSelect v-model="form.startHalf" :options="HALF_DAY_OPTIONS" />
        </AppField>

        <AppField label="结束日期" required :error="errors.endDate">
          <AppInput v-model="form.endDate" type="date" :error="!!errors.endDate" />
        </AppField>

        <AppField label="结束时段">
          <AppSelect v-model="form.endHalf" :options="HALF_DAY_OPTIONS" />
        </AppField>
      </div>

      <p v-if="durationText" class="duration-line">请假时长：{{ durationText }}</p>
      <p v-if="overlapHint" class="overlap-hint">{{ overlapHint }}</p>

      <AppField
        label="请假原因"
        required
        :error="errors.reason"
        hint="如 发烧需回家休息 / 家中有事需回家一趟"
      >
        <AppTextarea v-model="form.reason" :rows="3" :error="!!errors.reason" />
      </AppField>
    </form>

    <template #footer>
      <AppButton variant="ghost" @click="close">取消</AppButton>
      <AppButton @click="submit">保存</AppButton>
    </template>
  </AppDrawer>
</template>

<style scoped>
.leave-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}

.duration-line {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.overlap-hint {
  font-size: var(--text-xs);
  line-height: 1.6;
  color: var(--color-warning-strong);
}

@media (max-width: 420px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
