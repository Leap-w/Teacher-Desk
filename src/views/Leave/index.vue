<script setup lang="ts">
import { computed, ref } from 'vue'

import { AppButton, AppCard, AppInput, AppModal, EmptyState } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useLeaveStore } from '@/stores/leave'
import { formatLeavePoint } from '@/utils/leave'
import type { LeaveInput, LeavePoint, LeaveRecord, LeaveStatus } from '@/types/leave'
import LeaveDecisionModal from './components/LeaveDecisionModal.vue'
import LeaveFormDrawer from './components/LeaveFormDrawer.vue'
import LeaveRecordCard from './components/LeaveRecordCard.vue'
import LeaveRegisterModal from './components/LeaveRegisterModal.vue'

type LeaveFilter = 'all' | LeaveStatus

const leaveStore = useLeaveStore()
const toast = useToast()

const keyword = ref('')
const filter = ref<LeaveFilter>('all')

const records = computed(() =>
  leaveStore.listRecords({
    status: filter.value === 'all' ? undefined : filter.value,
    keyword: keyword.value,
  }),
)

const filterOptions = computed(() => [
  { value: 'all' as const, label: '全部', count: leaveStore.leaves.length },
  {
    value: 'pending' as const,
    label: '待处理',
    count: leaveStore.leaves.filter((item) => item.status === 'pending').length,
  },
  {
    value: 'approved' as const,
    label: '已批准',
    count: leaveStore.leaves.filter((item) => item.status === 'approved').length,
  },
  {
    value: 'rejected' as const,
    label: '已驳回',
    count: leaveStore.leaves.filter((item) => item.status === 'rejected').length,
  },
])

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
      toast.danger('保存失败：该记录可能已被处理，请刷新后重试')
      return
    }
    formOpen.value = false
    toast.success(`已更新 ${updated.studentName} 的请假申请`)
    return
  }
  const created = leaveStore.addLeave(payload)
  if (!created) {
    toast.danger('保存失败：请检查填写内容，或该学生已不在档案中')
    return
  }
  formOpen.value = false
  toast.success(`已新增 ${created.studentName} 的请假申请`)
}

/* ---------- 批准 / 驳回 ---------- */

const decisionOpen = ref(false)
/**
 * 审批目标。**确认后不清空**（下面几处同理）：弹窗关闭有淡出动画，动画期间它仍在渲染，
 * 清掉会让姓名 / 时段文案先变空再消失（§9.8 记录项）。下次打开时覆盖，
 * 记录对象在 store 里是整体替换的，不会被就地改写。
 */
const decisionTarget = ref<LeaveRecord | undefined>(undefined)
const decision = ref<'approved' | 'rejected'>('approved')

function askDecision(record: LeaveRecord, choice: 'approved' | 'rejected') {
  decisionTarget.value = record
  decision.value = choice
  decisionOpen.value = true
}

function confirmDecision(note: string) {
  const target = decisionTarget.value
  decisionOpen.value = false
  if (!target) return
  const decided = leaveStore.decideLeave(target.id, decision.value, note)
  if (!decided) {
    toast.danger('操作失败：该记录可能已被处理，请刷新后重试')
    return
  }
  toast.success(
    decision.value === 'approved'
      ? `已批准 ${decided.studentName} 的请假申请`
      : `已驳回 ${decided.studentName} 的请假申请`,
  )
}

/* ---------- 离校 / 返校登记 ---------- */

const registerOpen = ref(false)
const registerTarget = ref<LeaveRecord | undefined>(undefined)
const registerMode = ref<'left' | 'back'>('left')

function askRegister(record: LeaveRecord, mode: 'left' | 'back') {
  registerTarget.value = record
  registerMode.value = mode
  registerOpen.value = true
}

function confirmRegister(point: LeavePoint) {
  const target = registerTarget.value
  registerOpen.value = false
  if (!target) return
  const isBack = registerMode.value === 'back'
  const saved = isBack
    ? leaveStore.registerBackToSchool(target.id, point)
    : leaveStore.registerLeftSchool(target.id, point)
  if (!saved) {
    toast.danger('登记失败：请检查时间顺序，或该记录已被处理')
    return
  }
  toast.success(
    `已登记 ${saved.studentName} ${isBack ? '返校' : '离校'}：${formatLeavePoint(point)}`,
  )
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
        <h1 class="page-title">请假管理</h1>
        <p class="page-subtitle">
          待处理 {{ leaveStore.pendingCount }} 条 · 本月已批准 {{ leaveStore.monthLeaveCount }} 人次
        </p>
      </div>
      <AppButton @click="openCreate">＋ 新增请假</AppButton>
    </header>

    <div class="toolbar-row">
      <AppInput
        v-model="keyword"
        class="search-input"
        placeholder="搜索学生姓名或学号后四位"
        clearable
      />
      <div class="segmented" role="group" aria-label="请假状态筛选">
        <button
          v-for="option in filterOptions"
          :key="option.value"
          type="button"
          class="segmented-item"
          :class="{ 'is-active': filter === option.value }"
          :aria-pressed="filter === option.value"
          @click="filter = option.value"
        >
          {{ option.label }}
          <span class="segmented-count">{{ option.count }}</span>
        </button>
      </div>
    </div>

    <section v-if="records.length" class="record-list">
      <LeaveRecordCard
        v-for="record in records"
        :key="record.id"
        :record="record"
        @edit="openEdit"
        @approve="askDecision($event, 'approved')"
        @reject="askDecision($event, 'rejected')"
        @register-left="askRegister($event, 'left')"
        @register-back="askRegister($event, 'back')"
        @remove="askRemove"
      />
    </section>

    <AppCard v-else padding="none" class="empty-card">
      <EmptyState
        v-if="leaveStore.leaves.length"
        icon="🔍"
        title="未找到匹配的请假记录"
        description="换个关键词，或清除筛选条件再试试。"
      >
        <AppButton size="sm" variant="secondary" @click="clearFilters">清除筛选</AppButton>
      </EmptyState>
      <EmptyState
        v-else
        icon="📝"
        title="暂无请假记录"
        description="点击右上角「新增请假」，记录第一条学生请假。"
      >
        <AppButton size="sm" @click="openCreate">新增请假</AppButton>
      </EmptyState>
    </AppCard>

    <LeaveFormDrawer v-model="formOpen" :record="editing" @submit="onSubmit" />

    <LeaveDecisionModal
      v-model="decisionOpen"
      :record="decisionTarget"
      :decision="decision"
      @confirm="confirmDecision"
    />

    <LeaveRegisterModal
      v-model="registerOpen"
      :record="registerTarget"
      :mode="registerMode"
      @confirm="confirmRegister"
    />

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

.page-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-5);
}

.page-title {
  font-size: var(--text-xl);
  font-weight: 700;
  letter-spacing: -0.3px;
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
