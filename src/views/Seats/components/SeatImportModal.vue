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
import { detectSeatRestoreWorkbook, planSeatRestore } from '@/services/seatRestore'
import type { ParsedSeatRestore, SeatRestorePlan } from '@/services/seatRestore'
import { useSeatStore } from '@/stores/seat'
import { useStudentStore } from '@/stores/student'

/**
 * Excel 座位导入弹窗（V1.1.2 Phase 1；v3.7.6 支持座位图导出文件直接导回）。
 *
 * **五个导入弹窗的样式基准**——首屏说明区 / 上传卡 / 已选文件行 / 统计卡 /
 * 提示条 / 逐行预览表全部走 `components/ui` 的共享实现，取文件的管道走
 * `useSheetImport`，其余四个弹窗照着这一份对齐。
 *
 * 两种导入模式由文件内容自动判断，入口只有一个：
 *   - **行列列表**（既有行为）：逐条应用，表格没提到的座位保持原样；
 *   - **座位图导出文件**（v3.7.6）：优先读隐藏数据表，没有则按可视化版面识别，
 *     **整表恢复**——导出时是空座的格子恢复后也为空，需二次确认。
 *
 * 流程严格按需求：选择文件 → 读取 → 解析 → 校验 → 预览 → 用户确认 → 一次性写入。
 * **关闭弹窗 / 取消一律不写入**；**存在错误时确认按钮禁用**（错误数据绝不进当前方案）。
 * 落库只经 `seatStore.applySeatImport()` / `seatStore.applySeatRestore()`——
 * 组件不碰 `seats` 数组、不碰 localStorage。
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

/** 整表恢复模式的徽标：与「导入」区分，教师一眼知道这次会覆盖整张表 */
const RESTORE_ACTIONS: Record<string, ImportActionMeta> = {
  restore: { label: '可恢复', tone: 'ok' },
  blocked: { label: '已拦下', tone: 'bad' },
}

const fileInput = ref<HTMLInputElement>()
const parsed = ref<ParsedSeatRow[] | undefined>(undefined)
/** 全空行条数（解析时统计，预览里说一句） */
const blankRows = ref(0)
/** 识别为座位图导出文件时的解析结果（与 `parsed` 互斥） */
const restoreParsed = ref<ParsedSeatRestore | undefined>(undefined)
/** 整表恢复的二次确认：第一次点按钮只进入这一步，再点才真正覆盖 */
const restoreConfirming = ref(false)

/** 导出时间（ISO）→ 本地「YYYY-MM-DD HH:mm」；坏值不显示，不编一个时间出来 */
function formatExportedAt(value: string | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 已选文件行的工作表说明：说清读的是隐藏数据表还是可视化版面、来源方案是哪一份 */
function restoreSourceNote(data: ParsedSeatRestore): string {
  const parts =
    data.source === 'metadata'
      ? ['已读取导出数据（隐藏工作表）']
      : [`已按「${data.sourceSheet}」版面识别（旧版导出文件）`]
  if (data.planName) parts.push(`来源方案「${data.planName}」`)
  const exportedAt = formatExportedAt(data.exportedAt)
  if (exportedAt) parts.push(`导出于 ${exportedAt}`)
  if (data.appVersion) parts.push(data.appVersion)
  return parts.join(' · ')
}

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
  /*
   * v3.7.6：先按整个工作簿识别。`undefined` = 不是导出文件，继续走上面的行列列表解析，
   * 旧文件的导入行为一个字节都不变。
   */
  parseWorkbook: (workbook) => {
    const detection = detectSeatRestoreWorkbook(workbook, seatStore.config)
    if (detection.kind === 'none') return undefined
    if (detection.kind === 'error') return { ok: false, error: detection.error }
    restoreParsed.value = detection.parsed
    parsed.value = undefined
    blankRows.value = 0
    restoreConfirming.value = false
    return {
      ok: true,
      columns: [],
      sheetNote: restoreSourceNote(detection.parsed),
    }
  },
  reset: () => {
    parsed.value = undefined
    blankRows.value = 0
    restoreParsed.value = undefined
    restoreConfirming.value = false
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
  !restoreParsed.value && parsed.value
    ? planSeatImport(
        parsed.value,
        studentStore.activeStudents,
        seatStore.currentSeats,
        blankRows.value,
      )
    : undefined,
)

/**
 * 整表恢复计划同样是 computed：预览里的「会变动 / 将腾空」必须与落库那一次
 * 基于同一份当前座位与学生名单，中途别处改了数据也能立刻反映出来。
 */
const restorePlan = computed<SeatRestorePlan | undefined>(() =>
  restoreParsed.value
    ? planSeatRestore(
        restoreParsed.value,
        studentStore.activeStudents,
        seatStore.currentSeats,
        seatStore.config,
      )
    : undefined,
)

const statItems = computed<ImportStat[]>(() => {
  const restore = restorePlan.value
  if (restore) {
    return [
      { value: restore.layout.totalSeats, label: '座位总数' },
      { value: restore.occupiedSeats, label: '导出时就座' },
      { value: restore.emptySeats, label: '导出时空座' },
      { value: restore.assignable, label: '可恢复', tone: 'ok' },
      { value: restore.changed, label: '会变动' },
      { value: restore.clearedSeats, label: '将腾空' },
      {
        value: restore.errorCount,
        label: '错误',
        tone: restore.errorCount > 0 ? 'bad' : undefined,
      },
    ]
  }

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

const previewRows = computed<ImportPreviewRow[]>(() => {
  const restore = restorePlan.value
  if (restore) {
    return restore.rows.map((row) => ({
      rowNumber: row.rowNumber,
      action: row.action,
      cells: {
        seat: row.seatLabel,
        studentNo: row.studentNo,
        name: row.studentLabel ?? row.name,
        change: row.change ? CHANGE_LABELS[row.change] : '',
      },
      errors: row.errors,
      warnings: row.warnings,
    }))
  }

  return (result.value?.rows ?? []).map((row) => ({
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
  }))
})

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
  const restore = restorePlan.value
  if (restore) {
    const list: ImportHint[] = []
    const blocked = blockedHint(restore.rows)
    if (blocked) list.push(blocked)
    for (const text of restore.errors) list.push({ tone: 'danger', text })

    const planName = seatStore.currentPlan?.name
    if (planName) {
      list.push({
        tone: 'info',
        text: `整表恢复到当前座位表「${planName}」，其他座位表不受影响`,
      })
    }
    if (restore.source === 'visual') {
      list.push({
        tone: 'warning',
        text: '这是旧版导出文件（没有机器可读的座位数据）：只能按座位图上的姓名恢复，学号与排座约束无法恢复；重名学生会被拦下。',
      })
    }
    for (const text of restore.warnings) {
      // 上面那条已经把「旧版文件无约束」说全了，不再重复
      if (restore.source === 'visual' && text.includes('约束')) continue
      list.push({ tone: 'info', text })
    }
    if (restore.constraints) {
      const counts = restore.constraints
      const total =
        counts.sameDeskForbidden.length +
        counts.adjacentGroupForbidden.length +
        counts.frontRowStudents.length +
        counts.backRowStudents.length
      list.push({
        tone: 'info',
        text:
          total === 0
            ? '导出文件里没有排座约束，确认后会清空当前方案的排座约束'
            : `将同时恢复排座约束：不能同桌 ${counts.sameDeskForbidden.length} 条、三人不能相邻 ${counts.adjacentGroupForbidden.length} 条、前排 ${counts.frontRowStudents.length} 人、后排 ${counts.backRowStudents.length} 人`,
      })
    }
    if (restore.clearedSeats > 0) {
      list.push({
        tone: 'warning',
        text: `恢复后有 ${restore.clearedSeats} 个当前有人的座位会空出来（导出文件里这些位置是空座）`,
      })
    }
    if (restoreConfirming.value) {
      list.push({
        tone: 'danger',
        text: `再次确认：将用这份导出文件整表替换当前座位表的现有安排。确认后可用座位页的「撤销修改」还原。`,
      })
    } else {
      list.push({
        tone: 'info',
        text: '整表恢复：导出文件里没有安排学生的座位，恢复后一律为空——这与按行列列表逐条导入不同',
      })
    }
    return list
  }

  const current = result.value
  if (!current) return []
  const list: ImportHint[] = []
  // 被拦下的行**直接点名**（行号 + 原因）——表宽时「状态」列在最右边，不必横滚去找
  const blocked = blockedHint(current.rows)
  if (blocked) list.push(blocked)
  /*
    v3.7.5（§4.4）：多张座位表并存后，「这份表要导进哪一张」必须在按下确认之前说清。
    导入永远只写**当前方案**（本弹窗没有方案选择器），所以这里把那一份点名出来——
    预览里的「原位不动 / 换座位」也全是按它算的，表选错了，这一行是最后一道提醒。
  */
  const planName = seatStore.currentPlan?.name
  if (planName) {
    list.push({
      tone: 'info',
      text: `导入到当前座位表「${planName}」，其他座位表不受影响`,
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

/** 第二步确认才真正覆盖当前方案；失败时 store 不改动任何数据，弹窗保持打开 */
async function confirmRestore(): Promise<void> {
  const current = restorePlan.value
  if (!current || !current.ok || !restoreConfirming.value) return
  const hadPending = seatStore.pendingLogsCount > 0
  const outcome = await runLockedOperation('seat-restore', () =>
    seatStore.applySeatRestore({
      assignments: current.assignments,
      constraints: current.constraints,
    }),
  )
  if (!outcome.ok) {
    toast.danger(`恢复失败：${outcome.reason ?? '数据已变化，请刷新后重试'}`)
    return
  }
  if (hadPending) toast.info('已恢复座位：未保存的「本次调整」记录已清空')
  toast.success(
    `恢复完成：${outcome.applied} 个座位${outcome.cleared > 0 ? `，${outcome.cleared} 个座位腾空` : ''}${
      outcome.relocated > 0 ? `，${outcome.relocated} 名学生换位` : ''
    }`,
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
        <li>
          也可以直接选择本系统「导出座位图」得到的 Excel
          文件：会自动识别并<strong>整表恢复</strong>导出时的座位安排
        </li>
      </ImportIntro>
    </div>

    <ImportHints v-if="parseError" :items="errorHints" />

    <template v-if="result || restorePlan">
      <ImportFileRow
        :filename="filename"
        :sheet-note="sheetNote"
        :columns="columns"
        @reselect="pickFile"
      />

      <ImportStats :items="statItems" />
      <ImportHints :items="hints" />
      <ImportPreviewTable
        :columns="PREVIEW_COLUMNS"
        :rows="previewRows"
        :actions="restorePlan ? RESTORE_ACTIONS : ACTIONS"
      />
    </template>

    <template #footer>
      <AppButton variant="ghost" @click="close">取消</AppButton>

      <template v-if="restorePlan">
        <AppButton v-if="restoreConfirming" variant="ghost" @click="restoreConfirming = false">
          返回修改
        </AppButton>
        <AppButton
          v-if="!restoreConfirming"
          :disabled="!restorePlan.ok"
          @click="restoreConfirming = true"
        >
          恢复这份座位表
        </AppButton>
        <AppButton v-else variant="danger" :disabled="!restorePlan.ok" @click="confirmRestore">
          确认覆盖当前座位表
        </AppButton>
      </template>

      <AppButton
        v-else-if="result"
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
