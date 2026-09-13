<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { AppButton, AppModal } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import {
  DORMITORY_HINT,
  parseStudentRows,
  planStudentImport,
  readSheetRows,
} from '@/services/studentImport'
import type { ImportAction, ParsedRow, StudentImportResult } from '@/services/studentImport'
import { useStudentStore } from '@/stores/student'
import type { Gender } from '@/types'

interface Props {
  modelValue: boolean
}

const props = withDefaults(defineProps<Props>(), {})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const studentStore = useStudentStore()
const toast = useToast()

/** 一份班级名单撑死几百行，超过这个体积的多半是选错了文件 */
const MAX_FILE_BYTES = 5 * 1024 * 1024

const ACTION_LABELS: Record<ImportAction, string> = {
  add: '新增',
  update: '更新',
  blocked: '已拦下',
}

const fileInput = ref<HTMLInputElement>()
const busy = ref(false)
const filename = ref('')
/** 工作表说明（文件里有多个工作表时要说清读了哪一个） */
const sheetNote = ref('')
/** 整体性错误：文件读不了、表头缺列、表里没有数据行——这些情况下不进预览 */
const parseError = ref('')
const parsed = ref<ParsedRow[] | undefined>(undefined)
const columns = ref<string[]>([])

/**
 * 合并计划是 **computed，不是选完文件就算一次**：它依赖 `studentStore.students`，
 * 所以教师在别处改了档案（另一个标签页同步过来）时，这里的「新增 / 更新」会跟着重算。
 * 预览上看到的数字与真正落库的计划必须来自同一次计算——否则会出现「预览说新增 40、
 * 落库变成 41」这种最难查的偏差。
 */
const result = computed<StudentImportResult | undefined>(() =>
  parsed.value ? planStudentImport(parsed.value, studentStore.students) : undefined,
)

function reset() {
  filename.value = ''
  sheetNote.value = ''
  parseError.value = ''
  parsed.value = undefined
  columns.value = []
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) return
    reset()
  },
)

function pickFile(): void {
  fileInput.value?.click()
}

function genderLabel(gender: Gender | ''): string {
  if (gender === 'male') return '男'
  if (gender === 'female') return '女'
  return '—'
}

async function onFilePicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // 选同一个文件两次也要能触发 change
  input.value = ''
  if (!file) return

  reset()
  if (file.size > MAX_FILE_BYTES) {
    parseError.value = `文件超过 ${MAX_FILE_BYTES / 1024 / 1024} MB，请确认选的是班级名单`
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

    const parsedRows = parseStudentRows(sheet.rows)
    if (!parsedRows.ok) {
      parseError.value = parsedRows.error
      return
    }
    parsed.value = parsedRows.rows
    columns.value = parsedRows.columns
  } catch {
    parseError.value = '读取文件失败，请重试'
  } finally {
    busy.value = false
  }
}

/** 预览里的提示组：按教师「要做什么」分类，不按代码里的字段分 */
const hints = computed(() => {
  const current = result.value
  if (!current) return []
  const list: Array<{ tone: 'warning' | 'info'; text: string }> = []
  if (current.blocked > 0) {
    list.push({
      tone: 'warning',
      text: `${current.blocked} 行被拦下不会导入，原因见下表「状态」列`,
    })
  }
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

function confirm(): void {
  const current = result.value
  if (!current || current.importable === 0) return
  const outcome = studentStore.applyStudentImport(current.plan)
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

    <!-- 未选文件：先讲清楚表格该怎么摆，教师回去改表比来回试快 -->
    <div v-if="!filename && !parseError" class="intro">
      <p class="intro-lead">选择一份 Excel 名单（.xlsx / .xls），第一行为表头。</p>
      <ul class="intro-list">
        <li><strong>必填列</strong>：姓名、性别</li>
        <li><strong>选填列</strong>：学号、宿舍、班委、标签、联系电话、家庭住址、返家范围</li>
        <li>
          学号相同的行会<strong>更新</strong>已有学生，其余<strong>新增</strong>；标签用逗号分隔
        </li>
      </ul>
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
        <div class="stat is-ok">
          <span class="stat-value">{{ result.importable }}</span>
          <span class="stat-label">可导入</span>
        </div>
        <div class="stat" :class="{ 'is-bad': result.blocked > 0 }">
          <span class="stat-value">{{ result.blocked }}</span>
          <span class="stat-label">被拦下</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ result.added }}</span>
          <span class="stat-label">其中新增</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ result.updated }}</span>
          <span class="stat-label">其中更新</span>
        </div>
      </div>

      <ul v-if="hints.length" class="hints">
        <li v-for="hint in hints" :key="hint.text" class="hint" :class="`is-${hint.tone}`">
          {{ hint.text }}
        </li>
      </ul>

      <div class="preview-scroll">
        <table class="preview-table">
          <thead>
            <tr>
              <th class="col-no">行</th>
              <th>姓名</th>
              <th>性别</th>
              <th>学号</th>
              <th>宿舍</th>
              <th>班委</th>
              <th>标签</th>
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
              <td>{{ row.name || '—' }}</td>
              <td>{{ genderLabel(row.gender) }}</td>
              <td>{{ row.studentNo || '—' }}</td>
              <td>{{ row.dormitory || '—' }}</td>
              <td>{{ row.cadreRole || '—' }}</td>
              <td>{{ row.tags.join('、') || '—' }}</td>
              <td class="col-status">
                <span class="status" :class="`is-${row.action}`">
                  {{ ACTION_LABELS[row.action] }}
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
  grid-template-columns: repeat(5, 1fr);
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
  max-height: 320px;
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
  min-width: 200px;
}

.status {
  display: inline-block;
  padding: 1px 8px;
  border-radius: var(--radius-full);
  font-weight: 600;
}

.status.is-add {
  background: var(--color-success-soft);
  color: var(--color-success-strong);
}

.status.is-update {
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
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
