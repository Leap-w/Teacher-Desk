<script setup lang="ts">
import { computed, reactive, watch } from 'vue'

import { AppButton, AppDrawer, AppField, AppInput, AppSelect, AppTextarea } from '@/components/ui'
import { useWorkStore } from '@/stores/work'
import { WORK_CATEGORIES, WORK_PRIORITY_LABELS, WORK_STATUS_LABELS } from '@/types/work'
import type { WorkCategory, WorkItem, WorkInput, WorkPriority, WorkStatus } from '@/types/work'
import { isValidClockTime, isValidIsoDate, isoDateOf } from '@/utils/work'
import type { SelectOption } from '@/types'

/**
 * 工作清单编辑抽屉（V1.1.3）：新增 / 编辑 共用。
 * `date` 默认今天；`status` 默认 todo；导入的都是 todo（统一在落库处写死，§services/workImport）。
 */
interface Props {
  modelValue: boolean
  work?: WorkItem
  /** 新增时默认的日期（通常是今天；弹窗本身允许改） */
  defaultDate?: string
}

const props = withDefaults(defineProps<Props>(), {
  work: undefined,
  defaultDate: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  submit: [payload: WorkInput]
}>()

const workStore = useWorkStore()

const PRIORITY_OPTIONS: SelectOption<WorkPriority>[] = (
  ['normal', 'important', 'urgent'] as const
).map((value) => ({ label: WORK_PRIORITY_LABELS[value], value }))

const CATEGORY_OPTIONS: SelectOption<WorkCategory>[] = WORK_CATEGORIES.map((value) => ({
  label: value,
  value,
}))

const STATUS_OPTIONS: SelectOption<WorkStatus>[] = (['todo', 'in-progress', 'done'] as const).map(
  (value) => ({ label: WORK_STATUS_LABELS[value], value }),
)

interface FormState {
  title: string
  date: string
  deadline: string
  priority: WorkPriority
  category: WorkCategory
  status: WorkStatus
  description: string
}

const form = reactive<FormState>({
  title: '',
  date: isoDateOf(),
  deadline: '',
  priority: 'normal',
  category: '其他',
  status: 'todo',
  description: '',
})

const errors = reactive({
  title: '',
  date: '',
  deadline: '',
})

const isEdit = computed(() => Boolean(props.work))

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    const work = props.work
    if (work) {
      form.title = work.title
      form.date = work.date
      form.deadline = work.deadline ?? ''
      form.priority = work.priority
      form.category = work.category
      form.status = work.status
      form.description = work.description ?? ''
    } else {
      form.title = ''
      form.date = props.defaultDate ?? workStore.today
      form.deadline = ''
      form.priority = 'normal'
      form.category = '其他'
      form.status = 'todo'
      form.description = ''
    }
    errors.title = ''
    errors.date = ''
    errors.deadline = ''
  },
  { immediate: true },
)

function validate(): boolean {
  errors.title = form.title.trim() ? '' : '请填写工作名称'
  errors.date = isValidIsoDate(form.date) ? '' : '请填写合法日期（YYYY-MM-DD）'
  errors.deadline =
    form.deadline && !isValidClockTime(form.deadline) ? '截止时间格式不正确（HH:mm）' : ''
  return !errors.title && !errors.date && !errors.deadline
}

function submit(): void {
  if (!validate()) return
  emit('submit', {
    title: form.title.trim(),
    date: form.date,
    deadline: form.deadline.trim() || undefined,
    priority: form.priority,
    category: form.category,
    status: form.status,
    description: form.description.trim() || undefined,
  })
}

function close(): void {
  emit('update:modelValue', false)
}
</script>

<template>
  <AppDrawer
    :model-value="modelValue"
    :title="isEdit ? '编辑工作' : '新建工作'"
    :width="440"
    @update:model-value="close"
  >
    <form id="work-form" class="work-form" @submit.prevent="submit">
      <AppField label="工作名称" required :error="errors.title">
        <AppInput v-model="form.title" :error="!!errors.title" placeholder="如 收齐学生请假条" />
      </AppField>

      <div class="form-grid">
        <AppField label="日期" required :error="errors.date" hint="YYYY-MM-DD">
          <AppInput v-model="form.date" :error="!!errors.date" />
        </AppField>

        <AppField label="截止时间" :error="errors.deadline" hint="HH:mm，可留空">
          <AppInput v-model="form.deadline" :error="!!errors.deadline" placeholder="18:00" />
        </AppField>
      </div>

      <div class="form-grid">
        <AppField label="优先级">
          <AppSelect v-model="form.priority" :options="PRIORITY_OPTIONS" />
        </AppField>

        <AppField label="分类">
          <AppSelect v-model="form.category" :options="CATEGORY_OPTIONS" />
        </AppField>
      </div>

      <AppField v-if="isEdit" label="状态">
        <AppSelect v-model="form.status" :options="STATUS_OPTIONS" />
      </AppField>

      <AppField label="备注（可选）">
        <AppTextarea v-model="form.description" :rows="3" placeholder="补充说明…" />
      </AppField>
    </form>

    <template #footer>
      <AppButton variant="ghost" @click="close">取消</AppButton>
      <AppButton type="submit" form="work-form">{{ isEdit ? '保存' : '新建' }}</AppButton>
    </template>
  </AppDrawer>
</template>

<style scoped>
.work-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}
</style>
