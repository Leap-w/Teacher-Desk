<script setup lang="ts">
import { computed, reactive, watch } from 'vue'

import { AppButton, AppDrawer, AppField, AppInput, AppSelect } from '@/components/ui'
import { useTimetableStore } from '@/stores/timetable'
import { COURSE_PERIODS } from '@/types/timetable'
import type { CoursePeriodId, Lesson, LessonInput, LessonType, Weekday } from '@/types/timetable'
import { WEEKDAYS, WEEKDAY_LABELS, classIdOf, periodFullTextOf } from '@/utils/timetable'
import type { SelectOption } from '@/types'

/**
 * 新增 / 编辑课程抽屉（V1.1.3：时段改为 10 个固定时间段；类型区分正常 / 代课）。
 * `presetType` 服务「详情 → 代课」这条快捷路径：打开时直接选中「代课」。
 * **没有上课地点这一栏**（需求明确：课程表不增加地点字段）。
 */

interface Props {
  modelValue: boolean
  /** 传入则为编辑模式，否则为新增 */
  lesson?: Lesson
  /** 新增时的默认星期 / 时段（点周视图空格子进来时带上） */
  defaultWeekday: Weekday
  defaultPeriodId: CoursePeriodId
  /** 新增时的预置类型（详情页的「代课」入口用） */
  presetType?: LessonType
}

const props = withDefaults(defineProps<Props>(), {
  lesson: undefined,
  presetType: 'normal',
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  submit: [payload: LessonInput]
  /** 请求删除当前课程（由页面弹二次确认后落库） */
  remove: []
}>()

const timetableStore = useTimetableStore()

/** 「其他（手动输入）」选项的哨兵值：与真实班级名不会撞（班级名不会以此开头） */
const CUSTOM_CLASS = '__custom__'

const WEEKDAY_OPTIONS: SelectOption<Weekday>[] = WEEKDAYS.map((weekday) => ({
  label: WEEKDAY_LABELS[weekday],
  value: weekday,
}))

/** 时段选项带上起止时间——教师按时间找课比按序号快（时间定义来自唯一配置） */
const PERIOD_OPTIONS: SelectOption<CoursePeriodId>[] = COURSE_PERIODS.map((period) => ({
  label: `${period.label}（${period.startTime}–${period.endTime}）`,
  value: period.id,
}))

const TYPE_OPTIONS: SelectOption<LessonType>[] = [
  { label: '正常课程', value: 'normal' },
  { label: '代课（替别人上）', value: 'substitute' },
]

const classOptions = computed<SelectOption<string>[]>(() => [
  ...timetableStore.classNames.map((name) => ({ label: name, value: name })),
  { label: '其他（手动输入）', value: CUSTOM_CLASS },
])

interface FormState {
  weekday: Weekday
  periodId: CoursePeriodId
  subject: string
  classChoice: string
  customClassName: string
  type: LessonType
  originalTeacher: string
}

const form = reactive<FormState>({
  weekday: props.defaultWeekday,
  periodId: props.defaultPeriodId,
  subject: '',
  classChoice: '',
  customClassName: '',
  type: 'normal',
  originalTeacher: '',
})

const errors = reactive({
  subject: '',
  className: '',
  period: '',
  originalTeacher: '',
})

const isEdit = computed(() => Boolean(props.lesson))
const isCustomClass = computed(() => form.classChoice === CUSTOM_CLASS)

/** 最终班级名（自定义时取输入框内容） */
const className = computed(() =>
  isCustomClass.value ? form.customClassName.trim() : form.classChoice.trim(),
)

/** 时段冲突提示（编辑时排除自身） */
const conflict = computed(() =>
  timetableStore.slotConflict(form.weekday, form.periodId, props.lesson?.id),
)

const subjectHint = '如「数学」「班会」「数学（代课）」——科目是自由文本'

/** 抽屉每次打开时按传入内容重置（编辑回填 / 新增用默认值） */
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    const lesson = props.lesson
    if (lesson) {
      form.weekday = lesson.weekday
      form.periodId = lesson.periodId
      form.subject = lesson.subject
      form.classChoice = timetableStore.classNames.includes(lesson.className)
        ? lesson.className
        : CUSTOM_CLASS
      form.customClassName = lesson.className
      form.type = lesson.type === 'adjusted' ? 'normal' : lesson.type
      form.originalTeacher = lesson.originalTeacher ?? ''
    } else {
      form.weekday = props.defaultWeekday
      form.periodId = props.defaultPeriodId
      form.subject = ''
      form.classChoice = timetableStore.classNames[0] ?? CUSTOM_CLASS
      form.customClassName = ''
      form.type = props.presetType
      form.originalTeacher = ''
    }
    errors.subject = ''
    errors.className = ''
    errors.period = ''
    errors.originalTeacher = ''
  },
  { immediate: true },
)

watch(
  () => [form.weekday, form.periodId],
  () => {
    if (errors.period && !conflict.value) errors.period = ''
  },
)

function validate(): boolean {
  errors.subject = form.subject.trim() ? '' : '请填写科目'
  errors.className = className.value ? '' : '请填写班级'
  errors.originalTeacher =
    form.type === 'substitute' && !form.originalTeacher.trim() ? '代课必须填写原授课教师' : ''
  errors.period = conflict.value
    ? `该时间已有课程：${conflict.value.subject}（${conflict.value.className}）`
    : ''
  return !errors.subject && !errors.className && !errors.period && !errors.originalTeacher
}

function submit(): void {
  if (!validate()) return
  const name = className.value
  emit('submit', {
    weekday: form.weekday,
    periodId: form.periodId,
    subject: form.subject.trim(),
    classId: classIdOf(name),
    className: name,
    teacher: props.lesson?.teacher ?? '我',
    type: form.type,
    originalTeacher: form.type === 'substitute' ? form.originalTeacher.trim() : undefined,
    exchangeId: props.lesson?.exchangeId,
    courseGroupId: props.lesson?.courseGroupId,
  })
}

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <AppDrawer
    :model-value="modelValue"
    :title="isEdit ? '编辑课程' : '新增课程'"
    :width="440"
    @update:model-value="close"
  >
    <form id="lesson-edit-form" class="lesson-form" @submit.prevent="submit">
      <div class="form-grid">
        <AppField label="星期" required>
          <AppSelect v-model="form.weekday" :options="WEEKDAY_OPTIONS" />
        </AppField>

        <AppField label="时段" required :error="errors.period">
          <AppSelect v-model="form.periodId" :options="PERIOD_OPTIONS" :error="!!errors.period" />
        </AppField>
      </div>

      <p class="period-hint">当前选择：{{ periodFullTextOf(form.periodId) }}</p>

      <AppField label="科目" required :error="errors.subject" :hint="subjectHint">
        <AppInput v-model="form.subject" :error="!!errors.subject" placeholder="如 数学" />
      </AppField>

      <AppField
        label="班级"
        required
        :error="errors.className"
        :hint="isCustomClass ? '输入新班级名后，会与同名班级视为同一个班' : '从已录入的班级中选择'"
      >
        <AppSelect v-model="form.classChoice" :options="classOptions" :error="!!errors.className" />
        <AppInput
          v-if="isCustomClass"
          v-model="form.customClassName"
          class="class-custom"
          :error="!!errors.className"
          placeholder="如 高一9班"
        />
      </AppField>

      <AppField label="类型" hint="代课要记下原授课教师，课表上会显示「代课」标记">
        <AppSelect v-model="form.type" :options="TYPE_OPTIONS" />
      </AppField>

      <AppField
        v-if="form.type === 'substitute'"
        label="原授课教师"
        required
        :error="errors.originalTeacher"
      >
        <AppInput
          v-model="form.originalTeacher"
          :error="!!errors.originalTeacher"
          placeholder="如 张老师"
        />
      </AppField>
    </form>

    <template #footer>
      <AppButton v-if="isEdit" variant="ghost" @click="emit('remove')">删除</AppButton>
      <AppButton variant="ghost" @click="close">取消</AppButton>
      <AppButton type="submit" form="lesson-edit-form">{{ isEdit ? '保存' : '新增' }}</AppButton>
    </template>
  </AppDrawer>
</template>

<style scoped>
.lesson-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

.period-hint {
  margin-top: calc(var(--space-2) * -1);
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}

.class-custom {
  margin-top: var(--space-2);
}
</style>
