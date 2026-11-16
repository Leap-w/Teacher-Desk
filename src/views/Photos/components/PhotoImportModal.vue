<script setup lang="ts">
/**
 * 按文件名批量导入学生照片弹窗（v3.8.2 · Phase 2）。
 *
 * 只做「选文件 → 解析 → 预览 → 人工确认 → 串行导入 → 反馈」这一段编排：
 * - 解析 / 匹配 / 脱敏 / 串行全是 `services/photoImport` 的纯函数，组件不重复实现；
 * - 真正的写入接进 Phase 1 的 `studentPhotoStore.addPhoto`（图片处理 / IDB / outbox 全在那里）；
 * - 整批用 `runLockedOperation` 包住，锁内写盘不推送、解锁补一次同步。
 *
 * ## 隐私
 * - 预览表的「文件名」列只显示脱敏名（`****` 代替身份证号）；原始 `file.name` 不渲染、不进 toast；
 * - 姓名唯一命中也标注「身份证号未核验」，绝不显示"验证通过"；
 * - 身份证号不参与匹配、不落盘、不进日志（见 `services/photoImport.ts` 文件头）。
 */
import { computed, ref, watch } from 'vue'

import {
  AppButton,
  AppModal,
  AppSelect,
  ImportFileCard,
  ImportFileRow,
  ImportHints,
  ImportPreviewTable,
  ImportStats,
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
import { useStudentPhotoStore } from '@/stores/studentPhoto'
import { useStudentStore } from '@/stores/student'
import {
  buildPhotoImportPlan,
  chooseImportStudent,
  executePhotoImport,
  removeImportRows,
  type PhotoImportAction,
  type PhotoImportRow,
} from '@/services/photoImport'
import { formatStudentShortName } from '@/utils/student'
import type { SelectOption } from '@/types'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  changed: []
}>()

const photoStore = useStudentPhotoStore()
const studentStore = useStudentStore()
const toast = useToast()

/* ---------- 列 / 状态 ---------- */
const PREVIEW_COLUMNS: readonly ImportPreviewColumn[] = [
  { key: 'fileName', label: '文件名', wrap: true },
  { key: 'className', label: '班级' },
  { key: 'studentName', label: '姓名' },
  { key: 'category', label: '类型' },
  { key: 'student', label: '归属学生' },
  { key: 'existing', label: '已有照片' },
]
const ACTIONS: Record<string, ImportActionMeta> = {
  ready: { label: '可导入', tone: 'ok' },
  'need-choice': { label: '待指定', tone: 'warn' },
  'blocked-name': { label: '文件名异常', tone: 'bad' },
  'blocked-class': { label: '班级不符', tone: 'bad' },
  imported: { label: '已保存本机', tone: 'ok' },
  failed: { label: '保存失败', tone: 'bad' },
}

/* ---------- 阶段与状态 ---------- */
type Phase = 'preview' | 'importing' | 'done'
const phase = ref<Phase>('preview')
const fileInput = ref<HTMLInputElement>()
/** shallowRef：不让 Vue 深度代理 File（addPhoto 要拿到原始 Blob） */
const rows = ref<PhotoImportRow[]>([])
const cancelRequested = ref(false)
const progress = ref({ done: 0, total: 0 })
const result = ref<{ success: number; failed: number; skipped: number }>()

const canImport = computed(
  () => phase.value !== 'importing' && rows.value.some((row) => row.action === 'ready'),
)

const previewRows = computed<ImportPreviewRow[]>(() =>
  rows.value.map((row) => ({
    rowNumber: Number(row.id),
    action: row.action,
    cells: {
      fileName: row.displayName,
      className: row.className || '—',
      studentName: row.studentName || '—',
      category: row.categoryText,
      student: row.displayStudent ?? (row.action === 'need-choice' ? '请人工指定' : '—'),
      existing: row.existingCount > 0 ? `${row.existingCount} 张` : '—',
    },
    errors: [...row.errors],
    warnings: [...row.warnings],
  })),
)

const statItems = computed<ImportStat[]>(() => [
  { value: rows.value.length, label: '已选照片' },
  {
    value: rows.value.filter((row) => row.action === 'ready').length,
    label: '可导入',
    tone: 'ok',
  },
  {
    value: rows.value.filter((row) => row.action === 'need-choice').length,
    label: '待指定',
  },
  {
    value: rows.value.filter(
      (row) => row.action === 'blocked-name' || row.action === 'blocked-class',
    ).length,
    label: '被拦下',
    tone: 'bad',
  },
])

const hints = computed<ImportHint[]>(() => {
  const items: ImportHint[] = [
    {
      tone: 'info',
      text: '姓名唯一命中会作为候选；重名或查无此人必须人工指定归属。身份证号未核验，请教师自行核对照片归属。',
    },
  ]
  if (rows.value.some((row) => row.warnings.some((w) => w.includes('已有')))) {
    items.push({
      tone: 'warning',
      text: '已有同类照片的学生只会新增，不会覆盖或删除旧照片。',
    })
  }
  return items
})

/** 需要人工指定的行（放预览表下方单独确认；预览表本身是纯文本、不留插槽） */
const needChoiceRows = computed(() => rows.value.filter((row) => row.action === 'need-choice'))
/** 预览阶段可移除的任意行（导入进行中 / 完成后不可移除，避免与结果冲突） */
const removableRows = computed(() => (phase.value === 'preview' ? rows.value : []))

function choiceOptions(row: PhotoImportRow): SelectOption[] {
  return row.candidates.map((student) => ({
    label: formatStudentShortName(student, studentStore.nameCounts),
    value: student.id,
  }))
}

function onChoose(rowId: string, studentId: string | number): void {
  const student = studentStore.students.find((item) => item.id === String(studentId))
  rows.value = chooseImportStudent(rows.value, rowId, student, studentStore.nameCounts)
}

/* ---------- 选文件 ---------- */

function pickFiles(): void {
  fileInput.value?.click()
}

function rebuildPlan(files: File[]): void {
  rows.value = buildPhotoImportPlan(files, {
    activeStudents: studentStore.activeStudents,
    nameCounts: studentStore.nameCounts,
    existingPhotos: photoStore.photos,
  }).rows
  result.value = undefined
  phase.value = 'preview'
}

function onFilesPicked(event: Event): void {
  const input = event.target as HTMLInputElement
  const files = input.files ? [...input.files] : []
  input.value = ''
  if (files.length === 0) return
  rebuildPlan(files)
}

/** 上传卡拖入的单张也并进当前列表（按 name+size 去重，重复拖入不产生两行） */
function onDropFile(file: File): void {
  const existing = rows.value.some(
    (row) => row.file.name === file.name && row.file.size === file.size,
  )
  if (existing) return
  rebuildPlan([...rows.value.map((row) => row.file), file])
}

function removeRow(rowId: string): void {
  rows.value = removeImportRows(rows.value, [rowId])
}

/* ---------- 导入 ---------- */

async function startImport(): Promise<void> {
  if (!canImport.value) return
  phase.value = 'importing'
  cancelRequested.value = false
  const total = rows.value.filter((row) => row.action === 'ready').length
  progress.value = { done: 0, total }

  const execution = await runLockedOperation('photo-batch-import', () =>
    executePhotoImport(
      rows.value,
      async (row) => {
        const photo = await photoStore.addPhoto(row.studentId!, row.file, row.category)
        return { photoId: photo.id }
      },
      {
        shouldCancel: () => cancelRequested.value,
        onProgress: (done, all) => {
          progress.value = { done, total: all }
        },
      },
    ),
  )

  rows.value = execution.rows
  const skipped =
    rows.value.filter((row) => row.action === 'ready').length +
    rows.value.filter((row) => row.action === 'blocked-name' || row.action === 'blocked-class')
      .length
  result.value = { success: execution.success, failed: execution.failed, skipped }
  phase.value = 'done'

  if (execution.success > 0) {
    toast.success(
      `已保存 ${execution.success} 张照片到本机` +
        (photoStore.pendingUploadCount > 0 ? '，云端补传会自动进行' : ''),
    )
  }
  if (execution.failed > 0) {
    toast.warning(`有 ${execution.failed} 张保存失败，可在下方对失败项重试`)
  }
  if (execution.cancelled) toast.info('已取消尚未开始导入的照片')
  await photoStore.refreshLocalPresence()
  emit('changed')
}

function cancelImport(): void {
  cancelRequested.value = true
}

/** 只把失败行重新排回导入队列；已成功的不会重复上传 */
function retryFailed(): void {
  if (phase.value === 'importing') return
  rows.value = rows.value.map((row) =>
    row.action === 'failed' ? { ...row, action: 'ready' as PhotoImportAction, errors: [] } : row,
  )
  phase.value = 'preview'
}

function close(): void {
  emit('update:modelValue', false)
}

/** 每次打开都从干净状态开始，不残留上次的预览或结论 */
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    rows.value = []
    result.value = undefined
    progress.value = { done: 0, total: 0 }
    cancelRequested.value = false
    phase.value = 'preview'
    if (fileInput.value) fileInput.value.value = ''
  },
)
</script>

<template>
  <AppModal
    :model-value="modelValue"
    title="批量导入学生照片"
    :width="920"
    @update:model-value="close"
  >
    <div class="import-photo">
      <!-- 选文件 -->
      <ImportFileCard
        title="点击选择或拖入照片"
        hint="支持 jpg / jpeg / png / webp，可一次选择多张"
        @pick="pickFiles"
        @file="onDropFile"
      />
      <input
        ref="fileInput"
        class="file-input"
        type="file"
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        multiple
        @change="onFilesPicked"
      />

      <div class="name-guide">
        <p class="name-guide__title">文件名格式</p>
        <code class="name-guide__code">9班-姓名-身份证号[-证件照|生活照].jpg</code>
        <p class="name-guide__note">
          「-证件照 / -生活照」可省略，省略时按自动规则分类（该生首张为证件照、其后为生活照）。
          类型与归属以预览为准；身份证号仅用于解析，不参与匹配、不保存、不展示完整号码。
        </p>
      </div>

      <ImportFileRow
        v-if="rows.length"
        :filename="`已选择 ${rows.length} 张照片`"
        sheet-note="预览如下，可移除不需要导入的照片"
        reselect-label="重新选择"
        @reselect="pickFiles"
      />

      <template v-if="rows.length">
        <ImportStats :items="statItems" />
        <ImportHints :items="hints" />

        <div class="row-tools">
          <span class="row-tools__hint">逐行核对归属，带「待指定」的行必须人工选择学生。</span>
          <AppButton
            v-if="phase === 'preview'"
            size="sm"
            variant="ghost"
            :disabled="!canImport"
            @click="startImport"
          >
            确认导入可导入项
          </AppButton>
        </div>

        <ImportPreviewTable :columns="PREVIEW_COLUMNS" :rows="previewRows" :actions="ACTIONS" />

        <!-- 人工指定归属（预览表是纯文本组件，确认控件放这里） -->
        <section v-if="needChoiceRows.length && phase === 'preview'" class="choice-block">
          <p class="choice-block__title">人工指定归属（{{ needChoiceRows.length }} 张）</p>
          <div v-for="row in needChoiceRows" :key="row.id" class="choice-row">
            <span class="choice-row__file">{{ row.displayName }}</span>
            <AppSelect
              :model-value="''"
              :options="choiceOptions(row)"
              placeholder="选择学生"
              size="sm"
              @update:model-value="onChoose(row.id, $event)"
            />
          </div>
        </section>

        <!-- 预览阶段移除不想导入的文件 -->
        <section v-if="removableRows.length" class="remove-block">
          <p class="remove-block__title">移除不需要导入的照片</p>
          <div v-for="row in removableRows" :key="row.id" class="remove-row">
            <span class="remove-row__file">{{ row.displayName }}</span>
            <AppButton size="sm" variant="ghost" @click="removeRow(row.id)">移除</AppButton>
          </div>
        </section>

        <div v-if="phase === 'importing'" class="progress" role="status">
          <span>正在处理并保存 {{ progress.done }} / {{ progress.total }} 张…</span>
          <AppButton size="sm" variant="ghost" @click="cancelImport">取消剩余</AppButton>
        </div>

        <div v-if="phase === 'done' && result" class="result" role="status">
          <p class="result__title">
            完成：成功 {{ result.success }} 张 · 失败 {{ result.failed }} 张 · 跳过
            {{ result.skipped }} 张
          </p>
          <p class="result__note">
            成功仅表示已保存到本机；云端上传由既有队列在联网登录后自动补传。
          </p>
          <AppButton v-if="result.failed > 0" size="sm" variant="secondary" @click="retryFailed">
            重试失败项
          </AppButton>
        </div>
      </template>
    </div>

    <template #footer>
      <AppButton :disabled="phase === 'importing'" variant="secondary" @click="close">
        关闭
      </AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.import-photo {
  display: flex;
  flex-direction: column;
}

.file-input {
  display: none;
}

.name-guide {
  margin-top: var(--space-3);
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-bg-subtle);
}

.name-guide__title {
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.name-guide__code {
  display: block;
  margin: var(--space-2) 0;
  font-size: var(--font-caption);
  color: var(--color-primary-strong);
  overflow-wrap: anywhere;
}

.name-guide__note,
.row-tools__hint,
.result__note {
  font-size: var(--font-caption);
  line-height: var(--leading-relaxed);
  color: var(--color-text-secondary);
}

.row-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-top: var(--space-4);
}

.choice-block {
  margin-top: var(--space-4);
  padding: var(--space-3);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
}

.choice-block__title {
  margin-bottom: var(--space-2);
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.choice-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  padding: var(--space-1) 0;
}

.choice-row__file {
  font-size: var(--font-caption);
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}

.remove-block {
  margin-top: var(--space-4);
}

.remove-block__title {
  margin-bottom: var(--space-1);
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.remove-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-1) 0;
}

.remove-row__file {
  font-size: var(--font-caption);
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}

.progress,
.result {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-top: var(--space-4);
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-bg-subtle);
  font-size: var(--font-secondary);
  color: var(--color-text-secondary);
}

.result {
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
}

.result__title {
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}
</style>
