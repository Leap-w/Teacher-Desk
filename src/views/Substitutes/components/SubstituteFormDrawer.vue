<script setup lang="ts">
import { computed, reactive, watch } from 'vue'

import { AppButton, AppDrawer, AppField, AppInput, AppSelect, AppTextarea } from '@/components/ui'
import { useAppSettingsStore } from '@/stores/appSettings'
import { useSubstituteStore } from '@/stores/substitute'
import type { SelectOption } from '@/types'
import type { CoursePeriodId } from '@/types/timetable'
import type { SubstituteInput, SubstituteRecord } from '@/types/substitute'
import { formatDateKey, isDateKey } from '@/utils/date'
import { SUBSTITUTE_TEXT_MAX } from '@/utils/substitute'
import SubstituteSuggestionChips from './SubstituteSuggestionChips.vue'

/**
 * 代课记录编辑抽屉（v3.7.5 §6.1 / §6.2）：新增与编辑共用。
 *
 * 六个字段就是规格列出的那六个——日期 / 节次 / 被代课教师 / 实际代课教师 / 科目 / 备注。
 * 前五个必填：缺任何一项这条记录都说不清「谁替谁上了哪天的哪节课」。
 *
 * 节次**复用课程表的 10 个时段**（§6.1「节次应复用现有课程表节次定义」），
 * 选项从 `appSettings.periods`（生效作息）派生，因此教学设置里改过时间后，
 * 这里显示的时间跟着变（v3.3.0 的「时间只有一个答案」口径）。
 *
 * 本抽屉**只做收集与校验，不落库**：提交交给页面调 store；写入被拒时抽屉不关，
 * 已填的内容留着让教师改一改重试（同 LeaveFormDrawer / WorkEditDrawer）。
 */
interface Props {
  modelValue: boolean
  /** 传入则为编辑模式，否则为新增 */
  record?: SubstituteRecord
  /** 新增时的默认日期（通常是今天） */
  defaultDate?: string
}

const props = withDefaults(defineProps<Props>(), {
  record: undefined,
  defaultDate: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  submit: [payload: SubstituteInput]
}>()

const substituteStore = useSubstituteStore()
const appSettings = useAppSettingsStore()

const isEdit = computed(() => Boolean(props.record))

/** 时段选项带起止时间——教师按时间找节次比按序号快（同 LessonEditDrawer） */
const periodOptions = computed<SelectOption<CoursePeriodId>[]>(() =>
  appSettings.periods.map((period) => ({
    label: `${period.label}（${period.startTime}–${period.endTime}）`,
    value: period.id,
  })),
)

interface FormState {
  date: string
  /** 新增时先留空，逼教师明确选一节——默认填第一节会悄悄记错节次 */
  periodId: CoursePeriodId | ''
  originalTeacher: string
  substituteTeacher: string
  subject: string
  remark: string
}

const form = reactive<FormState>({
  date: '',
  periodId: '',
  originalTeacher: '',
  substituteTeacher: '',
  subject: '',
  remark: '',
})

const errors = reactive({
  date: '',
  period: '',
  originalTeacher: '',
  substituteTeacher: '',
  subject: '',
})

function resetErrors(): void {
  errors.date = ''
  errors.period = ''
  errors.originalTeacher = ''
  errors.substituteTeacher = ''
  errors.subject = ''
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    const record = props.record
    if (record) {
      form.date = record.date
      form.periodId = record.periodId
      form.originalTeacher = record.originalTeacher
      form.substituteTeacher = record.substituteTeacher
      form.subject = record.subject
      form.remark = record.remark ?? ''
    } else {
      form.date = props.defaultDate ?? formatDateKey(new Date())
      form.periodId = ''
      form.originalTeacher = ''
      form.substituteTeacher = ''
      form.subject = ''
      form.remark = ''
    }
    resetErrors()
  },
  { immediate: true },
)

/**
 * 必填校验。日期用 `isDateKey` 而不是「非空」：`<input type="date">` 在部分浏览器里
 * 允许敲出 `0002-13-45` 这类值（年度输入不为空就往外传），非空检查会把它放行，
 * 落库时反而被 store 静默拒绝，教师看到的是「保存没反应」。
 */
function validate(): boolean {
  errors.date = isDateKey(form.date) ? '' : '请选择代课日期'
  errors.period = form.periodId ? '' : '请选择节次'
  errors.originalTeacher = form.originalTeacher.trim() ? '' : '请填写被代课教师'
  errors.substituteTeacher = form.substituteTeacher.trim() ? '' : '请填写实际代课教师'
  errors.subject = form.subject.trim() ? '' : '请填写科目'
  return !(
    errors.date ||
    errors.period ||
    errors.originalTeacher ||
    errors.substituteTeacher ||
    errors.subject
  )
}

function submit(): void {
  if (!validate() || !form.periodId) return
  emit('submit', {
    date: form.date,
    periodId: form.periodId,
    originalTeacher: form.originalTeacher.trim(),
    substituteTeacher: form.substituteTeacher.trim(),
    subject: form.subject.trim(),
    // 备注留空即不写这个字段（`remark: ''` 与「没有备注」是两种数据，同 store 口径）
    ...(form.remark.trim() ? { remark: form.remark.trim() } : {}),
  })
}

function close(): void {
  emit('update:modelValue', false)
}
</script>

<template>
  <AppDrawer
    :model-value="modelValue"
    :title="isEdit ? '编辑代课记录' : '记录代课'"
    :width="440"
    @update:model-value="close"
  >
    <form id="substitute-form" class="substitute-form" @submit.prevent="submit">
      <div class="form-grid">
        <AppField label="日期" required :error="errors.date">
          <AppInput v-model="form.date" type="date" :error="!!errors.date" />
        </AppField>

        <AppField label="节次" required :error="errors.period">
          <AppSelect
            :model-value="form.periodId || undefined"
            :options="periodOptions"
            :error="!!errors.period"
            placeholder="选择节次"
            @update:model-value="form.periodId = $event as CoursePeriodId"
          />
        </AppField>
      </div>

      <div>
        <AppField
          label="被代课教师"
          required
          :error="errors.originalTeacher"
          hint="这节课原本是谁的"
        >
          <AppInput
            v-model="form.originalTeacher"
            :maxlength="SUBSTITUTE_TEXT_MAX.teacher"
            :error="!!errors.originalTeacher"
            placeholder="如 李老师"
          />
        </AppField>
        <SubstituteSuggestionChips
          :options="substituteStore.teacherOptions"
          :current="form.originalTeacher"
          @pick="form.originalTeacher = $event"
        />
      </div>

      <div>
        <AppField
          label="实际代课教师"
          required
          :error="errors.substituteTeacher"
          hint="实际去上课的人"
        >
          <AppInput
            v-model="form.substituteTeacher"
            :maxlength="SUBSTITUTE_TEXT_MAX.teacher"
            :error="!!errors.substituteTeacher"
            placeholder="如 王老师"
          />
        </AppField>
        <SubstituteSuggestionChips
          :options="substituteStore.teacherOptions"
          :current="form.substituteTeacher"
          @pick="form.substituteTeacher = $event"
        />
      </div>

      <div>
        <AppField label="科目" required :error="errors.subject">
          <AppInput
            v-model="form.subject"
            :maxlength="SUBSTITUTE_TEXT_MAX.subject"
            :error="!!errors.subject"
            placeholder="如 数学"
          />
        </AppField>
        <SubstituteSuggestionChips
          :options="substituteStore.subjectOptions"
          :current="form.subject"
          @pick="form.subject = $event"
        />
      </div>

      <AppField label="备注（可选）">
        <AppTextarea
          v-model="form.remark"
          :rows="3"
          :maxlength="SUBSTITUTE_TEXT_MAX.remark"
          placeholder="如 原教师病假"
        />
      </AppField>
    </form>

    <template #footer>
      <AppButton variant="ghost" @click="close">取消</AppButton>
      <AppButton type="submit" form="substitute-form">{{ isEdit ? '保存' : '记录' }}</AppButton>
    </template>
  </AppDrawer>
</template>

<style scoped>
.substitute-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

@media (max-width: 520px) {
  .form-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
