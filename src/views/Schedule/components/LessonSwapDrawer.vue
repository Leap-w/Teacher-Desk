<script setup lang="ts">
import { computed, reactive, watch } from 'vue'

import { AppButton, AppDrawer, AppField, AppInput, AppSelect } from '@/components/ui'
import { EVENING_PERIOD_IDS } from '@/types/timetable'
import type { CoursePeriodId, Lesson, Weekday } from '@/types/timetable'
import {
  WEEKDAY_LABELS,
  WEEKDAY_SHORT_LABELS,
  WEEKDAYS,
  isEveningPeriod,
  periodFullTextOf,
  periodLabelOf,
} from '@/utils/timetable'
import ExchangeWeekPicker from './ExchangeWeekPicker.vue'
import type { SelectOption } from '@/types'

/**
 * 换课抽屉（V1.1.3；**v3.7.5 起按教学周次生效**）：把课程从原时段搬到目标时段。
 * 与编辑抽屉的区别在于「换课要留下痕迹」——不在这里改科目 / 班级，单独提供字段。
 *
 * v3.7.5 的两处变化：
 * - **必须先选生效周次**（周次表来自学期设置）：换课只在这些周生效，**基础课表不动**；
 * - 整组晚自习照样支持（勾上后三节一起搬，**只能搬到「晚自习1」**，因为三节必须连续）。
 */
interface Props {
  modelValue: boolean
  lesson?: Lesson
  /** 学期总周数（可选周次上限，来自学期设置） */
  maxWeek: number
  /** 今天的教学周次（默认选中它；不在学期范围内时不传） */
  currentWeek?: number
}

const props = withDefaults(defineProps<Props>(), {
  lesson: undefined,
  currentWeek: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: [
    payload: {
      toWeekday: Weekday
      toPeriodId: CoursePeriodId
      toClassName: string
      toSubject: string
      withEveningGroup: boolean
      /** 生效的教学周次（1 起，至少一个） */
      weeks: number[]
    },
  ]
}>()

/** 可调往的星期：直接吃 `WEEKDAYS`（曾在这里手写一遍 1~7，改口径时要改两处） */
const WEEKDAY_OPTIONS: SelectOption<Weekday>[] = WEEKDAYS.map((weekday) => ({
  label: WEEKDAY_LABELS[weekday],
  value: weekday,
}))

interface FormState {
  toWeekday: Weekday
  toPeriodId: CoursePeriodId
  toSubject: string
  toClassName: string
  withEveningGroup: boolean
  weeks: number[]
}

const form = reactive<FormState>({
  toWeekday: 1,
  toPeriodId: 'morning',
  toSubject: '',
  toClassName: '',
  withEveningGroup: false,
  weeks: [],
})

/** 是否允许「整组晚自习一起调」：原课属于完整三节组 */
const canMoveAsGroup = computed(() =>
  props.lesson ? isEveningPeriod(props.lesson.periodId) : false,
)

/** 整组时只允许搬到「晚自习1」（三节需连续排列） */
const periodOptions = computed<SelectOption<CoursePeriodId>[]>(() => {
  if (form.withEveningGroup) {
    return [{ label: periodFullTextOf(EVENING_PERIOD_IDS[0]!), value: EVENING_PERIOD_IDS[0]! }]
  }
  return [
    { label: periodFullTextOf('morning'), value: 'morning' },
    { label: periodFullTextOf('p2'), value: 'p2' },
    { label: periodFullTextOf('p3'), value: 'p3' },
    { label: periodFullTextOf('p4'), value: 'p4' },
    { label: periodFullTextOf('p5'), value: 'p5' },
    { label: periodFullTextOf('p6'), value: 'p6' },
    { label: periodFullTextOf('p7'), value: 'p7' },
    { label: periodFullTextOf('evening1'), value: 'evening1' },
    { label: periodFullTextOf('evening2'), value: 'evening2' },
    { label: periodFullTextOf('evening3'), value: 'evening3' },
  ]
})

watch(
  () => props.modelValue,
  (open) => {
    if (!open || !props.lesson) return
    form.toWeekday = props.lesson.weekday
    form.toPeriodId = props.lesson.periodId
    form.toSubject = props.lesson.subject
    form.toClassName = props.lesson.className
    form.withEveningGroup = false
    // 默认落在**今天的教学周**（最常见的场景是「这周的课调一下」）；
    // 今天不在学期范围内时退回第 1 周，教师仍可自行多选
    form.weeks = [props.currentWeek ?? 1]
  },
  { immediate: true },
)

/** 整组勾上时强制把时段锁到「晚自习1」（否则三节没法连成一条线） */
watch(
  () => form.withEveningGroup,
  (group) => {
    if (group) form.toPeriodId = EVENING_PERIOD_IDS[0]!
  },
)

function close(): void {
  emit('update:modelValue', false)
}

function submit(): void {
  if (!props.lesson) return
  if (!form.toSubject.trim() || !form.toClassName.trim()) return
  // 生效周次至少一个：一个都没选时这条换课「哪一周都不生效」，没有意义，不放行
  if (form.weeks.length === 0) return
  emit('confirm', {
    toWeekday: form.toWeekday,
    toPeriodId: form.toPeriodId,
    toClassName: form.toClassName.trim(),
    toSubject: form.toSubject.trim(),
    withEveningGroup: form.withEveningGroup,
    weeks: [...form.weeks],
  })
}
</script>

<template>
  <AppDrawer :model-value="modelValue" title="调整课程" :width="440" @update:model-value="close">
    <form v-if="lesson" id="swap-form" class="swap-form" @submit.prevent="submit">
      <div class="from-card">
        <p class="from-label">原课程</p>
        <p class="from-content">
          <strong
            >{{ WEEKDAY_SHORT_LABELS[lesson.weekday] }} ·
            {{ periodLabelOf(lesson.periodId) }}</strong
          >
          <br />
          {{ lesson.subject }}（{{ lesson.className }}）
        </p>
      </div>

      <p class="arrow" aria-hidden="true">↓</p>

      <div class="to-section">
        <p class="section-label">调整至</p>

        <div class="form-grid">
          <AppField label="星期" required>
            <AppSelect v-model="form.toWeekday" :options="WEEKDAY_OPTIONS" />
          </AppField>

          <AppField label="时段" required>
            <AppSelect v-model="form.toPeriodId" :options="periodOptions" />
          </AppField>
        </div>

        <AppField label="科目" required>
          <AppInput v-model="form.toSubject" placeholder="如 数学" />
        </AppField>

        <AppField label="班级" required>
          <AppInput v-model="form.toClassName" placeholder="如 高一9班" />
        </AppField>

        <label v-if="canMoveAsGroup" class="group-toggle">
          <input v-model="form.withEveningGroup" type="checkbox" />
          <span>
            <strong>整组晚自习一起调</strong>
            <span class="group-hint">把同组的另外两节也搬到目标时间的三个连续晚自习</span>
          </span>
        </label>
      </div>

      <!-- v3.7.5：生效周次（周次表来自学期设置，可单选 / 多选 / 全选 / 快速范围） -->
      <AppField label="生效周次" required hint="只在这些教学周生效；未选中的周仍按基础课程表上">
        <ExchangeWeekPicker
          :model-value="form.weeks"
          :max-week="maxWeek"
          :current-week="currentWeek"
          @update:model-value="form.weeks = $event"
        />
      </AppField>

      <p class="tip">
        调整后只在选中的周次生效，<strong>基础课程表不会改动</strong>：原时间在这些周显示「调课」
        标记，撤销换课可在课程详情页一键还原。
      </p>
    </form>

    <template #footer>
      <AppButton variant="ghost" @click="close">取消</AppButton>
      <AppButton type="submit" form="swap-form">确认调整</AppButton>
    </template>
  </AppDrawer>
</template>

<style scoped>
.swap-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.from-card {
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-fill-disabled);
}

.from-label {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-text-faint);
  margin-bottom: var(--space-1);
}

.from-content {
  font-size: var(--text-md);
  color: var(--color-text);
  line-height: 1.6;
}

.arrow {
  text-align: center;
  font-size: var(--text-lg);
  color: var(--color-text-faint);
  margin: 0;
}

.to-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.section-label {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-text-faint);
  margin: 0 0 calc(var(--space-2) * -1);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

.group-toggle {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: border-color var(--transition-fast);
}

.group-toggle:hover {
  border-color: var(--color-border-emphasis);
}

.group-toggle input {
  margin-top: 4px;
}

.group-toggle span {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: var(--text-sm);
}

.group-hint {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.tip {
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-warning-soft);
  font-size: var(--text-xs);
  line-height: 1.7;
  color: var(--color-text-secondary);
}
</style>
