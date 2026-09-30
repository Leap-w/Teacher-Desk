<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowLeft, Filter, Pencil, Trash2 } from 'lucide-vue-next'

import { AppBadge, AppButton, AppModal } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { runLockedOperation } from '@/composables/useOperationLock'
import { useHolidayStore } from '@/stores/holiday'
import { useStudentStore } from '@/stores/student'
import { useUserStore } from '@/stores/user'
import { buildXlsxBook, downloadXlsxBuffer } from '@/utils/xlsxBook'
import { HOLIDAY_STATUS_LABELS, describeHoliday, formatHolidayRange } from '@/utils/holiday'
import {
  buildHolidayRosterSheet,
  holidayExportFilename,
  type HolidayExportScope,
} from '@/utils/holidayExport'
import {
  filterRoster,
  selectAllState,
  toggleSelectAll,
  type HolidayCardFilter,
} from '@/utils/holidayQuery'
import { formatDateKey } from '@/utils/date'
import { useNow } from '@/composables/useToday'
import HolidayBatchBar from './HolidayBatchBar.vue'
import HolidayExportMenu from './HolidayExportMenu.vue'
import HolidayFilterDrawer from './HolidayFilterDrawer.vue'
import HolidayNoteModal from './HolidayNoteModal.vue'
import HolidayRosterList from './HolidayRosterList.vue'
import HolidaySelectAllBar from './HolidaySelectAllBar.vue'
import HolidayStatCards from './HolidayStatCards.vue'
import type { HolidayEntry, HolidayStatus } from '@/types/holiday'
import type { HolidayRosterFilters } from '@/utils/holidayQuery'

/**
 * HolidayDetail — 某个假期的名单与批量登记。
 *
 * **不是一个路由页**，是 `index.vue` 里换上去的一屏：详情没有自己的 URL（见方案 §六.5），
 * 刷新会回到列表——这是为了不给 CloudBase 静态托管多出一堆动态占位付的代价，
 * 而详情本来就只在「刚登记完接着核对」这一个动作里停留。
 *
 * 页面自己不做任何计数：二态人数问 `holidayStore.countsOf`、市外离校问
 * `holidayStore.outsideHomeCountOf`、名单问 `filterRoster`、落库问 `holidayStore.setStatuses`
 * / `holidayStore.setNote`。页面只负责把按钮和它们接起来（§11.1）。
 *
 * ## v3.6.2 的结构调整（规格第 14 节）
 *
 *     假期名称与信息 → [编辑] [删除] → 三张统计卡片 → 全选 → 学生名单
 *
 * 「编辑 / 删除假期」从名单**下方**移到了统计卡片**上方**：62 人的名单会把它们推到页面底部，
 * 而这两个动作与名单上的学生无关，不该被名单的长度推到看不见的地方。
 */
const props = defineProps<{ entry: HolidayEntry }>()

const emit = defineEmits<{
  back: []
  edit: []
  remove: []
}>()

const holidayStore = useHolidayStore()
const studentStore = useStudentStore()
const userStore = useUserStore()
const now = useNow()
const toast = useToast()

const holidayId = computed(() => props.entry.holiday.id)
const isWeekend = computed(() => props.entry.kind === 'weekend')

/* ---------- 名单 ---------- */

const filters = ref<HolidayRosterFilters>({ keyword: '' })
const filterOpen = ref(false)

/**
 * 顶部统计卡片的快捷筛选。它是**独立于筛选抽屉**的一维：
 * 抽屉管「姓名 / 性别 / 家庭所在地 / 亲属」，卡片管「去向」，
 * 两者 AND 组合。再点一次当前卡片即取消（不新增第四张「全部」卡片）。
 */
const card = ref<HolidayCardFilter | undefined>(undefined)

/** 二态判定：**只经 store 这一个出口**，页面不自己拼「先查老键再查新键」 */
const statusOf = (studentId: string) => holidayStore.statusIn(holidayId.value, studentId)
/** 学生级备注：同样只经 store（它建了 `学生 + 假期` 的查表，不在逐行 find 一遍） */
const noteOf = (studentId: string) => holidayStore.noteIn(holidayId.value, studentId)

const activeFilters = computed<HolidayRosterFilters>(() => ({
  ...filters.value,
  ...(card.value ? { card: card.value } : {}),
}))

const rows = computed(() =>
  filterRoster(holidayStore.activeStudents, activeFilters.value, statusOf, noteOf),
)
/** 不筛的完整名单：「全部名单」导出与「已选人数」的分母都要它 */
const allRows = computed(() =>
  filterRoster(holidayStore.activeStudents, { keyword: '' }, statusOf, noteOf),
)

const counts = computed(() => holidayStore.countsOf(holidayId.value))
/** 第三张卡片：离校 ∩ 昌都市外（不是第三种状态，只是离校里的一维） */
const outsideHomeCount = computed(() => holidayStore.outsideHomeCountOf(holidayId.value))
const staleCount = computed(() => holidayStore.staleCountOf(holidayId.value))

function toggleCard(key: HolidayCardFilter): void {
  card.value = card.value === key ? undefined : key
}

/** 有几组**抽屉里的**条件在生效（「全部」不算），决定筛选按钮上的角标 */
const activeFilterCount = computed(() => {
  const value = filters.value
  return (
    (value.keyword.trim() ? 1 : 0) +
    (value.gender ? 1 : 0) +
    (value.scope ? 1 : 0) +
    (value.relative === undefined ? 0 : 1)
  )
})

/** 名单是否被任何一路筛过（卡片或抽屉）——决定空态文案是「筛没了」还是「本来就没人」 */
const hasFilter = computed(() => activeFilterCount.value > 0 || card.value !== undefined)

/* ---------- 多选 ---------- */

const selectedIds = ref<Set<string>>(new Set())

const selectedRows = computed(() =>
  allRows.value.filter((row) => selectedIds.value.has(row.student.id)),
)

/** 当前筛选结果的 id 列表与它的全选三态（判据口径在 `selectAllState` 里，只实现一次） */
const visibleIds = computed(() => rows.value.map((row) => row.student.id))
const selectAllStage = computed(() => selectAllState(visibleIds.value, selectedIds.value))

/**
 * 选中但**不在当前筛选结果里**的人数。
 *
 * 分母是眼前这份名单，不是 `allRows`——教师看到的就是这份，说「不在当前筛选结果中」
 * 才是他能在屏幕上核对的那句话。
 */
const outsideCount = computed(() => {
  const visible = new Set(rows.value.map((row) => row.student.id))
  let count = 0
  for (const id of selectedIds.value) if (!visible.has(id)) count += 1
  return count
})

function toggle(studentId: string): void {
  const next = new Set(selectedIds.value)
  if (next.has(studentId)) next.delete(studentId)
  else next.add(studentId)
  selectedIds.value = next
}

/**
 * 全选 / 取消全选 —— **只作用于当前筛选结果**（规格第 10 节）。
 *
 * 口径在纯函数 `toggleSelectAll` 里（连「取消时只移除当前结果里的 id」那条也在那儿），
 * 页面这一层只负责把它接上选中集合。
 */
function toggleAllVisible(): void {
  selectedIds.value = toggleSelectAll(visibleIds.value, selectedIds.value)
}

function clearSelection(): void {
  selectedIds.value = new Set()
}

/** 反选 = **结果内**翻转。已选中但不在结果里的保持不动，否则反选会顺手清掉别的批次 */
function invertSelection(): void {
  const next = new Set(selectedIds.value)
  for (const row of rows.value) {
    if (next.has(row.student.id)) next.delete(row.student.id)
    else next.add(row.student.id)
  }
  selectedIds.value = next
}

/* ---------- 学生级备注 ---------- */

/**
 * 待编辑备注的学生 id。**和删除假期同一套写法**：保存后不清空——弹窗关闭有淡出动画，
 * 动画期间它仍在渲染，清掉会让名字先变空再消失（§9.8 记录项）。
 * `undefined` = 弹窗关着（保存空备注是合法操作，不能拿「空」当关闭信号）。
 */
const noteTarget = ref<string | undefined>(undefined)
const noteBusy = ref(false)

const noteStudent = computed(() => {
  const id = noteTarget.value
  if (!id) return undefined
  return allRows.value.find((row) => row.student.id === id)?.student
})

const noteValue = computed(() => (noteTarget.value ? noteOf(noteTarget.value) : ''))
const noteStatus = computed<HolidayStatus>(() =>
  noteTarget.value ? statusOf(noteTarget.value) : 'stay',
)

function askNote(studentId: string): void {
  noteTarget.value = studentId
}

async function saveNote(note: string): Promise<void> {
  const studentId = noteTarget.value
  if (!studentId) return
  noteBusy.value = true
  try {
    const changed = await runLockedOperation('holiday-note', () =>
      holidayStore.setNote(holidayId.value, studentId, note),
    )
    noteTarget.value = undefined
    toast.success(changed ? '备注已保存' : '备注没有变化')
  } finally {
    noteBusy.value = false
  }
}

/* ---------- 批量登记（先确认，再落库） ---------- */

const pendingTarget = ref<HolidayStatus | undefined>(undefined)
const batchBusy = ref(false)

const pendingCounts = computed(() =>
  pendingTarget.value
    ? holidayStore.previewStatusChange(
        holidayId.value,
        selectedRows.value.map((row) => row.student.id),
        pendingTarget.value,
      ).fromCounts
    : { home: 0, stay: 0 },
)

function askApply(target: HolidayStatus): void {
  // 选中都落在已退档学生上时（跨标签页删了人）没有可改的对象，直接说清楚
  if (selectedRows.value.length === 0) {
    toast.warning('选中的学生已不在档案中，没有可改动的对象')
    return
  }
  pendingTarget.value = target
}

/** 确认弹窗里的「其中 3 人原为离校」——数字取自预览计划，不是页面上再数一遍 */
const pendingBreakdown = computed(() => {
  const parts: string[] = []
  const from = pendingCounts.value
  for (const status of ['home', 'stay'] as const) {
    if (from[status] > 0) parts.push(`原为${HOLIDAY_STATUS_LABELS[status]} ${from[status]} 人`)
  }
  return parts.join(' · ')
})

async function confirmApply(): Promise<void> {
  const target = pendingTarget.value
  pendingTarget.value = undefined
  if (!target) return

  batchBusy.value = true
  try {
    // 一次写很多键的长事务：锁住期间不推云，解锁后补一次冲刷（§11.4）
    const changed = await runLockedOperation('holiday-batch', () =>
      holidayStore.setStatuses(
        holidayId.value,
        selectedRows.value.map((row) => row.student.id),
        target,
      ),
    )
    if (changed === 0) {
      toast.info('这几位本来就是「' + HOLIDAY_STATUS_LABELS[target] + '」，没有改动')
      return
    }
    clearSelection()
    toast.success(`已把 ${changed} 人设为「${HOLIDAY_STATUS_LABELS[target]}」`)
  } finally {
    batchBusy.value = false
  }
}

/* ---------- 导出 ---------- */

const exportBusy = ref(false)

async function runExport(scope: HolidayExportScope): Promise<void> {
  if (exportBusy.value) return
  const target = scope === 'current' ? rows.value : allRows.value
  if (target.length === 0) {
    toast.warning(
      scope === 'current' ? '当前筛选结果里没有人，先放宽条件再导出' : '这个假期还没有在读学生',
    )
    return
  }

  exportBusy.value = true
  try {
    const sheet = buildHolidayRosterSheet(props.entry.holiday.name, target, studentStore.nameCounts)
    const buffer = await buildXlsxBook([sheet])
    if (!buffer) throw new Error('工作簿生成失败')
    const filename = holidayExportFilename(
      userStore.profile.className,
      props.entry.holiday.name,
      formatDateKey(now.value),
    )
    if (!downloadXlsxBuffer(buffer, filename)) throw new Error('浏览器未接受下载')
    toast.success(`已导出 ${target.length} 人的名单`)
  } catch (error) {
    console.error('[holiday export] 导出失败：', error)
    toast.danger('导出失败：请刷新后重试')
  } finally {
    exportBusy.value = false
  }
}
</script>

<template>
  <div class="detail-page">
    <header class="detail-head">
      <button type="button" class="back-btn" aria-label="返回假期列表" @click="emit('back')">
        <ArrowLeft :size="18" :stroke-width="2" aria-hidden="true" />
      </button>
      <div class="head-text">
        <div class="head-title-line">
          <h1 class="head-title">{{ entry.holiday.name }}</h1>
          <AppBadge v-if="isWeekend" variant="neutral" size="sm">周末</AppBadge>
        </div>
        <p class="head-meta">
          {{ formatHolidayRange(entry.holiday) }}
          <span class="dot" aria-hidden="true">·</span>
          {{ describeHoliday(entry.holiday, holidayStore.todayKey) }}
        </p>
      </div>
    </header>

    <p v-if="entry.holiday.note" class="holiday-note">{{ entry.holiday.note }}</p>

    <!-- ===== 编辑 / 删除：**在统计卡片与名单之上**（v3.6.2 规格第 14 节） ===== -->
    <!-- 虚拟周末不可编辑 / 删除：日期由日历决定，删了下次刷新还会回来 -->
    <div v-if="!isWeekend" class="action-row">
      <AppButton variant="ghost" size="sm" @click="emit('edit')">
        <Pencil :size="15" :stroke-width="2" aria-hidden="true" />
        编辑
      </AppButton>
      <AppButton variant="danger" size="sm" @click="emit('remove')">
        <Trash2 :size="15" :stroke-width="2" aria-hidden="true" />
        删除
      </AppButton>
    </div>

    <!-- ===== 三张统计卡片：也是三档快捷筛选（规格第 7–9 节） ===== -->
    <HolidayStatCards
      :home="counts.home"
      :stay="counts.stay"
      :outside="outsideHomeCount"
      :active="card"
      @select="toggleCard"
    />

    <p v-if="staleCount" class="stale-note">
      另有 {{ staleCount }} 条已不在档案的登记（不计入上面的人数），改这些学生的去向请先恢复档案。
    </p>

    <!-- ===== 工具行：筛选 + 导出 ===== -->
    <div class="tool-row">
      <AppButton variant="ghost" size="sm" @click="filterOpen = true">
        <Filter :size="15" :stroke-width="2" aria-hidden="true" />
        筛选<span v-if="activeFilterCount" class="filter-badge">{{ activeFilterCount }}</span>
      </AppButton>
      <HolidayExportMenu
        :current-count="rows.length"
        :all-count="allRows.length"
        :busy="exportBusy"
        @request="runExport"
      />
    </div>

    <!-- ===== 名单：全选 + 学生列表 ===== -->
    <section class="roster-section">
      <h2 class="section-title">
        名单<span class="section-sub"> {{ rows.length }} / {{ allRows.length }} 人 </span>
      </h2>

      <HolidaySelectAllBar
        class="roster-select-all"
        :state="selectAllStage"
        :visible-total="rows.length"
        :selected-count="selectedIds.size"
        :outside-count="outsideCount"
        @toggle-all="toggleAllVisible"
      />

      <HolidayRosterList
        :rows="rows"
        :selected-ids="selectedIds"
        :name-counts="studentStore.nameCounts"
        :filtered="hasFilter"
        @toggle="toggle"
        @edit-note="askNote"
      />
    </section>

    <!-- 批量条只在有选中时出现，并且给名单留出它占的高度，避免最后一行被压在下面 -->
    <div v-if="selectedIds.size > 0" class="batch-spacer" aria-hidden="true" />
    <HolidayBatchBar
      v-if="selectedIds.size > 0"
      :selected-count="selectedIds.size"
      :outside-count="outsideCount"
      :busy="batchBusy"
      @clear="clearSelection"
      @invert="invertSelection"
      @apply="askApply"
    />

    <HolidayFilterDrawer v-model="filterOpen" :filters="filters" @apply="filters = $event" />

    <HolidayNoteModal
      :model-value="noteTarget !== undefined"
      :student="noteStudent"
      :status="noteStatus"
      :note="noteValue"
      :name-counts="studentStore.nameCounts"
      :busy="noteBusy"
      @update:model-value="noteTarget = undefined"
      @save="saveNote"
    />

    <AppModal
      :model-value="pendingTarget !== undefined"
      :title="`批量设为「${pendingTarget ? HOLIDAY_STATUS_LABELS[pendingTarget] : ''}」`"
      :width="380"
      @update:model-value="pendingTarget = undefined"
    >
      <p class="confirm-text">
        把选中的
        <strong>{{ selectedRows.length }}</strong>
        人设为「
        <strong>{{ pendingTarget ? HOLIDAY_STATUS_LABELS[pendingTarget] : '' }}</strong>
        」？<template v-if="pendingBreakdown"> <br />其中 {{ pendingBreakdown }}。 </template>
        <br />学生级备注会保留，其他学生（包括已退档的）一条记录都不会动。
      </p>
      <template #footer>
        <AppButton variant="ghost" @click="pendingTarget = undefined">取消</AppButton>
        <AppButton :loading="batchBusy" @click="confirmApply">确认修改</AppButton>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.detail-page {
  padding-bottom: var(--space-4);
}

.detail-head {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  margin-bottom: var(--spacing-lg);
}

.back-btn {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-button);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.back-btn:hover {
  background: var(--color-fill-disabled);
}

.back-btn:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.head-text {
  min-width: 0;
}

.head-title-line {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.head-title {
  font-size: var(--font-h2);
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.01em;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.head-meta {
  margin-top: var(--space-1);
  font-size: var(--font-secondary);
  color: var(--color-text-tertiary);
}

.dot {
  margin: 0 var(--space-1);
}

.holiday-note {
  margin-bottom: var(--spacing-lg);
  padding: var(--space-3);
  background: var(--color-fill-disabled);
  border-radius: var(--radius-md);
  font-size: var(--font-secondary);
  line-height: 1.6;
  color: var(--color-text-secondary);
  white-space: pre-wrap;
}

/* 编辑 / 删除：紧跟在假期信息下面，不被名单长度推到页面底部 */
.action-row {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--spacing-lg);
}

.stale-note {
  margin-top: var(--space-3);
  font-size: var(--font-caption);
  color: var(--color-text-faint);
}

.tool-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-top: var(--spacing-lg);
}

.filter-badge {
  margin-left: 4px;
  padding: 0 5px;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  color: var(--color-text-inverse);
  font-size: var(--font-caption);
}

.roster-section {
  margin-top: var(--spacing-lg);
}

.section-title {
  margin-bottom: var(--spacing-md);
  font-size: var(--text-xl);
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.01em;
  color: var(--color-text-primary);
}

.section-sub {
  margin-left: var(--space-2);
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-normal);
  color: var(--color-text-tertiary);
}

.roster-select-all {
  margin-bottom: var(--space-3);
}

/* 批量条是 fixed，占位块保证最后一行不被压在它下面 */
.batch-spacer {
  height: 116px;
}

.confirm-text {
  font-size: var(--text-sm);
  line-height: 1.7;
  color: var(--color-text-secondary);
}

.confirm-text strong {
  color: var(--color-text);
}
</style>
