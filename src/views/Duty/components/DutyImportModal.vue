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
import { useDutyStore } from '@/stores/duty'
import { useStudentStore } from '@/stores/student'
import {
  DUTY_ARRANGE_HEADERS,
  DUTY_ARRANGE_HINT,
  DUTY_ARRANGE_SAMPLE,
  DUTY_GROUP_HEADERS,
  DUTY_GROUP_HINT,
  DUTY_GROUP_SAMPLE,
  parseDutyArrangeRows,
  parseDutyGroupRows,
  planDutyArrangeImport,
  planDutyGroupImport,
} from '@/services/dutyImport'
import { describeRotation } from '@/utils/duty'

/**
 * 值日 Excel 导入弹窗（V1.1.5）：`mode = 'groups'` 导入分组、`'arrange'` 导入安排。
 * 与座位 / 学生 / 课程 / 工作导入同款流程：选择 → 解析 → 校验 → 预览 → 确认 →
 * **一次性写入**；有错禁止确认、取消不写。
 *
 * v3.5.0：样式与取文件的管道全部与座位导入共用；并补上 `runLockedOperation`——
 * 发布清单 §4 要求所有导入在写入期间暂停同步、写完自动补推一次，这一处过去是漏的。
 */
interface Props {
  modelValue: boolean
  mode: 'groups' | 'arrange'
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const toast = useToast()
const dutyStore = useDutyStore()
const studentStore = useStudentStore()

const ACTION_LABELS: Record<string, ImportActionMeta> = {
  assign: { label: '可导入', tone: 'ok' },
  blocked: { label: '已拦下', tone: 'bad' },
}

const GROUP_COLUMNS: readonly ImportPreviewColumn[] = [
  { key: 'group', label: '组别' },
  { key: 'studentNo', label: '学号' },
  { key: 'name', label: '姓名' },
  { key: 'change', label: '归属' },
]

const ARRANGE_COLUMNS: readonly ImportPreviewColumn[] = [
  { key: 'date', label: '日期' },
  { key: 'weekday', label: '星期' },
  { key: 'group', label: '组别' },
]

const fileInput = ref<HTMLInputElement>()
const groupPlan = ref<ReturnType<typeof planDutyGroupImport> | null>(null)
const arrangePlan = ref<ReturnType<typeof planDutyArrangeImport> | null>(null)

const isGroups = computed(() => props.mode === 'groups')
const HINT = computed(() => (isGroups.value ? DUTY_GROUP_HINT : DUTY_ARRANGE_HINT))
const HEADERS = computed(() => (isGroups.value ? DUTY_GROUP_HEADERS : DUTY_ARRANGE_HEADERS))
const SAMPLE = computed(() => (isGroups.value ? DUTY_GROUP_SAMPLE : DUTY_ARRANGE_SAMPLE))
const FILE = computed(() => (isGroups.value ? '值日分组导入模板' : '值日安排导入模板'))
const SHEET = computed(() => (isGroups.value ? '值日分组' : '值日安排'))
const LEAD = computed(() =>
  isGroups.value
    ? '选择一份 Excel 值日分组表（.xlsx / .xls），第一行为表头。'
    : '选择一份 Excel 值日安排表（.xlsx / .xls），第一行为表头。',
)

const sheet = useSheetImport({
  fileInput,
  // 两种模式共用一个词：`noun` 只在「文件太大」那条提示里出现
  noun: '值日表',
  parse: (rows) => {
    if (isGroups.value) {
      const parsed = parseDutyGroupRows(rows)
      if (!parsed.ok) return { ok: false, error: parsed.error }
      groupPlan.value = planDutyGroupImport(
        parsed.rows,
        studentStore.activeStudents,
        dutyStore.groups,
      )
      return { ok: true, columns: parsed.columns }
    }
    const parsed = parseDutyArrangeRows(rows)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    arrangePlan.value = planDutyArrangeImport(parsed.rows, dutyStore.groups, dutyStore.settings)
    return { ok: true, columns: parsed.columns }
  },
  reset: () => {
    groupPlan.value = null
    arrangePlan.value = null
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

const canConfirm = computed(() => {
  if (isGroups.value) {
    const plan = groupPlan.value
    return plan !== null && plan.errorCount === 0 && plan.importable > 0
  }
  const plan = arrangePlan.value
  return plan !== null && plan.errorCount === 0 && plan.importable > 0
})

const statItems = computed<ImportStat[]>(() => {
  if (isGroups.value) {
    const plan = groupPlan.value
    if (!plan) return []
    return [
      { value: plan.total, label: '数据行' },
      { value: plan.importable, label: '可导入', tone: 'ok' },
      { value: plan.blocked, label: '被拦下', tone: plan.blocked > 0 ? 'bad' : undefined },
      { value: plan.plan.updates.length, label: '更新组' },
      { value: plan.groupsCreated, label: '新建组' },
    ]
  }
  const plan = arrangePlan.value
  if (!plan) return []
  return [
    { value: plan.total, label: '数据行' },
    { value: plan.importable, label: '可导入', tone: 'ok' },
    { value: plan.blocked, label: '被拦下', tone: plan.blocked > 0 ? 'bad' : undefined },
    { value: plan.days, label: '覆盖值日日' },
  ]
})

const hints = computed<ImportHint[]>(() => {
  if (isGroups.value) {
    const plan = groupPlan.value
    if (!plan) return []
    const list: ImportHint[] = []
    const blocked = blockedHint(plan.rows)
    if (blocked) list.push(blocked)
    if (plan.blankRows > 0) {
      list.push({ tone: 'info', text: `${plan.blankRows} 行是空行，已自动跳过` })
    }
    list.push({
      tone: 'info',
      text: '确认后只写表格里列出的组；未涉及的分组保持原样。组序 = 轮换顺序，新建的组排在队尾',
    })
    return list
  }
  const plan = arrangePlan.value
  if (!plan) return []
  const list: ImportHint[] = []
  const blocked = blockedHint(plan.rows)
  if (blocked) list.push(blocked)
  if (plan.blankRows > 0) {
    list.push({ tone: 'info', text: `${plan.blankRows} 行是空行，已自动跳过` })
  }
  list.push({ tone: 'info', text: `轮换起点：${plan.plan.startDate}` })
  list.push({
    tone: 'info',
    text: `安排会换算成「轮换起点 + 组顺序」（组顺序 = 表里各组出现的先后，未提到的组排在其后），周末${plan.plan.includeWeekend ? '照常排' : '不排'}`,
  })
  return list
})

const previewRows = computed<ImportPreviewRow[]>(() => {
  if (isGroups.value) {
    return (groupPlan.value?.rows ?? []).map((row) => ({
      rowNumber: row.rowNumber,
      action: row.action,
      cells: {
        group: row.groupName ?? row.groupNameText,
        studentNo: row.studentNo,
        name: row.studentLabel ?? row.name,
        // 被拦下的行不会写进去，没有「归属」可言
        change:
          row.action === 'blocked' || row.create === undefined
            ? ''
            : row.create
              ? '新建组'
              : '并入现有组',
      },
      errors: row.errors,
      warnings: row.warnings,
    }))
  }
  return (arrangePlan.value?.rows ?? []).map((row) => ({
    rowNumber: row.rowNumber,
    action: row.action,
    cells: {
      date: row.dateText,
      weekday: row.weekdayText,
      group: row.groupName ?? row.groupNameText,
    },
    errors: row.errors,
    warnings: row.warnings,
  }))
})

watch(
  () => props.modelValue,
  (open) => {
    if (open) return
    sheet.clear()
  },
)

async function onConfirm(): Promise<void> {
  if (!canConfirm.value) return
  // RC-01 / RC-02：导入期间暂停同步，写完自动补推一次（与座位 / 学生导入同一纪律）
  if (isGroups.value) {
    const plan = groupPlan.value
    if (!plan) return
    const outcome = await runLockedOperation('duty-group-import', () =>
      dutyStore.applyDutyGroupImport(plan.plan),
    )
    if (!outcome.ok) {
      toast.danger(outcome.reason)
      return
    }
    toast.success(
      `导入完成：更新 ${outcome.updated} 个组、新建 ${outcome.created} 个组，共 ${outcome.members} 名组员`,
    )
  } else {
    const plan = arrangePlan.value
    if (!plan) return
    const outcome = await runLockedOperation('duty-arrange-import', () =>
      dutyStore.applyDutyArrangeImport(plan.plan),
    )
    if (!outcome.ok) {
      toast.danger(outcome.reason)
      return
    }
    toast.success(
      `导入完成：轮换从 ${outcome.startDate} 起（${describeRotation(dutyStore.settings, dutyStore.groups)}）`,
    )
  }
  emit('update:modelValue', false)
}

function close(): void {
  emit('update:modelValue', false)
}
</script>

<template>
  <AppModal
    :model-value="modelValue"
    :title="isGroups ? '从 Excel 导入分组' : '从 Excel 导入安排'"
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
        :lead="LEAD"
        :filename="FILE"
        :sheet-name="SHEET"
        :headers="HEADERS"
        :sample="SAMPLE"
        :note="
          isGroups
            ? '上面的例子表示：学号 20250101 / 20250102 的两人在第 1 组，20250104 在第 2 组。'
            : '上面的例子表示：9 月 14 日由第 1 组值日、15 日第 2 组、16 日第 3 组，依次轮下去。'
        "
      >
        <li>{{ HINT }}</li>
      </ImportIntro>
    </div>

    <ImportHints v-if="parseError" :items="errorHints" />

    <template v-if="groupPlan || arrangePlan">
      <ImportFileRow
        :filename="filename"
        :sheet-note="sheetNote"
        :columns="columns"
        @reselect="pickFile"
      />

      <ImportStats :items="statItems" />
      <ImportHints :items="hints" />
      <ImportPreviewTable
        :columns="isGroups ? GROUP_COLUMNS : ARRANGE_COLUMNS"
        :rows="previewRows"
        :actions="ACTION_LABELS"
      />
    </template>

    <template #footer>
      <AppButton variant="ghost" @click="close">取消</AppButton>
      <AppButton v-if="!groupPlan && !arrangePlan" :disabled="busy" @click="pickFile">
        {{ busy ? '读取中…' : '选择 Excel 文件' }}
      </AppButton>
      <AppButton v-else :disabled="!canConfirm" @click="onConfirm">
        确认导入
        {{ isGroups ? (groupPlan?.importable ?? 0) : (arrangePlan?.importable ?? 0) }} 行
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
