<script setup lang="ts">
import { computed, ref } from 'vue'
import { Plus } from 'lucide-vue-next'

import RegisterPointModal from '@/components/flow/RegisterPointModal.vue'
import { AppButton, AppModal } from '@/components/ui'
import { useNow } from '@/composables/useToday'
import { useToast } from '@/composables/useToast'
import { useDutyStore } from '@/stores/duty'
import { useLeaveStore } from '@/stores/leave'
import { formatDateKey } from '@/utils/date'
import { formatLeavePeriod } from '@/utils/leave'
import { REGISTER_MODE_LABELS, formatDayPoint, halfDayKey } from '@/utils/point'
import type { LeaveInput, LeaveRecord } from '@/types/leave'
import type { DayPoint, RegisterMode } from '@/types/point'
import {
  LEAVE_FILTER_LABELS,
  filterLeaveRecords,
  isLeaveThisWeek,
  isLeaveToday,
  sortLeaveRecords,
} from '@/utils/leave'
import type { LeaveFilter } from '@/utils/leave'
import CurrentLeaveList from './components/CurrentLeaveList.vue'
import LeaveFormDrawer from './components/LeaveFormDrawer.vue'
import LeaveHistorySection from './components/LeaveHistorySection.vue'
import LeaveStats from './components/LeaveStats.vue'
import LeaveTimeline from './components/LeaveTimeline.vue'
import type { LeaveTimelineEvent } from './components/LeaveTimelineItem.vue'
import SettingsEntryButton from '@/components/layout/SettingsEntryButton.vue'

/**
 * 请假记录中心（V2.0.5-alpha · Phase UI-4C，Record First）：
 * 流程 = 学生线下请假 → 班主任线下签字 → 这里记录 → 返校核对。
 * 四层：今日概览（统计）→ 请假中（校外未返校，第一屏重点）→ 今日时间轴 → 历史记录。
 * 数据全部来自 Leave Store 的真实派生；登记 / 编辑 / 删除逻辑一行未动。
 */
const leaveStore = useLeaveStore()
const dutyStore = useDutyStore()
const toast = useToast()
/** 今天（共享时钟，跨零点自动翻篇；与 store 的 monthLeaveCount 同一口径） */
const now = useNow()
const today = computed(() => formatDateKey(now.value))

const keyword = ref('')
const filter = ref<LeaveFilter>('all')

const FILTER_OPTIONS = Object.entries(LEAVE_FILTER_LABELS).map(([value, label]) => ({
  value: value as LeaveFilter,
  label,
}))

/** 按筛选 + 关键词过滤（筛选是纯函数 filterLeaveRecords，关键词走 store） */
const records = computed(() => {
  const matched = leaveStore.listRecords({ keyword: keyword.value })
  return filterLeaveRecords(matched, filter.value, today.value)
})

const filterCounts = computed(() => {
  const all = leaveStore.leaves
  return {
    all: all.length,
    today: filterLeaveRecords(all, 'today', today.value).length,
    week: filterLeaveRecords(all, 'week', today.value).length,
    out: filterLeaveRecords(all, 'out', today.value).length,
    back: filterLeaveRecords(all, 'back', today.value).length,
  } satisfies Record<LeaveFilter, number>
})

const chipOptions = computed(() =>
  FILTER_OPTIONS.map((option) => ({
    key: option.value as string,
    label: option.label,
    count: filterCounts.value[option.value],
  })),
)

/* ---------- Layer 1：今日概览（真实派生；已作废记录不算请假事实） ---------- */

const activeLeaves = computed(() => leaveStore.leaves.filter((item) => item.status !== 'rejected'))

const stats = computed(() => ({
  todayCount: activeLeaves.value.filter((item) => isLeaveToday(item, today.value)).length,
  outCount: leaveStore.outLeaves.length,
  backTodayCount: activeLeaves.value.filter((item) => item.backToSchool?.date === today.value)
    .length,
  weekCount: activeLeaves.value.filter((item) => isLeaveThisWeek(item, today.value)).length,
}))

/* ---------- Layer 2：请假中（校外未返校，需登记返校） ---------- */

const currentLeaves = computed(() => sortLeaveRecords(leaveStore.outLeaves))

/** 学生 id → 值日组名（卡片「第几组」；值日 Store 只读派生） */
const dutyGroupNames = computed(() => {
  const map = new Map<string, string>()
  for (const group of dutyStore.groups) {
    for (const id of group.studentIds) {
      if (!map.has(id)) map.set(id, group.name)
    }
  }
  return map
})

/* ---------- Layer 3：今日登记时间轴（离校 / 返校端点派生事件） ---------- */

const todayEvents = computed<LeaveTimelineEvent[]>(() => {
  const events: (LeaveTimelineEvent & { sortHalf: number })[] = []
  for (const record of leaveStore.leaves) {
    if (record.status === 'rejected') continue
    const left = record.leftSchool
    if (left && left.date === today.value) {
      events.push({
        id: `${record.id}-left`,
        kind: 'left',
        studentName: record.studentName,
        timeLabel: formatDayPoint(left),
        sortKey: `${left.date}-${left.half}`,
        sortHalf: halfDayKey(left),
      })
    }
    const back = record.backToSchool
    if (back && back.date === today.value) {
      events.push({
        id: `${record.id}-back`,
        kind: 'back',
        studentName: record.studentName,
        timeLabel: formatDayPoint(back),
        sortKey: `${back.date}-${back.half}`,
        sortHalf: halfDayKey(back),
      })
    }
  }
  // 同半天内离校在前、返校在后；跨半天按上午/下午排
  return events.sort(
    (a, b) =>
      a.sortHalf - b.sortHalf || (a.kind === 'left' ? -1 : 1) - (b.kind === 'left' ? -1 : 1),
  )
})

/* ---------- 新增 / 编辑抽屉（登记入口：右下角 FAB，Record First 降级到最末） ---------- */

const formOpen = ref(false)
const editing = ref<LeaveRecord | undefined>(undefined)

function openCreate() {
  editing.value = undefined
  formOpen.value = true
}

function openEdit(record: LeaveRecord) {
  editing.value = record
  formOpen.value = true
}

/** 写入成功后才关抽屉：被拒时抽屉与已填内容都留着，教师改一改即可重试 */
function onSubmit(payload: LeaveInput) {
  const current = editing.value
  if (current) {
    const updated = leaveStore.updateLeave(current.id, payload)
    if (!updated) {
      toast.danger('保存失败：请检查填写内容，或该学生已不在档案中')
      return
    }
    formOpen.value = false
    toast.success(`已更新 ${updated.studentName} 的请假记录`)
    return
  }
  const created = leaveStore.addLeave(payload)
  if (!created) {
    toast.danger('保存失败：请检查填写内容，或该学生已不在档案中')
    return
  }
  formOpen.value = false
  toast.success(`已新增 ${created.studentName} 的请假记录`)
}

/* ---------- 离校 / 返校登记 ---------- */

const registerOpen = ref(false)
const registerTarget = ref<LeaveRecord | undefined>(undefined)
const registerMode = ref<RegisterMode>('left')

function askRegister(record: LeaveRecord, mode: RegisterMode) {
  registerTarget.value = record
  registerMode.value = mode
  registerOpen.value = true
}

function confirmRegister(point: DayPoint) {
  const target = registerTarget.value
  registerOpen.value = false
  if (!target) return
  const verb = REGISTER_MODE_LABELS[registerMode.value]
  const saved =
    registerMode.value === 'back'
      ? leaveStore.registerBackToSchool(target.id, point)
      : leaveStore.registerLeftSchool(target.id, point)
  if (!saved) {
    toast.danger('登记失败：请检查时间顺序，或该记录已被处理')
    return
  }
  toast.success(`已登记 ${saved.studentName} ${verb}：${formatDayPoint(point)}`)
}

/* ---------- 删除（二次确认） ---------- */

const confirmOpen = ref(false)
const removing = ref<LeaveRecord | undefined>(undefined)

function askRemove(record: LeaveRecord) {
  removing.value = record
  confirmOpen.value = true
}

function confirmRemove() {
  const target = removing.value
  confirmOpen.value = false
  if (!target) return
  if (!leaveStore.removeLeave(target.id)) {
    toast.danger('删除失败：该记录可能已被移除')
    return
  }
  toast.success(`已删除 ${target.studentName} 的请假记录`)
}

function clearFilters() {
  keyword.value = ''
  filter.value = 'all'
}
</script>

<template>
  <div class="leave-page">
    <header class="page-head">
      <div>
        <h1 class="page-title">请假记录</h1>
        <p class="page-subtitle">
          本月已记录 {{ leaveStore.monthLeaveCount }} 人次 · 未返校
          {{ leaveStore.outLeaves.length }} 人
        </p>
      </div>
      <div class="head-actions">
        <SettingsEntryButton module="leave" />
      </div>
    </header>

    <!-- ===== Layer 1：今日概览 ===== -->
    <LeaveStats :stats="stats" />

    <!-- ===== Layer 2：请假中（校外未返校，第一屏重点） ===== -->
    <section class="layer-section">
      <h2 class="layer-title">请假中 · 需要登记返校</h2>
      <CurrentLeaveList
        :records="currentLeaves"
        :duty-group-names="dutyGroupNames"
        @edit="openEdit"
        @register-left="askRegister($event, 'left')"
        @register-back="askRegister($event, 'back')"
        @remove="askRemove"
      />
    </section>

    <!-- ===== Layer 3 + 4：今日时间轴 | 历史记录（桌面双列） ===== -->
    <div class="lower-grid">
      <section class="layer-section">
        <h2 class="layer-title">今日登记</h2>
        <div class="panel">
          <LeaveTimeline v-if="todayEvents.length" :events="todayEvents" />
          <p v-else class="panel-empty">今天还没有离校 / 返校登记。</p>
        </div>
      </section>

      <section class="layer-section">
        <h2 class="layer-title">历史记录</h2>
        <LeaveHistorySection
          :records="records"
          :chip-options="chipOptions"
          :filter="filter"
          :keyword="keyword"
          :has-any="leaveStore.leaves.length > 0"
          :duty-group-names="dutyGroupNames"
          @update:filter="filter = $event as LeaveFilter"
          @update:keyword="keyword = $event"
          @clear="clearFilters"
          @edit="openEdit"
          @register-left="askRegister($event, 'left')"
          @register-back="askRegister($event, 'back')"
          @remove="askRemove"
        >
          <template #clearAction>
            <AppButton size="sm" variant="secondary" @click="clearFilters">清除筛选</AppButton>
          </template>
        </LeaveHistorySection>
      </section>
    </div>

    <!-- ===== 登记入口：FAB（Record First：录入降级到最末） ===== -->
    <button type="button" class="leave-fab" aria-label="记录请假" @click="openCreate">
      <Plus :size="22" :stroke-width="2" aria-hidden="true" />
      <span class="fab-label">记录请假</span>
    </button>

    <LeaveFormDrawer v-model="formOpen" :record="editing" @submit="onSubmit" />

    <!-- 登记弹窗已抽到 components/flow（Phase 7A）；上下文由本页经插槽给，
         两端时间戳直接把记录交给弹窗按 mode 取（RegisterEndpoints） -->
    <RegisterPointModal
      v-model="registerOpen"
      :mode="registerMode"
      :endpoints="registerTarget"
      @confirm="confirmRegister"
    >
      <template #context>
        {{ registerTarget ? registerTarget.studentName : '' }} 请假时段：
        <strong>{{
          registerTarget ? formatLeavePeriod(registerTarget.start, registerTarget.end) : ''
        }}</strong>
      </template>
    </RegisterPointModal>

    <AppModal v-model="confirmOpen" title="删除请假记录" :width="380">
      <p class="confirm-text">
        确定删除
        <strong>{{ removing ? removing.studentName : '' }}</strong>
        的请假记录吗？此操作无法撤销。
      </p>
      <template #footer>
        <AppButton variant="ghost" @click="confirmOpen = false">取消</AppButton>
        <AppButton variant="danger" @click="confirmRemove">删除记录</AppButton>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.leave-page {
  max-width: 1080px;
  padding-bottom: var(--spacing-2xl);
}

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--spacing-lg);
}

.page-title {
  font-size: var(--font-h2);
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.01em;
  color: var(--color-text-primary);
}

.page-subtitle {
  margin-top: var(--space-1);
  font-size: var(--font-secondary);
  color: var(--color-text-tertiary);
}

.head-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.layer-section {
  margin-top: var(--section-gap);
}

.layer-title {
  margin-bottom: var(--spacing-md);
  font-size: var(--text-xl);
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.01em;
  color: var(--color-text-primary);
}

/* Layer 3 + 4：桌面双列（时间轴窄列 + 历史宽列）；iPad/手机单列 */
.lower-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--section-gap);
}

@media (min-width: 900px) {
  .lower-grid {
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
  }
}

.panel {
  padding: var(--spacing-card);
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
}

.panel-empty {
  padding: var(--space-4) 0;
  text-align: center;
  font-size: var(--font-secondary);
  color: var(--color-text-tertiary);
}

/* 登记入口 FAB：右下角，Record First 层级最低但随手可达 */
.leave-fab {
  position: fixed;
  right: max(var(--space-5), env(safe-area-inset-right, 0px));
  bottom: max(var(--space-5), env(safe-area-inset-bottom, 0px));
  z-index: var(--z-sticky);
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 48px;
  padding: 0 var(--space-5);
  border: none;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  color: #ffffff;
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-semibold);
  box-shadow: var(--shadow-lg);
  cursor: pointer;
  transition:
    transform var(--duration-base) var(--ease-out),
    background var(--transition-fast),
    box-shadow var(--duration-base) var(--ease-out);
}

.leave-fab:hover {
  background: var(--color-primary-hover);
  transform: translateY(-2px);
  box-shadow: var(--shadow-xl);
}

.leave-fab:active {
  transform: scale(0.97);
}

.leave-fab:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
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
