<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { AppButton, AppModal, TemplateDownloadLink } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { runLockedOperation } from '@/composables/useOperationLock'
import { readSheetRows } from '@/services/studentImport'
import {
  parseSeatRows,
  planSeatImport,
  SEAT_IMPORT_HEADERS,
  SEAT_IMPORT_HINT,
  SEAT_IMPORT_SAMPLE,
} from '@/services/seatImport'
import type { ParsedSeatRow, SeatImportResult } from '@/services/seatImport'
import SeatImportCard from './SeatImportCard.vue'
import { useSeatStore } from '@/stores/seat'
import { useStudentStore } from '@/stores/student'

/**
 * Excel 座位导入弹窗（V1.1.2 Phase 1）。
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

/** 一份座位表撑死几十行，超过这个体积的多半是选错了文件 */
const MAX_FILE_BYTES = 5 * 1024 * 1024

const CHANGE_LABELS = { new: '新安排', move: '换座位', same: '原位不动' } as const

const fileInput = ref<HTMLInputElement>()
const busy = ref(false)
const filename = ref('')
/** 工作表说明（文件里有多个工作表时要说清读了哪一个） */
const sheetNote = ref('')
/** 整体性错误：文件读不了、表头缺列、表里没有数据行——这些情况下不进预览 */
const parseError = ref('')
const parsed = ref<ParsedSeatRow[] | undefined>(undefined)
const blankRows = ref(0)
const columns = ref<string[]>([])

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

function reset() {
  filename.value = ''
  sheetNote.value = ''
  parseError.value = ''
  parsed.value = undefined
  blankRows.value = 0
  columns.value = []
}

watch(
  () => props.modelValue,
  (open) => {
    // 关闭即清场：下次打开是一张干净的表，也不残留上次的预览结论
    if (open) return
    reset()
  },
)

function pickFile(): void {
  fileInput.value?.click()
}

async function onFilePicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // 选同一个文件两次也要能触发 change
  input.value = ''
  if (!file) return
  await readFile(file)
}

/** UI-4B：拖入上传卡的文件与 input 选出的文件走同一条解析路径 */
async function readFile(file: File): Promise<void> {
  reset()
  if (file.size > MAX_FILE_BYTES) {
    parseError.value = `文件超过 ${MAX_FILE_BYTES / 1024 / 1024} MB，请确认选的是座位表`
    return
  }

  busy.value = true
  try {
    const buffer = await file.arrayBuffer()
    const sheet = await readSheetRows(buffer)
    if (!sheet.ok) {
      parseError.value = sheet.error
      return
    }
    filename.value = file.name
    sheetNote.value =
      sheet.sheetCount > 1
        ? `已读取第一个工作表「${sheet.sheetName}」，文件共 ${sheet.sheetCount} 个工作表`
        : `工作表「${sheet.sheetName}」`

    const parsedRows = parseSeatRows(sheet.rows, seatStore.config)
    if (!parsedRows.ok) {
      parseError.value = parsedRows.error
      return
    }
    parsed.value = parsedRows.rows
    blankRows.value = parsedRows.blankRows
    columns.value = parsedRows.columns
  } catch {
    parseError.value = '读取文件失败，请重试'
  } finally {
    busy.value = false
  }
}

/** 预览提示组：按教师「要做什么」分类，不按代码里的字段分 */
const hints = computed(() => {
  const current = result.value
  if (!current) return []
  const list: Array<{ tone: 'warning' | 'info'; text: string }> = []
  if (current.blocked > 0) {
    list.push({
      tone: 'warning',
      text: `${current.blocked} 行有错误，本次不能导入——请先在 Excel 里改好再重新选择文件`,
    })
  }
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
      <SeatImportCard class="intro-upload" :busy="busy" @pick="pickFile" @file="readFile" />
      <header class="intro-hint">
        <p class="intro-lead">选择一份 Excel 座位表（.xlsx / .xls），第一行为表头。</p>
        <TemplateDownloadLink
          filename="座位表导入模板"
          sheet-name="座位表"
          :headers="SEAT_IMPORT_HEADERS"
          :sample="SEAT_IMPORT_SAMPLE"
        />
      </header>
      <ul class="intro-list">
        <li><strong>必需列</strong>：{{ SEAT_IMPORT_HEADERS.join('、') }}</li>
        <li>{{ SEAT_IMPORT_HINT }}</li>
        <li>
          优先按<strong>学号</strong>匹配学生；学号为空时才按姓名匹配，<strong>重名一律拦下</strong>
        </li>
      </ul>
      <table class="intro-sample">
        <thead>
          <tr>
            <th v-for="header in SEAT_IMPORT_HEADERS" :key="header">{{ header }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in SEAT_IMPORT_SAMPLE" :key="index">
            <td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell }}</td>
          </tr>
        </tbody>
      </table>
      <p class="intro-note">
        上面的例子表示：学号 0101 的学生坐第 1 排第 1 列，0102 坐第 1 排第 4 列（中间隔一条过道）。
      </p>
    </div>

    <p v-if="parseError" class="parse-error" role="alert">{{ parseError }}</p>

    <template v-if="result">
      <div class="file-row">
        <div class="file-meta">
          <strong class="file-name">{{ filename }}</strong>
          <span class="file-sheet">{{ sheetNote }}</span>
        </div>
        <AppButton size="sm" variant="ghost" @click="pickFile">重新选择</AppButton>
      </div>

      <div v-if="columns.length" class="columns-note">
        识别到 {{ columns.length }} 列：{{ columns.join('、') }}
      </div>

      <div class="stats">
        <div class="stat">
          <span class="stat-value">{{ result.total }}</span>
          <span class="stat-label">总行数</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ result.validSeats }}</span>
          <span class="stat-label">有效座位</span>
        </div>
        <div class="stat is-ok">
          <span class="stat-value">{{ result.assignable }}</span>
          <span class="stat-label">可导入</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ result.changed }}</span>
          <span class="stat-label">新安排</span>
        </div>
        <div class="stat" :class="{ 'is-bad': result.unknownStudents > 0 }">
          <span class="stat-value">{{ result.unknownStudents }}</span>
          <span class="stat-label">无法识别</span>
        </div>
        <div class="stat" :class="{ 'is-bad': result.duplicateSeats > 0 }">
          <span class="stat-value">{{ result.duplicateSeats }}</span>
          <span class="stat-label">重复座位</span>
        </div>
        <div class="stat" :class="{ 'is-bad': result.duplicateStudents > 0 }">
          <span class="stat-value">{{ result.duplicateStudents }}</span>
          <span class="stat-label">重复学生</span>
        </div>
        <div class="stat" :class="{ 'is-bad': result.errorCount > 0 }">
          <span class="stat-value">{{ result.errorCount }}</span>
          <span class="stat-label">错误</span>
        </div>
      </div>

      <ul class="hints">
        <li v-for="hint in hints" :key="hint.text" class="hint" :class="`is-${hint.tone}`">
          {{ hint.text }}
        </li>
      </ul>

      <div class="preview-scroll">
        <table class="preview-table">
          <thead>
            <tr>
              <th class="col-no">行</th>
              <th>座位</th>
              <th>学号</th>
              <th>姓名</th>
              <th>变化</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in result.rows"
              :key="row.rowNumber"
              :class="{ 'is-blocked': row.action === 'blocked' }"
            >
              <td class="col-no">{{ row.rowNumber }}</td>
              <td>{{ row.seatLabel }}</td>
              <td>{{ row.studentNo || '—' }}</td>
              <td>{{ row.name || '—' }}</td>
              <td>{{ row.change ? CHANGE_LABELS[row.change] : '—' }}</td>
              <td class="col-status">
                <span class="status" :class="`is-${row.action}`">
                  {{ row.action === 'assign' ? '可导入' : '已拦下' }}
                </span>
                <span v-for="text in row.errors" :key="text" class="note is-error">{{ text }}</span>
                <span v-for="text in row.warnings" :key="text" class="note">{{ text }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
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

/* 说明 + 「下载模板」一行 */
.intro-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.intro-lead {
  font-size: var(--text-sm);
  color: var(--color-text);
}

.intro-list {
  margin-top: var(--space-3);
  padding-left: 1.2em;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  font-size: var(--text-sm);
  line-height: 1.6;
  color: var(--color-text-secondary);
}

.intro-list strong {
  color: var(--color-text);
}

.intro-sample {
  margin-top: var(--space-4);
  border-collapse: collapse;
  font-size: var(--text-xs);
}

.intro-sample th,
.intro-sample td {
  padding: 4px 14px 4px 0;
  text-align: left;
  color: var(--color-text-secondary);
}

.intro-sample th {
  font-weight: 600;
  color: var(--color-text);
}

.intro-note {
  margin-top: var(--space-2);
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}

.parse-error {
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--color-danger-soft);
  color: var(--color-danger-strong);
  font-size: var(--text-sm);
  line-height: 1.6;
}

.file-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.file-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.file-name {
  font-size: var(--text-sm);
  color: var(--color-text);
  overflow-wrap: anywhere;
}

.file-sheet {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.columns-note {
  margin-top: var(--space-2);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-2);
  margin-top: var(--space-4);
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: var(--space-3) var(--space-2);
  border-radius: var(--radius-md);
  background: var(--color-fill-disabled);
}

.stat-value {
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text);
}

.stat-label {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.stat.is-ok .stat-value {
  color: var(--color-success-strong);
}

.stat.is-bad .stat-value {
  color: var(--color-danger-strong);
}

.hints {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-4);
}

.hint {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  font-size: var(--text-xs);
  line-height: 1.6;
}

.hint.is-warning {
  background: var(--color-warning-soft);
  color: var(--color-warning-strong);
}

.hint.is-info {
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
}

.preview-scroll {
  margin-top: var(--space-4);
  max-height: 300px;
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.preview-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-xs);
}

.preview-table th,
.preview-table td {
  padding: var(--space-2) var(--space-3);
  text-align: left;
  vertical-align: top;
  border-bottom: 1px solid var(--color-border);
  white-space: nowrap;
}

.preview-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--color-surface);
  font-weight: 600;
  color: var(--color-text-secondary);
}

.preview-table tbody tr:last-child td {
  border-bottom: none;
}

.preview-table tr.is-blocked {
  background: var(--color-danger-soft);
}

.col-no {
  width: 40px;
  color: var(--color-text-faint);
  font-variant-numeric: tabular-nums;
}

.col-status {
  white-space: normal;
  min-width: 220px;
}

.status {
  display: inline-block;
  padding: 1px 8px;
  border-radius: var(--radius-full);
  font-weight: 600;
}

.status.is-assign {
  background: var(--color-success-soft);
  color: var(--color-success-strong);
}

.status.is-blocked {
  background: var(--color-danger-soft);
  color: var(--color-danger-strong);
}

.note {
  display: block;
  margin-top: 2px;
  color: var(--color-text-secondary);
  line-height: 1.5;
}

.note.is-error {
  color: var(--color-danger-strong);
}
</style>
