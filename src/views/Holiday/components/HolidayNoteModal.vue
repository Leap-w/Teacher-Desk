<script setup lang="ts">
import { ref, watch } from 'vue'

import { AppButton, AppModal, AppTextarea } from '@/components/ui'
import { familyScopeLabel, formatStudentShortName } from '@/utils/student'
import HolidayStatusBadge from './HolidayStatusBadge.vue'
import type { HolidayStatus } from '@/types/holiday'
import type { Student } from '@/types'

/**
 * HolidayNoteModal — **学生级假期备注**的编辑（v3.6.2 规格第 15–20 节）。
 *
 * 这是本版新增的唯一一个编辑入口，刻意做成**一个学生 + 一个假期**的一小块备注：
 * 不是「整个假期的备注」（那是假期本身的 `Holiday.note`，在新建 / 编辑假期弹窗里），
 * 也不是独立页面——教师是在名单上顺手记一句「由姐姐接回」，不该为此离开名单。
 *
 * 三条要求直接体现在界面里：
 * - **与去向无关**：标题上带着这位学生当前的去向徽标，留校学生照样能写
 *   （「假期参加学校统一活动」是对留校最有用的一句备注）；
 * - **可以清空**：留空保存即删除备注，所以 hint 里写明这件事，不额外放一颗删除按钮；
 * - **自由文本**：不预设模板、不做业务解析，只是一个多行输入框。
 */
const props = defineProps<{
  modelValue: boolean
  /** 备注视窗里的学生；弹窗淡出期间仍要渲染，所以不用 `v-if` 清空它 */
  student?: Student
  status: HolidayStatus
  /** 当前的备注内容 */
  note: string
  /** 重名消歧表（弹窗上的名字必须与名单上逐字一致，见 `formatStudentShortName`） */
  nameCounts: ReadonlyMap<string, number>
  busy?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [note: string]
}>()

const draft = ref('')

watch(
  () => props.modelValue,
  (open) => {
    if (open) draft.value = props.note
  },
  { immediate: true },
)

function close(): void {
  emit('update:modelValue', false)
}

function submit(): void {
  emit('save', draft.value)
}
</script>

<template>
  <AppModal :model-value="modelValue" title="假期备注" :width="420" @update:model-value="close">
    <div v-if="student" class="note-head">
      <span class="note-name">{{ formatStudentShortName(student, nameCounts) }}</span>
      <HolidayStatusBadge :status="status" />
      <span v-if="familyScopeLabel(student.familyLocation)" class="note-scope">
        {{ familyScopeLabel(student.familyLocation) }}
      </span>
    </div>

    <AppTextarea
      v-model="draft"
      :rows="3"
      :maxlength="200"
      placeholder="如：由姐姐接回 / 家长到校接送 / 假期参加学校统一活动"
    />

    <p class="note-hint">
      备注属于这位学生在这个假期里的记录，与「离校 / 留校」无关；
      <strong>内容清空后保存即可删除备注。</strong>
    </p>

    <template #footer>
      <AppButton variant="ghost" @click="close">取消</AppButton>
      <AppButton :loading="busy" @click="submit">保存</AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.note-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.note-name {
  font-size: var(--text-md);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.note-scope {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.note-hint {
  margin-top: var(--space-2);
  font-size: var(--font-caption);
  line-height: 1.6;
  color: var(--color-text-faint);
}

.note-hint strong {
  color: var(--color-text-secondary);
  font-weight: var(--font-weight-medium);
}
</style>
