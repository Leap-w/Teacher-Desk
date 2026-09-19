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
  DORMITORY_HINT,
  STUDENT_IMPORT_HEADERS,
  STUDENT_IMPORT_OPTIONAL,
  STUDENT_IMPORT_REQUIRED,
  STUDENT_IMPORT_SAMPLE,
  parseStudentRows,
  planStudentImport,
} from '@/services/studentImport'
import type { ParsedRow, StudentImportResult } from '@/services/studentImport'
import { useStudentStore } from '@/stores/student'
import { FAMILY_SCOPE_LABELS, FAMILY_SCOPE_OPTIONS } from '@/utils/student'
import type { Gender } from '@/types'

/**
 * 批量导入学生弹窗（Phase 5A）。样式与取文件的管道都与座位导入共用
 * （`components/ui` 的导入五件 + 已选文件行 + `useSheetImport`）。
 *
 * 预览里的列跟着模板一起补齐了：**所属地区 / 所属县·区 / 备注** 三个字段过去只能在
 * 档案页手填，现在 Excel 里能写、预览里也能核对。
 */

interface Props {
  modelValue: boolean
}

const props = withDefaults(defineProps<Props>(), {})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const studentStore = useStudentStore()
const toast = useToast()

/**
 * 预览表的列（「行」与「状态」两列由 ImportPreviewTable 固定提供）。
 * 身份证尾号留着：它是重名消歧的依据，教师扫一眼就能发现「尾号填串了」。
 */
const PREVIEW_COLUMNS: readonly ImportPreviewColumn[] = [
  { key: 'name', label: '姓名' },
  { key: 'gender', label: '性别' },
  { key: 'studentNo', label: '学号' },
  { key: 'idCardSuffix', label: '身份证尾号' },
  { key: 'dormitory', label: '宿舍' },
  { key: 'cadreRole', label: '班委' },
  { key: 'scope', label: '返家范围' },
  { key: 'prefecture', label: '所属地区' },
  { key: 'county', label: '所属县/区' },
  { key: 'remark', label: '备注', wrap: true },
]

const ACTIONS: Record<string, ImportActionMeta> = {
  add: { label: '新增', tone: 'ok' },
  update: { label: '更新', tone: 'info' },
  blocked: { label: '已拦下', tone: 'bad' },
}

/**
 * 「返家范围」的合法写法。从选项表**取 label**：直接 join 选项数组会得到一串
 * `[object Object]`（`SelectOption` 是 `{label, value}`），而这句话正是教师照着填的那一行。
 */
const SCOPE_HINT = FAMILY_SCOPE_OPTIONS.map((option) => option.label).join(' / ')

const fileInput = ref<HTMLInputElement>()
const parsed = ref<ParsedRow[] | undefined>(undefined)

const sheet = useSheetImport({
  fileInput,
  noun: '班级名单',
  parse: (rows) => {
    const parsedRows = parseStudentRows(rows)
    if (!parsedRows.ok) return { ok: false, error: parsedRows.error }
    parsed.value = parsedRows.rows
    return { ok: true, columns: parsedRows.columns }
  },
  reset: () => {
    parsed.value = undefined
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

/**
 * 合并计划是 **computed，不是选完文件就算一次**：它依赖 `studentStore.students`，
 * 所以教师在别处改了档案（另一个标签页同步过来）时，这里的「新增 / 更新」会跟着重算。
 * 预览上看到的数字与真正落库的计划必须来自同一次计算——否则会出现「预览说新增 40、
 * 落库变成 41」这种最难查的偏差。
 */
const result = computed<StudentImportResult | undefined>(() =>
  parsed.value ? planStudentImport(parsed.value, studentStore.students) : undefined,
)

const statItems = computed<ImportStat[]>(() => {
  const current = result.value
  if (!current) return []
  return [
    { value: current.total, label: '总行数' },
    { value: current.importable, label: '可导入', tone: 'ok' },
    { value: current.blocked, label: '被拦下', tone: current.blocked > 0 ? 'bad' : undefined },
    { value: current.added, label: '其中新增' },
    { value: current.updated, label: '其中更新' },
  ]
})

const previewRows = computed<ImportPreviewRow[]>(() =>
  (result.value?.rows ?? []).map((row) => ({
    rowNumber: row.rowNumber,
    action: row.action,
    cells: {
      name: row.name,
      gender: genderLabel(row.gender),
      studentNo: row.studentNo,
      idCardSuffix: row.idCardSuffix,
      dormitory: row.dormitory,
      cadreRole: row.cadreRole,
      scope: row.scope ? FAMILY_SCOPE_LABELS[row.scope] : '',
      prefecture: row.prefecture,
      county: row.county,
      remark: row.remark,
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

function genderLabel(gender: Gender | ''): string {
  if (gender === 'male') return '男'
  if (gender === 'female') return '女'
  return '—'
}

/** 预览里的提示组：按教师「要做什么」分类，不按代码里的字段分 */
const hints = computed<ImportHint[]>(() => {
  const current = result.value
  if (!current) return []
  const list: ImportHint[] = []
  // 名册 12 列必然横向滚动，「状态」列在最右边——被拦的行号与原因提前说在这里
  const blocked = blockedHint(current.rows)
  if (blocked) list.push(blocked)
  if (current.duplicateNames.length > 0) {
    list.push({
      tone: 'info',
      text: `${current.duplicateNames.length} 个姓名重复（${current.duplicateNames.join('、')}）——不拦，导入后请在列表里核对`,
    })
  }
  if (current.emptyStudentNo > 0) {
    list.push({
      tone: 'warning',
      text: `${current.emptyStudentNo} 行学号为空：没有学号就没有合并依据，每次导入都会新增一条`,
    })
  }
  if (current.missingDormitory > 0) {
    list.push({
      tone: 'info',
      text: `${current.missingDormitory} 行宿舍不在固定清单内，本次留空。可选宿舍：${DORMITORY_HINT}`,
    })
  }
  if (current.missingScope > 0) {
    list.push({
      tone: 'info',
      text: `${current.missingScope} 行缺返家范围，导入后需在档案里逐个补（周末返家统计要用）`,
    })
  }
  return list
})

async function confirm(): Promise<void> {
  const current = result.value
  if (!current || current.importable === 0) return
  // RC-01 / RC-02：导入期间暂停同步，写完这批学生后自动补推一次
  const outcome = await runLockedOperation('student-import', () =>
    studentStore.applyStudentImport(current.plan),
  )
  toast.success(`导入完成：新增 ${outcome.added} 名，更新 ${outcome.updated} 名`)
  emit('update:modelValue', false)
}

function close(): void {
  emit('update:modelValue', false)
}
</script>

<template>
  <AppModal :model-value="modelValue" title="批量导入学生" :width="760" @update:model-value="close">
    <input
      ref="fileInput"
      type="file"
      accept=".xlsx,.xls"
      class="file-input"
      tabindex="-1"
      aria-hidden="true"
      @change="onFilePicked"
    />

    <!-- 未选文件：上传卡 + 先讲清楚表格该怎么摆，教师回去改表比来回试快 -->
    <div v-if="!filename && !parseError" class="intro">
      <ImportFileCard class="intro-upload" :busy="busy" @pick="pickFile" @file="readFile" />
      <ImportIntro
        lead="选择一份 Excel 名单（.xlsx / .xls），第一行为表头。"
        filename="学生名单导入模板"
        sheet-name="学生名单"
        :headers="STUDENT_IMPORT_HEADERS"
        :sample="STUDENT_IMPORT_SAMPLE"
        note="上面的例子表示：学号 0101 的旦增卓玛住女生2栋113、返家范围是昌都市区；第二行故意空着「身份证尾号」和「班委」——选填列留空没问题，留空只表示这次没填，不会把档案里已有的值清掉。"
      >
        <li><strong>必填列</strong>：{{ STUDENT_IMPORT_REQUIRED.join('、') }}</li>
        <li><strong>选填列</strong>：{{ STUDENT_IMPORT_OPTIONAL.join('、') }}</li>
        <li>
          学号相同的行会<strong>更新</strong>已有学生，其余<strong>新增</strong>；标签用逗号分隔；
          「返家范围」写{{ SCOPE_HINT }}
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
      <AppButton v-if="!result" :disabled="busy" @click="pickFile">
        {{ busy ? '读取中…' : '选择 Excel 文件' }}
      </AppButton>
      <AppButton v-else :disabled="result.importable === 0" @click="confirm">
        确认导入 {{ result.importable }} 名学生
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
