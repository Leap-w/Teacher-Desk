<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { AppButton, AppCard, AppModal, AppSelect, EmptyState } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useStudentStore } from '@/stores/student'
import { useSeatStore } from '@/stores/seat'
import { seatPositionLong } from '@/utils/seat'
import { formatStudentDisplayName, formatStudentShortName } from '@/utils/student'
import StudentDetailModal from '@/views/Students/components/StudentDetailModal.vue'
import type { SeatChangeLog, SeatPlan } from '@/types/seat'
import type { Student } from '@/types'
import SeatClassroom from './components/SeatClassroom.vue'
import SeatPlanPanel from './components/SeatPlanPanel.vue'

type SeatView = 'teacher' | 'student'

/** 座位强调标记图例（颜色一律取自 theme.css，与 SeatClassroom 标记一致） */
const ACCENT_LEGEND = [
  { key: 'cadre', label: '班委', cls: 'is-cadre', dot: false },
  { key: 'tall', label: '高个', cls: 'is-tall', dot: false },
  { key: 'tag', label: '其他标签', cls: 'is-tag', dot: true },
] as const

const seatStore = useSeatStore()
const studentStore = useStudentStore()
const toast = useToast()

/** 教室参数唯一来源：store.config（即 DEFAULT_CLASSROOM_CONFIG），页面不另写教室数字 */
const config = seatStore.config

const view = ref<SeatView>('teacher')
const selectedSeatId = ref<string | undefined>(undefined)

const plans = computed(() => seatStore.plans)
const removingPlan = ref<SeatPlan | undefined>(undefined)
const confirmOpen = ref(false)

/** 学生查询表：座位图按 id 找学生（颜色 / 姓名 / 档案信息展示用） */
const studentMap = computed(
  () => new Map(studentStore.activeStudents.map((item) => [item.id, item])),
)

/** 当前方案座位查表（编排层判断交换 / 移动与取位置用） */
const seatsById = computed(() => new Map(seatStore.currentSeats.map((seat) => [seat.id, seat])))

/** 座位上的学生；空位 / 学生已删除返回 undefined */
function seatStudent(seatId: string): Student | undefined {
  const seat = seatsById.value.get(seatId)
  return seat?.studentId ? studentMap.value.get(seat.studentId) : undefined
}

const planOptions = computed(() =>
  plans.value.map((plan) => ({ value: plan.id, label: plan.name })),
)

/** 页面副标题：教室配置 + 当前就座进度，全部来自 config */
const roomSummary = computed(() => {
  const blocks = config.blocks.join('-')
  return `${config.name} · ${config.rows} 排 × ${config.cols} 列 · 分列 ${blocks} · 已就座 ${seatStore.occupiedCount}/${config.occupiedSeats}`
})

/** 方案下拉：切换当前方案（目标是当前或不存在时由 store 拒绝并静默） */
const currentPlanId = computed<string>({
  get: () => seatStore.currentPlan?.id ?? '',
  set: (id: string) => {
    if (!id || id === seatStore.currentPlan?.id) return
    const hadPending = seatStore.pendingLogsCount > 0
    if (!seatStore.switchPlan(id)) {
      toast.danger('切换失败：该方案不存在，请刷新后重试')
      return
    }
    selectedSeatId.value = undefined
    cancelPicker()
    if (hadPending) toast.info('已切换方案：未保存的「本次调整」记录已清空')
  },
})

/** 新建方案：自动命名并切换为当前；学生按 seatNumber 自动就座 */
function createPlan() {
  const hadPending = seatStore.pendingLogsCount > 0
  const plan = seatStore.createPlan()
  selectedSeatId.value = undefined
  cancelPicker()
  if (hadPending) toast.info('已新建方案：未保存的「本次调整」记录已清空')
  toast.success(`已新建方案「${plan.name}」并切换为当前`)
}

function handleRename(planId: string, name: string) {
  if (!seatStore.renamePlan(planId, name)) {
    toast.danger('重命名失败：该方案不存在，请刷新后重试')
    return
  }
  toast.success(`方案已重命名为「${name}」`)
}

function askRemove(plan: SeatPlan) {
  removingPlan.value = plan
  confirmOpen.value = true
}

function confirmRemove() {
  const target = removingPlan.value
  removingPlan.value = undefined
  confirmOpen.value = false
  if (!target) return
  if (!seatStore.removePlan(target.id)) {
    toast.danger('删除失败：当前方案不可删除')
    return
  }
  toast.success(`已删除方案「${target.name}」`)
}

/* ========== Phase 3B：换座动作（拖拽落下与点击换座共用） ========== */

function changeFailed() {
  toast.danger('换座失败：数据已变化，请刷新后重试')
}

/**
 * 执行一次换座：两座均有学生 = 交换（各记一条日志）；源有学生且目标为空 = 移动（记一条）。
 * 源为空 / 拖回原位等情况在此静默返回（不提示、不记录）。
 */
function applySeatChange(fromId: string, toId: string) {
  const fromSeat = seatsById.value.get(fromId)
  const toSeat = seatsById.value.get(toId)
  if (!fromSeat || !toSeat) return
  const fromStudent = seatStudent(fromId)
  const toStudent = seatStudent(toId)
  if (!fromStudent) return
  if (toStudent) {
    if (!seatStore.swapSeats(fromId, toId)) {
      changeFailed()
      return
    }
    toast.success(
      `已交换：${formatStudentShortName(fromStudent)} ↔ ${formatStudentShortName(toStudent)}`,
    )
    return
  }
  if (!seatStore.moveStudent(fromId, toId)) {
    changeFailed()
    return
  }
  toast.success(
    `已移动：${formatStudentShortName(fromStudent)} → ${seatPositionLong(toSeat.row, toSeat.col)}`,
  )
}

/** 普通点击座位：选中 / 再次点击取消选中（选中态跨视角保持） */
function onPickSeat(seatId: string) {
  selectedSeatId.value = selectedSeatId.value === seatId ? undefined : seatId
}

/* ========== Phase 3B：点击换座模式（长按卡「开始换座」触发） ========== */

const pickerFrom = ref<string | undefined>(undefined)

const pickerLabel = computed(() => {
  const student = pickerFrom.value ? seatStudent(pickerFrom.value) : undefined
  return student ? formatStudentShortName(student) : ''
})

function startPicker(seatId: string) {
  if (!seatStudent(seatId)) return
  pickerFrom.value = seatId
  selectedSeatId.value = seatId
}

function cancelPicker() {
  pickerFrom.value = undefined
}

/** 换座模式下点击座位：目标 = 源 → 取消；否则按交换 / 移动执行一次并退出模式 */
function onPickerTarget(targetId: string) {
  if (targetId === pickerFrom.value) {
    cancelPicker()
    return
  }
  const fromId = pickerFrom.value
  cancelPicker()
  if (fromId) applySeatChange(fromId, targetId)
}

/** 座位点击分发：换座模式下交给 picker，普通模式维持选中语义 */
function handleSeatClick(seatId: string) {
  if (pickerFrom.value) {
    onPickerTarget(seatId)
    return
  }
  onPickSeat(seatId)
}

function onWindowKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && pickerFrom.value) cancelPicker()
}

onMounted(() => window.addEventListener('keydown', onWindowKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKeydown))

/* ========== Phase 3B：长按信息卡 → 查看详情 / 学生删除 ========== */

const detailStudent = ref<Student | undefined>(undefined)
const detailOpen = ref(false)

function openStudentDetail(seatId: string) {
  const student = seatStudent(seatId)
  if (!student) return
  detailStudent.value = student
  detailOpen.value = true
}

/** 学生模块详情弹窗的「编辑」在排座页不提供入口：引导回学生档案页 */
function onDetailEdit() {
  toast.info('编辑学生信息请前往「学生档案」页')
}

const removingStudent = ref<Student | undefined>(undefined)
const confirmStudentRemoveOpen = ref(false)

/** 长按卡 → 查看详情 → 删除：确认后删除，座位由 seat store 自动释放（本方案内双视角即时变空位） */
function askRemoveStudent(student: Student) {
  detailOpen.value = false
  removingStudent.value = student
  confirmStudentRemoveOpen.value = true
}

function confirmRemoveStudent() {
  const target = removingStudent.value
  removingStudent.value = undefined
  confirmStudentRemoveOpen.value = false
  if (!target) return
  if (!studentStore.removeStudent(target.id)) {
    toast.danger('删除失败：该学生不存在')
    return
  }
  detailStudent.value = undefined
  cancelPicker()
  toast.success(`已从学生列表中移除 ${formatStudentDisplayName(target)}`)
}

/* ========== Phase 3B：保存本次调整 → 摘要 ========== */

const hasPending = computed(() => seatStore.pendingLogsCount > 0)
const summaryOpen = ref(false)
const summaryEntries = ref<SeatChangeLog[]>([])

/** 摘要「共调整 N 人」按去重学生计数（同一学生多次调整不重复计） */
const summaryTotal = computed(
  () => new Set(summaryEntries.value.map((entry) => entry.studentId)).size,
)

/** 保存「本次调整」：归档进当前方案 changeLogs，并按待提交记录弹摘要 */
function saveAdjustments() {
  const committed = seatStore.commitPendingLogs()
  if (committed.length === 0) return
  summaryEntries.value = committed
  summaryOpen.value = true
}
</script>

<template>
  <div class="seats-page">
    <header class="page-toolbar">
      <div>
        <h1 class="page-title">座位管理</h1>
        <p class="page-subtitle">{{ roomSummary }}</p>
      </div>
      <div class="toolbar-actions">
        <AppButton
          v-if="hasPending"
          variant="secondary"
          title="把本次调整记录归档到当前方案"
          @click="saveAdjustments"
        >
          保存本次调整（{{ seatStore.pendingLogsCount }}）
        </AppButton>
        <AppButton @click="createPlan">＋ 新建方案</AppButton>
      </div>
    </header>

    <div class="toolbar-row">
      <div class="segmented" role="group" aria-label="教室视角">
        <button
          type="button"
          class="segmented-item"
          :class="{ 'is-active': view === 'teacher' }"
          @click="view = 'teacher'"
        >
          老师视角
        </button>
        <button
          type="button"
          class="segmented-item"
          :class="{ 'is-active': view === 'student' }"
          @click="view = 'student'"
        >
          学生视角
        </button>
      </div>

      <div class="plan-switch">
        <span class="plan-switch-label">当前方案</span>
        <AppSelect
          v-model="currentPlanId"
          class="plan-switch-select"
          :options="planOptions"
          :disabled="!plans.length"
        />
      </div>

      <ul class="legend" aria-label="座位标记图例">
        <li v-for="item in ACCENT_LEGEND" :key="item.key" class="legend-item">
          <i class="swatch" :class="[item.cls, { 'is-dot': item.dot }]" aria-hidden="true"></i>
          {{ item.label }}
        </li>
      </ul>
    </div>

    <!-- 点击换座模式提示条 -->
    <div v-if="pickerFrom" class="picker-hint" role="status">
      正在与「{{ pickerLabel }}」换座——点击已就座座位交换、点击空位移入；点击原座位或按 Esc 取消
    </div>

    <div class="seats-layout">
      <AppCard padding="none" class="room-card">
        <SeatClassroom
          v-if="seatStore.currentPlan"
          :config="config"
          :seats="seatStore.currentSeats"
          :students="studentMap"
          :view="view"
          :selected-id="selectedSeatId"
          :pick-source-id="pickerFrom"
          @select="handleSeatClick"
          @change="applySeatChange"
          @quick-detail="openStudentDetail"
          @quick-swap="startPicker"
        />
        <EmptyState
          v-else
          icon="🪑"
          title="暂无座位方案"
          description="点击右上角「＋ 新建方案」创建第一份排座方案。"
        >
          <AppButton size="sm" @click="createPlan">新建方案</AppButton>
        </EmptyState>
      </AppCard>

      <SeatPlanPanel
        class="plan-panel"
        :plans="plans"
        :occupied-seats="config.occupiedSeats"
        @create="createPlan"
        @select="currentPlanId = $event"
        @rename="handleRename"
        @remove="askRemove"
      />
    </div>

    <AppModal v-model="confirmOpen" title="删除座位方案" :width="380">
      <p class="confirm-text">
        确定删除座位方案
        <strong>{{ removingPlan ? removingPlan.name : '' }}</strong>
        吗？删除后无法恢复。
      </p>
      <template #footer>
        <AppButton variant="ghost" @click="confirmOpen = false">取消</AppButton>
        <AppButton variant="danger" @click="confirmRemove">删除方案</AppButton>
      </template>
    </AppModal>

    <!-- 长按卡「查看详情」：复用学生模块详情弹窗（未改学生 UI；编辑/删除在页面编排层处理） -->
    <StudentDetailModal
      v-model="detailOpen"
      :student="detailStudent"
      @edit="onDetailEdit"
      @remove="askRemoveStudent"
    />

    <AppModal v-model="confirmStudentRemoveOpen" title="移除学生" :width="380">
      <p class="confirm-text">
        确定从学生列表中移除
        <strong>{{ removingStudent ? formatStudentDisplayName(removingStudent) : '' }}</strong>
        吗？此操作无法撤销。该学生在全部座位方案中的座位将被释放为空位。
      </p>
      <template #footer>
        <AppButton variant="ghost" @click="confirmStudentRemoveOpen = false">取消</AppButton>
        <AppButton variant="danger" @click="confirmRemoveStudent">从学生列表中移除</AppButton>
      </template>
    </AppModal>

    <!-- 保存本次调整后的自动摘要 -->
    <AppModal v-model="summaryOpen" title="本次调整" :width="420">
      <div class="summary-list">
        <p v-for="entry in summaryEntries" :key="entry.id" class="summary-entry">
          <span class="summary-name">{{ entry.studentName }}</span>
          <span class="summary-move">{{ entry.from }} → {{ entry.to }}</span>
        </p>
      </div>
      <p class="summary-total">共调整 {{ summaryTotal }} 人。</p>
      <template #footer>
        <AppButton @click="summaryOpen = false">完成</AppButton>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.seats-page {
  max-width: 1200px;
}

.page-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-5);
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
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
  gap: var(--space-4);
  flex-wrap: wrap;
  margin-bottom: var(--space-5);
}

/* 视角切换（模式同学生页筛选分段控件） */
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

.plan-switch {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.plan-switch-label {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.plan-switch-select {
  width: 190px;
}

.legend {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  list-style: none;
  margin-left: auto;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  white-space: nowrap;
}

/* 图例色块：横条（班委 / 高个）与圆点（其他标签）都取自 theme.css */
.swatch {
  width: 18px;
  height: 3px;
  border-radius: 999px;
}

.swatch.is-dot {
  width: 6px;
  height: 6px;
  background: var(--color-text-secondary);
}

.swatch.is-cadre {
  background: var(--color-primary-strong);
}

.swatch.is-tall {
  background: var(--color-warning);
}

/* 点击换座模式提示条 */
.picker-hint {
  margin-bottom: var(--space-3);
  padding: 8px 14px;
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-md);
  background: var(--color-primary-soft);
  font-size: var(--text-sm);
  color: var(--color-primary-strong);
  text-align: center;
}

.seats-layout {
  display: flex;
  align-items: flex-start;
  gap: var(--space-5);
}

.room-card {
  flex: 1;
  min-width: 0;
}

.plan-panel {
  width: 272px;
  flex-shrink: 0;
}

@media (max-width: 960px) {
  .seats-layout {
    flex-direction: column;
  }

  .plan-panel {
    width: 100%;
  }

  .legend {
    margin-left: 0;
  }
}

.confirm-text {
  font-size: var(--text-sm);
  line-height: 1.7;
  color: var(--color-text-secondary);
}

.confirm-text strong {
  color: var(--color-text);
}

/* 保存本次调整后的摘要 */
.summary-list {
  display: grid;
  gap: var(--space-3);
  max-height: 42vh;
  overflow-y: auto;
}

.summary-entry {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--color-fill-disabled);
}

.summary-name {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
}

.summary-move {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.summary-total {
  margin-top: var(--space-4);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}
</style>
