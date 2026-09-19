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
import { useWorkStore } from '@/stores/work'
import {
  WORK_IMPORT_HEADERS,
  WORK_IMPORT_HINT,
  WORK_IMPORT_SAMPLE,
  parseWorkRows,
  planWorkImport,
} from '@/services/workImport'
import { WORK_PRIORITY_LABELS } from '@/types/work'
import type { WorkItem } from '@/types/work'

/**
 * 工作清单 Excel 导入弹窗（V1.1.3）：选择 → 读取 → 解析 → 校验 → 预览 → 确认 → 一次性写入；
 * **有错禁止确认、取消不写**。
 *
 * v3.5.0：样式与取文件的管道全部与座位导入共用；「已存在（跳过）」与「逾期」这类只提示不拦的行
 * 现在也**逐行**显示在预览表里，教师不用再猜是哪几行。
 *
 * 落库语义：**追加**，但**同日同名的工作会被跳过**（标为「已存在」）——
 * 教师把同一份月度清单导入两次不该得到两份任务。
 */
interface Props {
  modelValue: boolean
  existingWorks: readonly WorkItem[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  applied: [outcome: { added: number; skipped: number }]
}>()

const toast = useToast()
const workStore = useWorkStore()

const PREVIEW_COLUMNS: readonly ImportPreviewColumn[] = [
  { key: 'title', label: '工作名称', wrap: true },
  { key: 'date', label: '日期' },
  { key: 'deadline', label: '截止' },
  { key: 'priority', label: '优先级' },
  { key: 'category', label: '分类' },
]

const ACTIONS: Record<string, ImportActionMeta> = {
  create: { label: '新增', tone: 'ok' },
  skip: { label: '已存在', tone: 'warn' },
  blocked: { label: '已拦下', tone: 'bad' },
}

const fileInput = ref<HTMLInputElement>()
const plan = ref<ReturnType<typeof planWorkImport> | null>(null)

const sheet = useSheetImport({
  fileInput,
  noun: '工作清单',
  parse: (rows) => {
    const result = parseWorkRows(rows, workStore.today)
    if (!result.ok) return { ok: false, error: result.error }
    plan.value = planWorkImport(result.rows, props.existingWorks, workStore.today)
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
  () => plan.value !== null && plan.value.errorCount === 0 && plan.value.added > 0,
)

const statItems = computed<ImportStat[]>(() => {
  const current = plan.value
  if (!current) return []
  return [
    { value: current.total, label: '数据行' },
    { value: current.added, label: '可导入', tone: 'ok' },
    { value: current.skipped, label: '已存在跳过' },
    { value: current.overdue, label: '逾期' },
    { value: current.blocked, label: '被拦下', tone: current.blocked > 0 ? 'bad' : undefined },
  ]
})

const hints = computed<ImportHint[]>(() => {
  const current = plan.value
  if (!current) return []
  const list: ImportHint[] = []
  const blocked = blockedHint(current.rows)
  if (blocked) list.push(blocked)
  if (current.skipped > 0) {
    list.push({
      tone: 'info',
      text: `${current.skipped} 行的日期与名称和已有任务相同，本次跳过（不会重复创建，也不会覆盖已有任务）`,
    })
  }
  if (current.overdue > 0) {
    list.push({
      tone: 'info',
      text: `${current.overdue} 行日期早于今天——会照常导入，在清单里显示为逾期`,
    })
  }
  if (current.blankRows > 0) {
    list.push({ tone: 'info', text: `${current.blankRows} 行是空行，已自动跳过` })
  }
  list.push({ tone: 'info', text: '确认后追加到工作清单；表格没提到的任务保持原样' })
  return list
})

const previewRows = computed<ImportPreviewRow[]>(() =>
  (plan.value?.rows ?? []).map((row) => ({
    rowNumber: row.rowNumber,
    action: row.action,
    cells: {
      title: row.title,
      date: row.date,
      deadline: row.deadline,
      priority: WORK_PRIORITY_LABELS[row.priority] ?? row.priority,
      category: row.category,
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
  // RC-01 / RC-02：导入期间暂停同步，写完这批任务后自动补推一次
  const outcome = await runLockedOperation('work-import', () =>
    workStore.applyWorkImport(current.plan.works),
  )
  if (!outcome.ok) {
    toast.danger(outcome.reason)
    return
  }
  emit('applied', { added: outcome.added, skipped: outcome.skipped })
}

function close(): void {
  emit('update:modelValue', false)
}
</script>

<template>
  <AppModal
    :model-value="modelValue"
    title="从 Excel 导入工作"
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
        lead="选择一份 Excel 工作清单（.xlsx / .xls），第一行为表头。"
        filename="工作清单导入模板"
        sheet-name="工作清单"
        :headers="WORK_IMPORT_HEADERS"
        :sample="WORK_IMPORT_SAMPLE"
        note="上面的例子表示：9 月 14 日有两件事（18:00 前收齐请假条、22:00 前批改作业），9 月 15 日联系家长、没写截止时间。"
      >
        <li>{{ WORK_IMPORT_HINT }}</li>
        <li>同日同名的任务<strong>不会重复创建</strong>；「描述」列可以留空</li>
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
        确认导入 {{ plan.added }} 条
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
