<script setup lang="ts">
import { computed, reactive, watch } from 'vue'

import { AppButton, AppDrawer, AppField, AppInput, AppSelect, AppSwitch } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useTimetableStore } from '@/stores/timetable'
import { LESSON_PERIODS, WEEKDAYS, WEEKDAY_LABELS, classIdOf } from '@/utils/timetable'
import type { Lesson, LessonInput, Weekday } from '@/types/timetable'
import type { SelectOption } from '@/types'

interface Props {
  modelValue: boolean
  /** 传入则为编辑模式，否则为新增 */
  lesson?: Lesson
  /** 新增时的默认星期 / 节次（点周视图空格子进来时带上） */
  defaultWeekday: Weekday
  defaultPeriod: number
}

const props = withDefaults(defineProps<Props>(), {
  lesson: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  submit: [payload: LessonInput]
  /** 请求删除当前课程（由页面弹二次确认后落库） */
  remove: []
}>()

const toast = useToast()
const timetableStore = useTimetableStore()

/** 「其他（手动输入）」选项的哨兵值：与真实班级名不会撞（班级名不会以此开头） */
const CUSTOM_CLASS = '__custom__'

const WEEKDAY_OPTIONS: SelectOption<Weekday>[] = WEEKDAYS.map((weekday) => ({
  label: WEEKDAY_LABELS[weekday],
  value: weekday,
}))

const PERIOD_OPTIONS: SelectOption<number>[] = LESSON_PERIODS.map((period) => ({
  label: `第 ${period} 节`,
  value: period,
}))

const classOptions = computed<SelectOption<string>[]>(() => [
  ...timetableStore.classNames.map((name) => ({ label: name, value: name })),
  { label: '其他（手动输入）', value: CUSTOM_CLASS },
])

/** 已录入过的科目（提示用，不限制输入） */
const subjectHint = computed(() => {
  const used = [...new Set(timetableStore.lessons.map((lesson) => lesson.subject))]
  return used.length > 0 ? `已录入：${used.join(' / ')}` : '如 数学 / 语文 / 班会'
})

const isEdit = computed(() => Boolean(props.lesson))

interface FormState {
  weekday: Weekday
  period: number
  subject: string
  /** 选中的班级名，或 CUSTOM_CLASS */
  classChoice: string
  customClassName: string
  teacher: string
  location: string
  isTemporary: boolean
}

function blankForm(): FormState {
  return {
    weekday: props.defaultWeekday,
    period: props.defaultPeriod,
    subject: '',
    classChoice: timetableStore.classNames[0] ?? CUSTOM_CLASS,
    customClassName: '',
    teacher: '我',
    location: '',
    isTemporary: false,
  }
}

const form = reactive<FormState>(blankForm())
const errors = reactive({ subject: '', className: '', teacher: '', period: '' })

/** 实际使用的班级名 */
const className = computed(() =>
  form.classChoice === CUSTOM_CLASS ? form.customClassName.trim() : form.classChoice,
)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    Object.assign(form, blankForm())
    errors.subject = ''
    errors.className = ''
    errors.teacher = ''
    errors.period = ''
    const lesson = props.lesson
    if (!lesson) return
    Object.assign(form, {
      weekday: lesson.weekday,
      period: lesson.period,
      subject: lesson.subject,
      // 班级名不在已有候选里时按「手动输入」回填，不静默改写成别的班
      classChoice: timetableStore.classNames.includes(lesson.className)
        ? lesson.className
        : CUSTOM_CLASS,
      customClassName: timetableStore.classNames.includes(lesson.className) ? '' : lesson.className,
      teacher: lesson.teacher,
      location: lesson.location ?? '',
      isTemporary: lesson.isTemporary === true,
    })
  },
)

// 改了时间就清掉上一次的冲突提示，避免旧报错一直挂着
watch(
  () => [form.weekday, form.period],
  () => {
    errors.period = ''
  },
)

function validate(): boolean {
  errors.subject = form.subject.trim() ? '' : '科目不能为空'
  errors.className = className.value ? '' : '请选择或手动输入班级'
  errors.teacher = form.teacher.trim() ? '' : '任课教师不能为空'

  const conflict = timetableStore.slotConflict(form.weekday, form.period, props.lesson?.id)
  errors.period = conflict ? `该时间已有课程：${conflict.subject}（${conflict.className}）` : ''

  return !errors.subject && !errors.className && !errors.teacher && !errors.period
}

/**
 * 提交：这里**不关抽屉**——关不关由页面按写入结果决定。
 * 写入被拒（时段冲突以外的原因，如另一标签页已删掉该课程）时抽屉保持打开，
 * 教师填的内容还在，改一改就能重试。
 */
function submit() {
  if (!validate()) {
    // 手机上抽屉内容会滚动，出错字段可能不在视口内，光靠字段内联提示等于没反馈
    toast.danger(errors.period || errors.subject || errors.className || errors.teacher)
    return
  }
  const name = className.value
  const payload: LessonInput = {
    weekday: form.weekday,
    period: form.period,
    subject: form.subject.trim(),
    classId: classIdOf(name),
    className: name,
    teacher: form.teacher.trim(),
    location: form.location.trim() || undefined,
    isTemporary: form.isTemporary,
  }
  emit('submit', payload)
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
    <!-- 表单仅作语义分组：保存 / 取消在抽屉 footer（表单外的兄弟节点），回车保存未接线，
         保留 prevent 只为兜住浏览器可能的隐式提交（否则整页刷新，未保存内容全丢） -->
    <form class="lesson-form" @submit.prevent>
      <div class="form-grid">
        <AppField label="星期" required>
          <AppSelect v-model="form.weekday" :options="WEEKDAY_OPTIONS" />
        </AppField>

        <AppField label="节次" required :error="errors.period">
          <AppSelect v-model="form.period" :options="PERIOD_OPTIONS" :error="!!errors.period" />
        </AppField>
      </div>

      <AppField label="科目" required :error="errors.subject" :hint="subjectHint">
        <AppInput v-model="form.subject" :error="!!errors.subject" placeholder="如 数学" />
      </AppField>

      <AppField
        label="班级"
        required
        :error="errors.className"
        :hint="
          form.classChoice === CUSTOM_CLASS
            ? '输入新班级名后，会与同名班级视为同一个班'
            : '从已录入的班级中选择'
        "
      >
        <AppSelect v-model="form.classChoice" :options="classOptions" :error="!!errors.className" />
        <AppInput
          v-if="form.classChoice === CUSTOM_CLASS"
          v-model="form.customClassName"
          class="class-custom"
          :error="!!errors.className"
          placeholder="如 高一9班"
        />
      </AppField>

      <AppField
        label="任课教师"
        required
        :error="errors.teacher"
        hint="本人课表填「我」；代课填实际授课教师"
      >
        <AppInput v-model="form.teacher" :error="!!errors.teacher" placeholder="如 我 / 王老师" />
      </AppField>

      <AppField label="地点">
        <AppInput v-model="form.location" placeholder="选填，如 A 栋 302" />
      </AppField>

      <div class="temp-field">
        <AppSwitch v-model="form.isTemporary" label="临时代课" />
        <p class="temp-hint">开启后该课程在课表上标记「代课」。</p>
      </div>
    </form>

    <template #footer>
      <AppButton v-if="isEdit" variant="ghost" class="footer-remove" @click="emit('remove')">
        删除
      </AppButton>
      <AppButton variant="ghost" @click="close">取消</AppButton>
      <AppButton @click="submit">保存</AppButton>
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
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}

.class-custom {
  margin-top: var(--space-2);
}

.temp-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.temp-hint {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

/* 删除放最左，与「取消 / 保存」拉开距离，避免误点 */
.footer-remove {
  margin-right: auto;
}

@media (max-width: 420px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
