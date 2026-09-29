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
import { filterRoster } from '@/utils/holidayQuery'
import { formatDateKey } from '@/utils/date'
import { useNow } from '@/composables/useToday'
import HolidayBatchBar from './HolidayBatchBar.vue'
import HolidayExportMenu from './HolidayExportMenu.vue'
import HolidayFilterDrawer from './HolidayFilterDrawer.vue'
import HolidayRosterList from './HolidayRosterList.vue'
import type { HolidayEntry, HolidayStatus } from '@/types/holiday'
import type { HolidayRosterFilters } from '@/utils/holidayQuery'

/**
 * HolidayDetail — 某个假期的名单与批量登记。
 *
 * **不是一个路由页**，是 `index.vue` 里换上去的一屏：详情没有自己的 URL（见方案 §六.5），
 * 刷新会回到列表——这是为了不给 CloudBase 静态托管多出一堆动态占位付的代价，
 * 而详情本来就只在「刚登记完接着核对」这一个动作里停留。
 *
 * 页面自己不做任何计数：三态人数问 `holidayStore.countsOf`，名单问 `filterRoster`，
 * 落库问 `holidayStore.setStatuses`。页面只负责把按钮和它们接起来（§11.1）。
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

/** 三态判定：**只经 store 这一个出口**，页面不自己拼「先查老键再查新键」 */
const statusOf = (studentId: string) => holidayStore.statusIn(holidayId.value, studentId)

const rows = computed(() => filterRoster(holidayStore.activeStudents, filters.value, statusOf))
/** 不筛的完整名单：「全选」的全是按筛选结果算的，但「全部名单」导出与选中人数的分母都要它 */
const allRows = computed(() => filterRoster(holidayStore.activeStudents, { keyword: '' }, statusOf))

const counts = computed(() => holidayStore.countsOf(holidayId.value))
const staleCount = computed(() => holidayStore.staleCountOf(holidayId.value))

/** 有几组条件在生效（「全部」不算），决定筛选按钮上的角标 */
const activeFilterCount = computed(() => {
  const value = filters.value
  return (
    (value.keyword.trim() ? 1 : 0) +
    (value.gender ? 1 : 0) +
    (value.scope ? 1 : 0) +
    (value.relative === undefined ? 0 : 1) +
    (value.status ? 1 : 0)
  )
})

/* ---------- 多选 ---------- */

const selectedIds = ref<Set<string>>(new Set())

const selectedRows = computed(() =>
  allRows.value.filter((row) => selectedIds.value.has(row.student.id)),
)

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

/** 全选 = 用**当前筛选结果**替换选中（不是追加：「全选」这个词在教师心里就是「屏幕上这些都要」） */
function selectAll(): void {
  selectedIds.value = new Set(rows.value.map((row) => row.student.id))
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
    : { home: 0, stay: 0, unregistered: 0 },
)

function askApply(target: HolidayStatus): void {
  // 选中都落在已退档学生上时（跨标签页删了人）没有可改的对象，直接说清楚
  if (selectedRows.value.length === 0) {
    toast.warning('选中的学生已不在档案中，没有可改动的对象')
    return
  }
  pendingTarget.value = target
}

/** 确认弹窗里的「其中 3 人原为回家」——数字取自预览计划，不是页面上再数一遍 */
const pendingBreakdown = computed(() => {
  const parts: string[] = []
  const from = pendingCounts.value
  for (const status of ['home', 'stay', 'unregistered'] as const) {
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

    <!-- ===== 三态统计条（规格第 3 节：替代原「家庭地区分布」卡） ===== -->
    <section class="stat-bar" aria-label="假期去向统计">
      <div class="stat is-home">
        <span class="stat-num">{{ counts.home }}</span>
        <span class="stat-label">回家</span>
      </div>
      <div class="stat is-stay">
        <span class="stat-num">{{ counts.stay }}</span>
        <span class="stat-label">留校</span>
      </div>
      <div class="stat is-blank">
        <span class="stat-num">{{ counts.unregistered }}</span>
        <span class="stat-label">未登记</span>
      </div>
    </section>

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

    <section class="roster-section">
      <h2 class="section-title">
        名单<span class="section-sub"> {{ rows.length }} / {{ allRows.length }} 人 </span>
      </h2>
      <HolidayRosterList
        :rows="rows"
        :selected-ids="selectedIds"
        :name-counts="studentStore.nameCounts"
        :filtered="activeFilterCount > 0"
        @toggle="toggle"
      />
    </section>

    <!-- 虚拟周末不可编辑 / 删除：日期由日历决定，删了下次刷新还会回来 -->
    <div v-if="!isWeekend" class="danger-row">
      <AppButton variant="ghost" size="sm" @click="emit('edit')">
        <Pencil :size="15" :stroke-width="2" aria-hidden="true" />
        编辑这个假期
      </AppButton>
      <AppButton variant="danger" size="sm" @click="emit('remove')">
        <Trash2 :size="15" :stroke-width="2" aria-hidden="true" />
        删除这个假期
      </AppButton>
    </div>

    <!-- 批量条只在有选中时出现，并且给名单留出它占的高度，避免最后一行被压在下面 -->
    <div v-if="selectedIds.size > 0" class="batch-spacer" aria-hidden="true" />
    <HolidayBatchBar
      v-if="selectedIds.size > 0"
      :selected-count="selectedIds.size"
      :outside-count="outsideCount"
      :busy="batchBusy"
      @select-all="selectAll"
      @clear="clearSelection"
      @invert="invertSelection"
      @apply="askApply"
    />

    <HolidayFilterDrawer v-model="filterOpen" :filters="filters" @apply="filters = $event" />

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
        <template v-if="pendingTarget === 'unregistered'">
          <br />这会删掉他们的登记记录，之后这一期的名单上他们就是「未登记」。
        </template>
        <br />其他学生（包括已退档的）一条记录都不会动。
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

.stat-bar {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-2);
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: var(--space-3) var(--space-2);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  background: var(--color-bg-white);
}

.stat-num {
  font-size: var(--text-xl);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-primary);
}

.stat-label {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.stat.is-home {
  background: var(--color-primary-soft);
  border-color: transparent;
}

.stat.is-stay {
  background: var(--color-success-soft);
  border-color: transparent;
}

.stat.is-blank {
  background: var(--color-fill-disabled);
  border-color: transparent;
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

.danger-row {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--spacing-lg);
  padding-top: var(--spacing-lg);
  border-top: 1px solid var(--color-border-light);
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
