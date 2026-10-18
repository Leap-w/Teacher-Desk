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
import { detectSeatMapWorkbook, planSeatMapImport } from '@/services/seatMapImport'
import type { ParsedSeatMap, SeatMapImportPlan } from '@/services/seatMapImport'
import { useSeatStore } from '@/stores/seat'
import { useStudentStore } from '@/stores/student'

/**
 * Excel 座位导入弹窗（V1.1.2 Phase 1；v3.7.6 起支持座位图，本次改为新建座位表）。
 *
 * **五个导入弹窗的样式基准**——首屏说明区 / 上传卡 / 已选文件行 / 统计卡 /
 * 提示条 / 逐行预览表全部走 `components/ui` 的共享实现，取文件的管道走
 * `useSheetImport`，其余四个弹窗照着这一份对齐。
 *
 * 两种导入模式由文件内容自动判断，入口只有一个：
 *   - **行列列表**（既有行为）：逐条应用，表格没提到的座位保持原样；空座行跳过；
 *   - **座位图**：隐藏数据与可见图一致时读隐藏数据，不一致时按可见图；
 *     按图**新建一张座位表并切换过去**，现有所有座位表原样保留。外部手工座位图
 *     只要版式符合模板几何也能识别。
 *
 * 流程严格按需求：选择文件 → 读取 → 解析 → 校验 → 预览 → 用户确认 → 一次性写入。
 * **关闭弹窗 / 取消一律不写入**；**存在错误时确认按钮禁用**（错误数据绝不落库）。
 * 落库只经 `seatStore.applySeatImport()` / `seatStore.createPlanFromSeatMap()`——
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

/** 座位图模式没有「相对当前方案的变化」：新建一张表，只列座位与学生 */
const MAP_PREVIEW_COLUMNS: readonly ImportPreviewColumn[] = [
  { key: 'seat', label: '座位' },
  { key: 'studentNo', label: '学号' },
  { key: 'name', label: '姓名' },
]

const ACTIONS: Record<string, ImportActionMeta> = {
  assign: { label: '可导入', tone: 'ok' },
  blocked: { label: '已拦下', tone: 'bad' },
}

/** 座位图模式的徽标：这次导入会新建一张座位表，不是往当前表里塞 */
const MAP_ACTIONS: Record<string, ImportActionMeta> = {
  import: { label: '可导入', tone: 'ok' },
  blocked: { label: '已拦下', tone: 'bad' },
}

const fileInput = ref<HTMLInputElement>()
const parsed = ref<ParsedSeatRow[] | undefined>(undefined)
/** 全空行条数（解析时统计，预览里说一句） */
const blankRows = ref(0)
/** 空座行条数（只有坐标、没有学生；跳过并计数） */
const emptySeatRows = ref(0)
/** 识别为座位图时的解析结果（与 `parsed` 互斥） */
const mapParsed = ref<ParsedSeatMap | undefined>(undefined)

/** 导出时间（ISO）→ 本地「YYYY-MM-DD HH:mm」；坏值不显示，不编一个时间出来 */
function formatExportedAt(value: string | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 已选文件行的工作表说明：说清读的是隐藏数据表还是可视化版面、来源方案是哪一份 */
function mapSourceNote(data: ParsedSeatMap): string {
  const parts: string[] = []
  if (data.source === 'metadata') {
    parts.push('已读取导出数据（隐藏工作表）')
  } else {
    const why =
      data.visualFallback === 'unreadable'
        ? '隐藏数据无法读取'
        : data.visualFallback === 'mismatch'
          ? '隐藏数据与座位图不一致'
          : '文件没有隐藏数据'
    parts.push(`已按「${data.sourceSheet}」版面识别（${why}）`)
  }
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
    emptySeatRows.value = parsedRows.emptySeatRows
    return { ok: true, columns: parsedRows.columns }
  },
  /*
   * 先按整个工作簿识别。`undefined` = 不是座位图，继续走上面的行列列表解析，
   * 旧文件的导入行为一个字节都不变。
   */
  parseWorkbook: (workbook) => {
    const detection = detectSeatMapWorkbook(workbook, seatStore.config)
    if (detection.kind === 'none') return undefined
    if (detection.kind === 'error') return { ok: false, error: detection.error }
    mapParsed.value = detection.parsed
    parsed.value = undefined
    blankRows.value = 0
    emptySeatRows.value = 0
    return {
      ok: true,
      columns: [],
      sheetNote: mapSourceNote(detection.parsed),
    }
  },
  reset: () => {
    parsed.value = undefined
    blankRows.value = 0
    emptySeatRows.value = 0
    mapParsed.value = undefined
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

/** Excel 文件名 → 新座位表名（去掉扩展名；重名交给 store 加序号） */
function planNameFromFile(value: string): string {
  return value.replace(/\.(xlsx|xls)$/i, '').trim()
}

/**
 * 预览里承诺的新表名必须与落库时一致：`nextUniquePlanName` 是同一份实现，
 * 中途在别处新建了同名方案时这里会跟着重算。
 */
const mapPlanName = computed(() =>
  mapParsed.value ? seatStore.nextUniquePlanName(planNameFromFile(filename.value)) : '',
)

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
  !mapParsed.value && parsed.value
    ? planSeatImport(
        parsed.value,
        studentStore.activeStudents,
        seatStore.currentSeats,
        blankRows.value,
        emptySeatRows.value,
      )
    : undefined,
)

/**
 * 座位图计划同样是 computed：预览里的「可导入 / 被拦下」必须与落库那一次
 * 基于同一份学生名单，中途别处改了数据也能立刻反映出来。
 */
const mapPlan = computed<SeatMapImportPlan | undefined>(() =>
  mapParsed.value
    ? planSeatMapImport(mapParsed.value, studentStore.activeStudents, seatStore.config)
    : undefined,
)

const statItems = computed<ImportStat[]>(() => {
  const map = mapPlan.value
  if (map) {
    return [
      { value: map.layout.totalSeats, label: '座位总数' },
      { value: map.occupiedSeats, label: '已就座' },
      { value: map.emptySeats, label: '空座' },
      { value: map.assignable, label: '可导入', tone: 'ok' },
      {
        value: map.errorCount,
        label: '错误',
        tone: map.errorCount > 0 ? 'bad' : undefined,
      },
    ]
  }

  const current = result.value
  if (!current) return []
  return [
    { value: current.total, label: '总行数' },
    { value: current.validSeats, label: '有效座位' },
    { value: current.assignable, label: '可导入', tone: 'ok' },
    ...(current.emptySeatRows > 0 ? [{ value: current.emptySeatRows, label: '空座行' }] : []),
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
  const map = mapPlan.value
  if (map) {
    return map.rows.map((row) => ({
      rowNumber: row.rowNumber,
      action: row.action,
      cells: {
        seat: row.seatLabel,
        studentNo: row.studentNo,
        name: row.studentLabel ?? row.name,
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
  const map = mapPlan.value
  if (map) {
    const list: ImportHint[] = []
    const blocked = blockedHint(map.rows)
    if (blocked) list.push(blocked)
    for (const text of map.errors) list.push({ tone: 'danger', text })

    list.push({
      tone: 'info',
      text: `将新建座位表「${mapPlanName.value}」并切换过去；现有 ${seatStore.plans.length} 张座位表原样保留`,
    })

    // 没有隐藏数据时服务层不会额外写提示；这里把「按姓名匹配」的代价说清楚
    if (map.source === 'visual' && mapParsed.value?.visualFallback === 'missing') {
      list.push({
        tone: 'warning',
        text: '文件里没有隐藏数据，已按座位图版面识别：只能按格子里的姓名匹配学生，学号与排座约束无法恢复；重名会被拦下。',
      })
    }

    for (const text of map.warnings) {
      // 视觉来源的「没有排座约束」已由上面的来源说明覆盖，不再重复
      if (map.source === 'visual' && text.startsWith('这是按座位图版面识别的')) continue
      list.push({ tone: 'info', text })
    }

    if (map.source === 'metadata' && map.constraints) {
      const counts = map.constraints
      const total =
        counts.sameDeskForbidden.length +
        counts.adjacentGroupForbidden.length +
        counts.frontRowStudents.length +
        counts.backRowStudents.length
      list.push({
        tone: 'info',
        text:
          total === 0
            ? '将同时导入排座约束：导出文件里没有约束（新座位表的约束为空）'
            : `将同时导入排座约束：不能同桌 ${counts.sameDeskForbidden.length} 条、三人不能相邻 ${counts.adjacentGroupForbidden.length} 条、前排 ${counts.frontRowStudents.length} 人、后排 ${counts.backRowStudents.length} 人`,
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
  if (current.emptySeatRows > 0) {
    list.push({
      tone: 'info',
      text: `${current.emptySeatRows} 行是空座（未填学生），已跳过`,
    })
  }
  if (current.emptySeatRows > 0 && current.assignable === 0) {
    list.push({ tone: 'warning', text: '表格里没有安排学生，没有可导入的座位' })
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

/** 按座位图新建一张座位表；失败时 store 不改动任何数据，弹窗保持打开 */
async function confirmMapImport(): Promise<void> {
  const current = mapPlan.value
  if (!current || !current.ok) return
  const hadPending = seatStore.pendingLogsCount > 0
  const outcome = await runLockedOperation('seat-map-import', () =>
    seatStore.createPlanFromSeatMap({
      baseName: planNameFromFile(filename.value),
      assignments: current.assignments,
      constraints: current.constraints,
    }),
  )
  if (!outcome.ok) {
    toast.danger(`创建座位表失败：${outcome.reason ?? '数据已变化，请刷新后重试'}`)
    return
  }
  if (hadPending) toast.info('已创建座位表：未保存的「本次调整」记录已清空')
  toast.success(`已创建座位表「${outcome.planName}」：${outcome.applied} 个座位`)
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
        <li>只填行列、不填学生表示<strong>空座</strong>：导入时会跳过，不会清空现有座位</li>
        <li>
          也可以直接选择 Excel <strong>座位图</strong>（本系统「导出座位图」得到的文件，
          或版式相同的<strong>手工座位图</strong>）：会按图<strong>新建一张座位表</strong>，
          现有座位表原样保留
        </li>
      </ImportIntro>
    </div>

    <ImportHints v-if="parseError" :items="errorHints" />

    <template v-if="result || mapPlan">
      <ImportFileRow
        :filename="filename"
        :sheet-note="sheetNote"
        :columns="columns"
        @reselect="pickFile"
      />

      <ImportStats :items="statItems" />
      <ImportHints :items="hints" />
      <ImportPreviewTable
        :columns="mapPlan ? MAP_PREVIEW_COLUMNS : PREVIEW_COLUMNS"
        :rows="previewRows"
        :actions="mapPlan ? MAP_ACTIONS : ACTIONS"
      />
    </template>

    <template #footer>
      <AppButton variant="ghost" @click="close">取消</AppButton>

      <AppButton v-if="mapPlan" :disabled="!mapPlan.ok" @click="confirmMapImport">
        创建座位表（{{ mapPlan.assignable }} 个座位）
      </AppButton>

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
