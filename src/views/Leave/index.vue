<script setup lang="ts">
import { computed, ref } from 'vue'

import RegisterPointModal from '@/components/flow/RegisterPointModal.vue'
import { AppButton, AppCard, AppInput, AppModal, EmptyState } from '@/components/ui'
import { useNow } from '@/composables/useToday'
import { useToast } from '@/composables/useToast'
import { useLeaveStore } from '@/stores/leave'
import { formatDateKey } from '@/utils/date'
import { formatLeavePeriod } from '@/utils/leave'
import { REGISTER_MODE_LABELS, formatDayPoint } from '@/utils/point'
import type { LeaveInput, LeaveRecord } from '@/types/leave'
import type { DayPoint, RegisterMode } from '@/types/point'
import { LEAVE_FILTER_LABELS, filterLeaveRecords } from '@/utils/leave'
import type { LeaveFilter } from '@/utils/leave'
import LeaveFormDrawer from './components/LeaveFormDrawer.vue'
import LeaveRecordCard from './components/LeaveRecordCard.vue'
import SettingsEntryButton from '@/components/layout/SettingsEntryButton.vue'
import { Search, NotebookPen } from 'lucide-vue-next'

/**
 * 请假管理（V1.1.5 记录口径）：只做「请假记录」——新建 / 编辑 / 删除 / 查询 /
 * 登记离校返校。**没有审批**：应用不替班主任决定「批不批」，记录本身就是事实。
 */
const leaveStore = useLeaveStore()
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

/* ---------- 新增 / 编辑抽屉 ---------- */

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
    <header class="page-toolbar">
      <div>
        <p class="page-subtitle">
          本月已记录 {{ leaveStore.monthLeaveCount }} 人次 · 未返校
          {{ leaveStore.outLeaves.length }} 人
        </p>
      </div>
      <div class="toolbar-actions">
        <SettingsEntryButton module="leave" />
        <AppButton @click="openCreate">＋ 新增请假记录</AppButton>
      </div>
    </header>

    <div class="toolbar-row">
      <AppInput
        v-model="keyword"
        class="search-input"
        placeholder="搜索学生姓名或学号后四位"
        clearable
      />
      <div class="segmented" role="group" aria-label="请假记录筛选">
        <button
          v-for="option in FILTER_OPTIONS"
          :key="option.value"
          type="button"
          class="segmented-item"
          :class="{ 'is-active': filter === option.value }"
          :aria-pressed="filter === option.value"
          @click="filter = option.value"
        >
          {{ option.label }}
          <span class="segmented-count">{{ filterCounts[option.value] }}</span>
        </button>
      </div>
    </div>

    <section v-if="records.length" class="record-list">
      <LeaveRecordCard
        v-for="record in records"
        :key="record.id"
        :record="record"
        @edit="openEdit"
        @register-left="askRegister($event, 'left')"
        @register-back="askRegister($event, 'back')"
        @remove="askRemove"
      />
    </section>

    <AppCard v-else padding="none" class="empty-card">
      <EmptyState
        v-if="leaveStore.leaves.length"
        :icon="Search"
        title="未找到匹配的请假记录"
        description="换个关键词，或清除筛选条件再试试。"
      >
        <AppButton size="sm" variant="secondary" @click="clearFilters">清除筛选</AppButton>
      </EmptyState>
      <EmptyState
        v-else
        :icon="NotebookPen"
        title="暂无请假记录"
        description="点击右上角「新增请假记录」，记录第一条学生请假。"
      >
        <AppButton size="sm" @click="openCreate">新增请假记录</AppButton>
      </EmptyState>
    </AppCard>

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
  max-width: 960px;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.page-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-5);
}

.page-subtitle {
  margin-top: var(--space-1);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.toolbar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
  margin-bottom: var(--space-5);
}

.search-input {
  width: 280px;
  max-width: 100%;
}

.segmented {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  background: var(--color-fill-disabled);
  border-radius: var(--radius-md);
}

.segmented-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  padding: 6px 14px;
  border-radius: 9px;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background var(--transition-fast),
    color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.segmented-item.is-active {
  background: var(--color-surface);
  color: var(--color-text);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}

.segmented-count {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}

.record-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.empty-card {
  padding: var(--space-6);
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
