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
import {
  parseSeatRows,
  planSeatImport,
  SEAT_IMPORT_HEADERS,
  SEAT_IMPORT_HINT,
  SEAT_IMPORT_SAMPLE,
} from '@/services/seatImport'
import type { ParsedSeatRow, SeatImportResult } from '@/services/seatImport'
import { useSeatStore } from '@/stores/seat'
import { useStudentStore } from '@/stores/student'

/**
 * Excel 座位导入弹窗（V1.1.2 Phase 1）。**五个导入弹窗的样式基准**——
 * 首屏说明区 / 上传卡 / 已选文件行 / 统计卡 / 提示条 / 逐行预览表全部走 `components/ui`
 * 的共享实现，取文件的管道走 `useSheetImport`，其余四个弹窗照着这一份对齐。
 *
 * 流程严格按需求：选择文件 → 读取 → 解析 → 校验 → 预览 → 用户确认 → 一次性写入。
 * **关闭弹窗 / 取消一律不写入**；**存在错误时确认按钮禁用**（错误数据绝不进当前方案）。
 * 落库只经 `seatStore.applySeatImport()`——组件不碰 `seats` 数组、不碰 localStorage。
 */

interface Props {
  modelValue: boolean
}

const props = withDefaults(defineProps<Props>(), {})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const seatStore = useSeatStore()
const studentStore = useStudentStore()
const toast = useToast()

const CHANGE_LABELS = { new: '新安排', move: '换座位', same: '原位不动' } as const

/** 预览表的列（「行」与「状态」两列由 ImportPreviewTable 固定提供） */
const PREVIEW_COLUMNS: readonly ImportPreviewColumn[] = [
  { key: 'seat', label: '座位' },
  { key: 'studentNo', label: '学号' },
  { key: 'name', label: '姓名' },
  { key: 'change', label: '变化' },
]

const ACTIONS: Record<string, ImportActionMeta> = {
  assign: { label: '可导入', tone: 'ok' },
  blocked: { label: '已拦下', tone: 'bad' },
}

const fileInput = ref<HTMLInputElement>()
const parsed = ref<ParsedSeatRow[] | undefined>(undefined)
/** 全空行条数（解析时统计，预览里说一句） */
const blankRows = ref(0)

const sheet = useSheetImport({
  fileInput,
  noun: '座位表',
  parse: (rows) => {
    const parsedRows = parseSeatRows(rows, seatStore.config)
    if (!parsedRows.ok) return { ok: false, error: parsedRows.error }
    parsed.value = parsedRows.rows
    blankRows.value = parsedRows.blankRows
    return { ok: true, columns: parsedRows.columns }
  },
  reset: () => {
    parsed.value = undefined
    blankRows.value = 0
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

/** 整体性错误也走提示条：五种弹窗的「坏消息」长同一副样子 */
const errorHints = computed<ImportHint[]>(() =>
  parseError.value ? [{ tone: 'danger', text: parseError.value }] : [],
)

/**
 * 预览是 **computed，不是选完文件算一次**：它依赖当前方案座位与学生表，
 * 教师在别处改了数据（跨标签页同步过来）时数字跟着重算——
 * 预览上看到的「可导入 N 个座位」必须与落库的那一次完全一致。
 */
const result = computed<SeatImportResult | undefined>(() =>
  parsed.value
    ? planSeatImport(
        parsed.value,
        studentStore.activeStudents,
        seatStore.currentSeats,
        blankRows.value,
      )
    : undefined,
)

const statItems = computed<ImportStat[]>(() => {
  const current = result.value
  if (!current) return []
  return [
    { value: current.total, label: '总行数' },
    { value: current.validSeats, label: '有效座位' },
    { value: current.assignable, label: '可导入', tone: 'ok' },
    { value: current.changed, label: '新安排' },
    {
      value: current.unknownStudents,
      label: '无法识别',
      tone: current.unknownStudents > 0 ? 'bad' : undefined,
    },
    {
      value: current.duplicateSeats,
      label: '重复座位',
      tone: current.duplicateSeats > 0 ? 'bad' : undefined,
    },
    {
      value: current.duplicateStudents,
      label: '重复学生',
      tone: current.duplicateStudents > 0 ? 'bad' : undefined,
    },
    { value: current.errorCount, label: '错误', tone: current.errorCount > 0 ? 'bad' : undefined },
  ]
})

const previewRows = computed<ImportPreviewRow[]>(() =>
  (result.value?.rows ?? []).map((row) => ({
    rowNumber: row.rowNumber,
    action: row.action,
    cells: {
      seat: row.seatLabel,
      studentNo: row.studentNo,
      name: row.name,
      change: row.change ? CHANGE_LABELS[row.change] : '',
    },
    errors: row.errors,
    warnings: row.warnings,
  })),
)

watch(
  () => props.modelValue,
  (open) => {
    // 关闭即清场：下次打开是一张干净的表，也不残留上次的预览结论
    if (open) return
    sheet.clear()
  },
)

/** 预览提示组：按教师「要做什么」分类，不按代码里的字段分 */
const hints = computed<ImportHint[]>(() => {
  const current = result.value
  if (!current) return []
  const list: ImportHint[] = []
  // 被拦下的行**直接点名**（行号 + 原因）——表宽时「状态」列在最右边，不必横滚去找
  const blocked = blockedHint(current.rows)
  if (blocked) list.push(blocked)
  if (current.changed > 0) {
    list.push({ tone: 'info', text: `${current.changed} 名学生的座位会发生变化` })
  }
  if (current.blankRows > 0) {
    list.push({ tone: 'info', text: `${current.blankRows} 行是空行，已自动跳过` })
  }
  list.push({
    tone: 'info',
    text: '确认后只应用表格里列出的座位；表格没提到的座位保持原样（不会被清空）',
  })
  return list
})

async function confirm(): Promise<void> {
  const current = result.value
  if (!current || current.blocked > 0 || current.assignable === 0) return
  const hadPending = seatStore.pendingLogsCount > 0
  // RC-01 / RC-02：导入期间暂停同步（不把写了一半的方案推上云），写完后自动补推一次
  const outcome = await runLockedOperation('seat-import', () =>
    seatStore.applySeatImport(current.plan.assignments),
  )
  if (!outcome.ok) {
    toast.danger(`导入失败：${outcome.reason ?? '数据已变化，请刷新后重试'}`)
    return
  }
  if (hadPending) toast.info('已导入座位：未保存的「本次调整」记录已清空')
  toast.success(
    `导入完成：${outcome.applied} 个座位${outcome.relocated > 0 ? `，${outcome.relocated} 名学生换位` : ''}`,
  )
  emit('update:modelValue', false)
}

function close(): void {
  emit('update:modelValue', false)
}
</script>

<template>
  <AppModal :model-value="modelValue" title="导入座位" :width="780" @update:model-value="close">
    <input
      ref="fileInput"
      type="file"
      accept=".xlsx,.xls"
      class="file-input"
      tabindex="-1"
      aria-hidden="true"
      @change="onFilePicked"
    />

    <!-- 未选文件：上传卡（点击 / 拖入）+ 先讲清表格该怎么摆，教师回去改表比来回试快 -->
    <div v-if="!filename && !parseError" class="intro">
      <ImportFileCard class="intro-upload" :busy="busy" @pick="pickFile" @file="readFile" />
      <ImportIntro
        lead="选择一份 Excel 座位表（.xlsx / .xls），第一行为表头。"
        filename="座位表导入模板"
        sheet-name="座位表"
        :headers="SEAT_IMPORT_HEADERS"
        :sample="SEAT_IMPORT_SAMPLE"
        note="上面的例子表示：学号 0101 的学生坐第 1 排第 1 列，0102 坐第 1 排第 4 列（中间隔一条过道）。"
      >
        <li><strong>必需列</strong>：{{ SEAT_IMPORT_HEADERS.join('、') }}</li>
        <li>{{ SEAT_IMPORT_HINT }}</li>
        <li>
          优先按<strong>学号</strong>匹配学生；学号为空时才按姓名匹配，<strong>重名一律拦下</strong>
        </li>
      </ImportIntro>
    </div>

    <ImportHints v-if="parseError" :items="errorHints" />

    <template v-if="result">
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
      <AppButton
        v-if="result"
        :disabled="result.assignable === 0 || result.blocked > 0"
        @click="confirm"
      >
        确认导入 {{ result.assignable }} 个座位
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
