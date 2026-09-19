<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import {
  AppButton,
  AppModal,
  ImportFileCard,
  ImportFileRow,
  ImportHints,
  ImportIntro,
  ImportPreviewTable,
  ImportStats,
  blockedHint,
} from '@/components/ui'
import type {
  ImportActionMeta,
  ImportHint,
  ImportPreviewColumn,
  ImportPreviewRow,
  ImportStat,
} from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { runLockedOperation } from '@/composables/useOperationLock'
import { useSheetImport } from '@/composables/useSheetImport'
import { useTimetableStore } from '@/stores/timetable'
import {
  COURSE_IMPORT_HEADERS,
  COURSE_IMPORT_HINT,
  COURSE_IMPORT_SAMPLE,
  parseCourseRows,
  planCourseImport,
} from '@/services/courseImport'
import { LESSON_TYPE_LABELS, WEEKDAY_LABELS, periodLabelOf } from '@/utils/timetable'
import type { Lesson } from '@/types/timetable'

/**
 * 课程表 Excel 导入弹窗（V1.1.3）：选文件 → 读取 → 解析 → 校验 → 预览 → 确认 → 一次性写入；
 * 有错禁止确认，取消不写。
 *
 * v3.5.0：样式与取文件的管道全部与座位导入共用；「覆盖了原来哪节课」「是否归入晚自习组」
 * 这两个原本挤在摘要里的信息，现在写在对应那一行的「本次变化」列上，逐行可核。
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

const PREVIEW_COLUMNS: readonly ImportPreviewColumn[] = [
  { key: 'weekday', label: '星期' },
  { key: 'period', label: '节次' },
  { key: 'subject', label: '科目' },
  { key: 'type', label: '类型' },
  { key: 'teacher', label: '原教师' },
  { key: 'change', label: '本次变化', wrap: true },
]

const ACTIONS: Record<string, ImportActionMeta> = {
  create: { label: '新增', tone: 'ok' },
  replace: { label: '覆盖', tone: 'info' },
  blocked: { label: '已拦下', tone: 'bad' },
}

const fileInput = ref<HTMLInputElement>()
const plan = ref<ReturnType<typeof planCourseImport> | null>(null)

const sheet = useSheetImport({
  fileInput,
  noun: '课程表',
  parse: (rows) => {
    const result = parseCourseRows(rows)
    if (!result.ok) return { ok: false, error: result.error }
    plan.value = planCourseImport(result.rows, props.existingLessons)
    return { ok: true, columns: result.columns }
  },
  reset: () => {
    plan.value = null
  },
})

const {
  busy,
  filename,
  sheetNote,
  columns,
  pickFile,
  onFilePicked,
  readFile,
  error: parseError,
} = sheet

/** 整体性错误也走提示条：五个弹窗的「坏消息」长同一副样子 */
const errorHints = computed<ImportHint[]>(() =>
  parseError.value ? [{ tone: 'danger', text: parseError.value }] : [],
)

const canConfirm = computed(
  () => plan.value !== null && plan.value.errorCount === 0 && plan.value.importable > 0,
)

const statItems = computed<ImportStat[]>(() => {
  const current = plan.value
  if (!current) return []
  return [
    { value: current.total, label: '数据行' },
    { value: current.importable, label: '可导入', tone: 'ok' },
    { value: current.added, label: '新增' },
    { value: current.replaced, label: '覆盖' },
    { value: current.substituted, label: '代课' },
    {
      value: current.duplicateSlots,
      label: '重复时段',
      tone: current.duplicateSlots > 0 ? 'bad' : undefined,
    },
    { value: current.blocked, label: '被拦下', tone: current.blocked > 0 ? 'bad' : undefined },
  ]
})

const hints = computed<ImportHint[]>(() => {
  const current = plan.value
  if (!current) return []
  const list: ImportHint[] = []
  const blocked = blockedHint(current.rows)
  if (blocked) list.push(blocked)
  if (current.replaced > 0) {
    list.push({
      tone: 'info',
      text: `${current.replaced} 个时段原本已有课，导入后会换成表里的安排（被替换的科目见「本次变化」列）`,
    })
  }
  if (current.substituted > 0) {
    list.push({ tone: 'info', text: `${current.substituted} 节是代课，课表上会标注原教师` })
  }
  if (current.eveningGrouped > 0) {
    list.push({
      tone: 'info',
      text: `${current.eveningGrouped} 节晚自习会归入同一个晚自习组`,
    })
  }
  if (current.blankRows > 0) {
    list.push({ tone: 'info', text: `${current.blankRows} 行是空行，已自动跳过` })
  }
  list.push({ tone: 'info', text: '确认后只改表格里列出的「星期 + 时段」；没提到的时段保持原样' })
  return list
})

const previewRows = computed<ImportPreviewRow[]>(() =>
  (plan.value?.rows ?? []).map((row) => ({
    rowNumber: row.rowNumber,
    action: row.action,
    cells: {
      weekday: row.weekday ? WEEKDAY_LABELS[row.weekday] : '',
      period: row.periodId ? periodLabelOf(row.periodId) : '',
      subject: row.subject,
      type: row.type ? LESSON_TYPE_LABELS[row.type] : '',
      teacher: row.originalTeacher,
      // 被拦下的行没有「本次变化」可言（它根本不会写进去），留空显示「—」，
      // 免得教师以为「原时段无课」是要发生的事
      change:
        row.action === 'blocked'
          ? ''
          : [
              row.replacedSubject ? `覆盖原「${row.replacedSubject}」` : '原时段无课',
              row.eveningGroup ? '归入晚自习组' : '',
            ]
              .filter(Boolean)
              .join('，'),
    },
    errors: row.errors,
    warnings: row.warnings,
  })),
)

watch(
  () => props.modelValue,
  (open) => {
    if (open) return
    sheet.clear()
  },
)

async function onConfirm(): Promise<void> {
  const current = plan.value
  if (!current || !canConfirm.value) return
  // RC-01 / RC-02：导入期间暂停同步，写完这张课表后自动补推一次
  const outcome = await runLockedOperation('schedule-import', () =>
    timetableStore.applyCourseImport(current.plan.lessons),
  )
  if (!outcome.ok) {
    toast.danger(outcome.reason)
    return
  }
  emit('applied', { added: outcome.added, replaced: outcome.replaced })
}

function close(): void {
  emit('update:modelValue', false)
}
</script>

<template>
  <AppModal
    :model-value="modelValue"
    title="从 Excel 导入课程"
    :width="780"
    @update:model-value="close"
  >
    <input
      ref="fileInput"
      type="file"
      accept=".xlsx,.xls"
      class="file-input"
      tabindex="-1"
      aria-hidden="true"
      @change="onFilePicked"
    />

    <div v-if="!filename && !parseError" class="intro">
      <ImportFileCard class="intro-upload" :busy="busy" @pick="pickFile" @file="readFile" />
      <ImportIntro
        lead="选择一份 Excel 课程表（.xlsx / .xls），第一行为表头。"
        filename="课程表导入模板"
        sheet-name="课程表"
        :headers="COURSE_IMPORT_HEADERS"
        :sample="COURSE_IMPORT_SAMPLE"
        note="上面的例子表示：周一第 5 节数学正常上课；周二第 3 节是代课，原教师张老师；周三晚自习 1 上数学；周六第 2 节也照排。"
      >
        <li>{{ COURSE_IMPORT_HINT }}</li>
        <li>一天里同一时段写两遍会被拦下；「班级」列留空按本班处理</li>
      </ImportIntro>
    </div>

    <ImportHints v-if="parseError" :items="errorHints" />

    <template v-if="plan">
      <ImportFileRow
        :filename="filename"
        :sheet-note="sheetNote"
        :columns="columns"
        @reselect="pickFile"
      />

      <ImportStats :items="statItems" />
      <ImportHints :items="hints" />
      <ImportPreviewTable :columns="PREVIEW_COLUMNS" :rows="previewRows" :actions="ACTIONS" />
    </template>

    <template #footer>
      <AppButton variant="ghost" @click="close">取消</AppButton>
      <AppButton v-if="!plan" :disabled="busy" @click="pickFile">
        {{ busy ? '读取中…' : '选择 Excel 文件' }}
      </AppButton>
      <AppButton v-else :disabled="!canConfirm" @click="onConfirm">
        确认导入 {{ plan.importable }} 节
      </AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.file-input {
  display: none;
}

.intro-upload {
  margin-bottom: var(--space-4);
}
</style>
