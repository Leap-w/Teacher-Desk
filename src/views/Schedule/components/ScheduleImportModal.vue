<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { AppButton, AppModal } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { runLockedOperation } from '@/composables/useOperationLock'
import { useTimetableStore } from '@/stores/timetable'
import {
  COURSE_IMPORT_HEADERS,
  COURSE_IMPORT_HINT,
  COURSE_IMPORT_SAMPLE,
  parseCourseRows,
  planCourseImport,
} from '@/services/courseImport'
import { readSheetRows } from '@/services/studentImport'
import type { Lesson } from '@/types/timetable'

/**
 * 课程表 Excel 导入弹窗（V1.1.3）。
 * 与座位 / 学生导入同款两层切分：选文件 → 读取 → 解析 → 校验 → 预览 → 确认 → 一次性写入；
 * 有错禁止确认，取消不写。
 *
 * 落库语义（与座位导入同款纪律）：**逐条应用**——导入涉及的「星期 + 时段」被替换成表里的安排，
 * 未涉及的时段保持原样；不整表覆盖，避免一份不完整的表把整周课表清空。
 */
interface Props {
  modelValue: boolean
  existingLessons: readonly Lesson[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  applied: [outcome: { added: number; replaced: number }]
}>()

const toast = useToast()
const timetableStore = useTimetableStore()

const fileInput = ref<HTMLInputElement>()
const parsing = ref(false)
const parseError = ref('')
const plan = ref<ReturnType<typeof planCourseImport> | null>(null)
const selectedFile = ref<File | null>(null)

const canConfirm = computed(
  () => plan.value !== null && plan.value.errorCount === 0 && plan.value.importable > 0,
)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) {
      plan.value = null
      parseError.value = ''
      selectedFile.value = null
      if (fileInput.value) fileInput.value.value = ''
    }
  },
)

async function onFileChange(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  selectedFile.value = file
  parsing.value = true
  parseError.value = ''
  plan.value = null

  try {
    const buffer = await file.arrayBuffer()
    const sheet = await readSheetRows(buffer)
    if (!sheet.ok) {
      parseError.value = sheet.error
      return
    }
    const result = parseCourseRows(sheet.rows)
    if (!result.ok) {
      parseError.value = result.error
      return
    }
    plan.value = planCourseImport(result.rows, props.existingLessons)
  } catch (error) {
    parseError.value = error instanceof Error ? error.message : '文件读取失败'
  } finally {
    parsing.value = false
  }
}

async function onConfirm(): Promise<void> {
  if (!plan.value || !canConfirm.value) return
  // RC-01 / RC-02：导入期间暂停同步，写完这张课表后自动补推一次
  const outcome = await runLockedOperation('schedule-import', () =>
    timetableStore.applyCourseImport(plan.value!.plan.lessons),
  )
  if (!outcome.ok) {
    toast.danger(outcome.reason)
    return
  }
  emit('applied', { added: outcome.added, replaced: outcome.replaced })
}

function onCancel(): void {
  emit('update:modelValue', false)
}

function downloadTemplate(): void {
  const csv = [
    COURSE_IMPORT_HEADERS.join(','),
    ...COURSE_IMPORT_SAMPLE.map((row) =>
      row.map((cell) => (cell.includes(',') ? `"${cell}"` : cell)).join(','),
    ),
  ].join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = '课程表导入模板.csv'
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <AppModal
    :model-value="modelValue"
    title="从 Excel 导入课程"
    :width="720"
    @update:model-value="onCancel"
  >
    <div class="import-body">
      <header class="hint">
        <p class="hint-text">{{ COURSE_IMPORT_HINT }}</p>
        <button type="button" class="download-link" @click="downloadTemplate">
          下载模板（CSV）
        </button>
      </header>

      <div class="file-row">
        <input
          ref="fileInput"
          type="file"
          accept=".xlsx,.csv,.xls"
          class="file-input"
          @change="onFileChange"
        />
        <p v-if="selectedFile" class="file-name">已选择：{{ selectedFile.name }}</p>
      </div>

      <p v-if="parsing" class="status-text">正在解析表格…</p>
      <p v-else-if="parseError" class="status-text is-error">{{ parseError }}</p>

      <section v-if="plan" class="summary">
        <h3 class="summary-title">导入预览</h3>
        <ul class="summary-list">
          <li>数据行：{{ plan.total }}</li>
          <li>
            可导入：<strong>{{ plan.importable }}</strong>
          </li>
          <li>新增：{{ plan.added }}</li>
          <li>覆盖：{{ plan.replaced }}</li>
          <li>代课：{{ plan.substituted }}</li>
          <li>晚自习归组：{{ plan.eveningGrouped }}</li>
          <li v-if="plan.duplicateSlots > 0" class="is-error">
            重复时段：{{ plan.duplicateSlots }}
          </li>
          <li v-if="plan.blocked > 0" class="is-error">被拦行数：{{ plan.blocked }}</li>
        </ul>

        <div v-if="plan.errorCount > 0" class="errors">
          <p class="errors-title">以下行无法导入：</p>
          <ul class="errors-list">
            <li
              v-for="row in plan.rows.filter((r) => r.action === 'blocked').slice(0, 5)"
              :key="row.rowNumber"
            >
              第 {{ row.rowNumber }} 行：{{ row.errors.join('；') }}
            </li>
          </ul>
          <p v-if="plan.rows.filter((r) => r.action === 'blocked').length > 5" class="errors-more">
            仅显示前 5 条，共 {{ plan.rows.filter((r) => r.action === 'blocked').length }} 条错误
          </p>
        </div>
      </section>
    </div>

    <template #footer>
      <AppButton variant="ghost" @click="onCancel">取消</AppButton>
      <AppButton :disabled="!canConfirm" @click="onConfirm">
        确认导入 {{ plan?.importable ?? 0 }} 节
      </AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.import-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-fill-disabled);
}

.hint-text {
  font-size: var(--text-xs);
  line-height: 1.7;
  color: var(--color-text-secondary);
}

.download-link {
  border: none;
  background: transparent;
  font: inherit;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-primary-strong);
  cursor: pointer;
}

.file-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.file-input {
  font-size: var(--text-sm);
}

.file-name {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.status-text {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.status-text.is-error {
  color: var(--color-danger-strong);
}

.summary {
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-fill-disabled);
}

.summary-title {
  font-size: var(--text-sm);
  font-weight: 600;
  margin-bottom: var(--space-2);
}

.summary-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  list-style: none;
  padding: 0;
  margin: 0;
}

.summary-list strong {
  color: var(--color-primary-strong);
  font-size: var(--text-sm);
}

.summary-list .is-error {
  color: var(--color-danger-strong);
}

.errors {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}

.errors-title {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-danger-strong);
  margin-bottom: var(--space-1);
}

.errors-list {
  list-style: none;
  padding: 0;
  margin: 0;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.errors-list li {
  padding: 2px 0;
}

.errors-more {
  margin-top: var(--space-1);
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
</style>
