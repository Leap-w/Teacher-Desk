<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, TriangleAlert } from 'lucide-vue-next'

import { AppButton, AppModal, AppSelect } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useSeatStore } from '@/stores/seat'
import { useStudentStore } from '@/stores/student'
import { CONSTRAINT_OK_LINES } from '@/utils/constraint'
import type { ConstraintGroup, ConstraintIssue } from '@/utils/constraint'
import { ADJACENT_RULE_NOTE, SAME_DESK_RULE_NOTE, seatPositionLong } from '@/utils/seat'
import { PLAN_CONSTRAINT_LABELS, rowRuleNote } from '@/utils/seatPlanConstraint'
import { formatStudentShortName } from '@/utils/student'
import type { Student } from '@/types'

/**
 * 排座约束弹窗（V1.1.2 Phase 1）。
 *
 * 约束属于**当前座位方案**（`SeatPlan.constraints`），不是学生个人档案：
 * 换方案即换一套约束，删学生时自动收敛。写入一律走 seat store 的方法
 * （一次赋值 = 一次写盘 + 一次广播），组件既不碰 `seats` 也不碰 localStorage。
 *
 * 本阶段**只做约束的录入与检查**：不自动移动学生、不自动排座。
 */

interface Props {
  modelValue: boolean
  /**
   * v3.2.0：本班座位约束的实时检查结论（原右侧「约束检查」卡片的内容）。
   * 页面右侧那两张卡片已撤下，检查结论随约束管理一起进本弹窗——
   * 「约束」按钮因此是**唯一**入口，教师不必在两个地方各看一半。
   */
  issues: ConstraintIssue[]
  /** 手工约束总数（含停用；展示用） */
  totalConstraints: number
}

defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** 定位：把涉及座位交给页面滚动 + 闪烁 */
  locate: [seatIds: string[]]
  /** 检查行定位（与上面同义，但按 issue 粒度；页面按涉及座位闪烁 + 滚到第一个） */
  locateIssue: [issue: ConstraintIssue]
  /** ＋ 添加约束 / 管理约束（本班座位约束，走 ConstraintEditModal / ConstraintManageModal） */
  add: []
  manage: []
}>()

/** 检查分组渲染顺序与各自的无问题文案（原 ConstraintPanel 的口径，一字未改） */
const GROUPS: Array<{ key: ConstraintGroup; ok: string }> = [
  { key: 'relation', ok: CONSTRAINT_OK_LINES.relation },
  { key: 'rules', ok: CONSTRAINT_OK_LINES.rules },
  { key: 'tall', ok: CONSTRAINT_OK_LINES.tall },
  { key: 'cadre', ok: CONSTRAINT_OK_LINES.cadre },
]

function issuesOf(group: ConstraintGroup, issues: ConstraintIssue[]): ConstraintIssue[] {
  return issues.filter((issue) => issue.group === group)
}

type Tab = 'desk' | 'adjacent' | 'rows'

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'desk', label: PLAN_CONSTRAINT_LABELS.sameDeskForbidden },
  { key: 'adjacent', label: PLAN_CONSTRAINT_LABELS.adjacentGroupForbidden },
  { key: 'rows', label: '前排 / 后排' },
]

const seatStore = useSeatStore()
const studentStore = useStudentStore()
const toast = useToast()

const tab = ref<Tab>('desk')

const students = computed(() => studentStore.activeStudents)
const studentMap = computed(() => new Map(students.value.map((item) => [item.id, item])))
const studentOptions = computed(() =>
  students.value.map((item) => ({
    value: item.id,
    label: formatStudentShortName(item, studentStore.nameCounts),
  })),
)

function nameOf(studentId: string): string {
  const student = studentMap.value.get(studentId)
  return student ? formatStudentShortName(student, studentStore.nameCounts) : '已删除学生'
}

function nameOfDisplay(student: Student): string {
  return formatStudentShortName(student, studentStore.nameCounts)
}

/** 学生当前所在位置（前排 / 后排列表里直接给出，教师不必回头找） */
function seatLabelOf(studentId: string): string {
  const seat = seatStore.currentSeats.find((item) => item.studentId === studentId)
  return seat ? seatPositionLong(seat.row, seat.col) : '未就座'
}

const constraints = computed(() => seatStore.currentConstraints)
const report = computed(() => seatStore.constraintReport)
const rowNotes = computed(() => rowRuleNote(seatStore.config))

/* ---------- 不能同桌 ---------- */

const deskA = ref('')
const deskB = ref('')

function addDesk(): void {
  const outcome = seatStore.addSameDeskForbidden(deskA.value, deskB.value)
  if (!outcome.ok) {
    toast.warning(outcome.reason)
    return
  }
  deskA.value = ''
  deskB.value = ''
  toast.success('已添加「不能同桌」约束')
}

function removeDesk(ruleId: string): void {
  if (seatStore.removeSameDeskForbidden(ruleId)) toast.success('已删除该约束')
}

/* ---------- 三人不能相邻 ---------- */

const groupA = ref('')
const groupB = ref('')
const groupC = ref('')

function addGroup(): void {
  const outcome = seatStore.addAdjacentGroupForbidden([groupA.value, groupB.value, groupC.value])
  if (!outcome.ok) {
    toast.warning(outcome.reason)
    return
  }
  groupA.value = ''
  groupB.value = ''
  groupC.value = ''
  toast.success('已添加「三人不能相邻」组')
}

function removeGroup(ruleId: string): void {
  if (seatStore.removeAdjacentGroupForbidden(ruleId)) toast.success('已删除该约束组')
}

/* ---------- 前排 / 后排多选 ---------- */

/** 多选中的学生 id（弹窗内会话状态，不落库） */
const selectedIds = ref<string[]>([])

const allSelected = computed(
  () => students.value.length > 0 && selectedIds.value.length === students.value.length,
)

function toggleSelect(studentId: string): void {
  selectedIds.value = selectedIds.value.includes(studentId)
    ? selectedIds.value.filter((id) => id !== studentId)
    : [...selectedIds.value, studentId]
}

function selectAll(): void {
  selectedIds.value = students.value.map((item) => item.id)
}

function clearSelection(): void {
  selectedIds.value = []
}

function applyRow(target: 'front' | 'back'): void {
  if (selectedIds.value.length === 0) {
    toast.warning('请先勾选学生')
    return
  }
  const count = seatStore.setRowPreference(selectedIds.value, target)
  if (count === 0) {
    toast.danger('写入失败：方案已变化，请刷新后重试')
    return
  }
  toast.success(`已把 ${count} 名学生标为${target === 'front' ? '前排' : '后排'}`)
  selectedIds.value = []
}

function clearRowMark(): void {
  if (selectedIds.value.length === 0) {
    toast.warning('请先勾选学生')
    return
  }
  seatStore.setRowPreference(selectedIds.value, 'clear')
  toast.success(`已取消 ${selectedIds.value.length} 名学生的前后排标记`)
  selectedIds.value = []
}

function unmark(studentId: string): void {
  seatStore.setRowPreference([studentId], 'clear')
}

function markOf(studentId: string): 'front' | 'back' | undefined {
  if (constraints.value.frontRowStudents.includes(studentId)) return 'front'
  if (constraints.value.backRowStudents.includes(studentId)) return 'back'
  return undefined
}

function close(): void {
  selectedIds.value = []
  emit('update:modelValue', false)
}
</script>

<template>
  <AppModal :model-value="modelValue" title="排座约束" :width="720" @update:model-value="close">
    <p class="lead">
      约束属于<strong>当前方案</strong>：换方案即换一套；本阶段只做标记与检查，不会自动移动学生。
    </p>

    <!-- 座位约束检查（v3.2.0）：原页面右侧「约束检查」卡片并入本弹窗，
         封面层级的冲突 / 提醒全在这里，任一行点击即定位到涉及座位。 -->
    <section class="check">
      <header class="check-head">
        <h3 class="check-title">座位约束检查</h3>
        <span class="check-sub">实时检查 · 只读不自动调整</span>
      </header>

      <ul class="check-list">
        <template v-for="group in GROUPS" :key="group.key">
          <li v-if="issuesOf(group.key, issues).length === 0" class="check-ok">
            <span class="check-mark is-ok" aria-hidden="true">
              <Check :size="14" :stroke-width="2.5" />
            </span>
            {{ group.ok }}
          </li>
          <li v-else>
            <button
              v-for="issue in issuesOf(group.key, issues)"
              :key="issue.key"
              type="button"
              class="check-row"
              :class="`is-${issue.severity}`"
              :title="`定位：${issue.studentIds.length} 名学生`"
              @click="emit('locateIssue', issue)"
            >
              <span class="check-mark" aria-hidden="true">
                <TriangleAlert :size="14" :stroke-width="2.5" />
              </span>
              <span class="check-text">{{ issue.message }}</span>
            </button>
          </li>
        </template>
      </ul>

      <p v-if="totalConstraints === 0" class="check-tip">
        还没有座位约束。长按已就座座位 →「＋ 座位约束」添加「不能同桌 /
        不能相邻」（自动排座的硬约束）或「坐后排 / 坐前排 / 同区块」（软规则）。
      </p>

      <div class="check-actions">
        <AppButton size="sm" variant="ghost" @click="emit('add')">＋ 添加约束</AppButton>
        <AppButton size="sm" variant="secondary" @click="emit('manage')">
          管理约束（{{ totalConstraints }}）
        </AppButton>
      </div>
    </section>

    <!-- 方案规则检查：错误（红）与提醒（琥珀）都在这里，点「定位」直接找到座位 -->
    <div class="report" :class="{ 'is-ok': report.issues.length === 0 }">
      <p v-if="report.issues.length === 0" class="report-ok">
        当前方案未发现违反约束的座位（{{ constraints.sameDeskForbidden.length }} 组不能同桌、{{
          constraints.adjacentGroupForbidden.length
        }}
        组三人不能相邻、{{ constraints.frontRowStudents.length }} 名前排、{{
          constraints.backRowStudents.length
        }}
        名后排）
      </p>
      <p
        v-for="issue in report.issues"
        :key="issue.key"
        class="report-item"
        :class="`is-${issue.severity}`"
      >
        <span class="report-badge">{{ issue.severity === 'error' ? '冲突' : '提醒' }}</span>
        <span class="report-text">{{ issue.message }}</span>
        <button
          v-if="issue.seatIds.length"
          type="button"
          class="report-locate"
          @click="emit('locate', issue.seatIds)"
        >
          定位
        </button>
      </p>
    </div>

    <div class="tabs" role="group" aria-label="约束类型">
      <button
        v-for="item in TABS"
        :key="item.key"
        type="button"
        class="tab"
        :class="{ 'is-active': tab === item.key }"
        @click="tab = item.key"
      >
        {{ item.label }}
      </button>
    </div>

    <!-- 不能同桌 -->
    <section v-if="tab === 'desk'" class="pane">
      <p class="note">{{ SAME_DESK_RULE_NOTE }}</p>
      <div class="form-row">
        <AppSelect v-model="deskA" :options="studentOptions" placeholder="学生 A" size="sm" />
        <span class="form-plus">＋</span>
        <AppSelect v-model="deskB" :options="studentOptions" placeholder="学生 B" size="sm" />
        <AppButton size="sm" @click="addDesk">添加</AppButton>
      </div>
      <ul v-if="constraints.sameDeskForbidden.length" class="rule-list">
        <li v-for="rule in constraints.sameDeskForbidden" :key="rule.id" class="rule-item">
          <span class="rule-text">
            {{ nameOf(rule.studentA) }} 与 {{ nameOf(rule.studentB) }} 不能同桌
          </span>
          <button type="button" class="rule-remove" @click="removeDesk(rule.id)">删除</button>
        </li>
      </ul>
      <p v-else class="empty">还没有「不能同桌」约束</p>
    </section>

    <!-- 三人不能相邻 -->
    <section v-else-if="tab === 'adjacent'" class="pane">
      <p class="note">{{ ADJACENT_RULE_NOTE }}；组内任意两人相邻即算冲突。</p>
      <div class="form-row">
        <AppSelect v-model="groupA" :options="studentOptions" placeholder="学生 A" size="sm" />
        <AppSelect v-model="groupB" :options="studentOptions" placeholder="学生 B" size="sm" />
        <AppSelect v-model="groupC" :options="studentOptions" placeholder="学生 C" size="sm" />
        <AppButton size="sm" @click="addGroup">添加</AppButton>
      </div>
      <ul v-if="constraints.adjacentGroupForbidden.length" class="rule-list">
        <li v-for="rule in constraints.adjacentGroupForbidden" :key="rule.id" class="rule-item">
          <span class="rule-text"> {{ rule.students.map(nameOf).join('、') }} 三人不能相邻 </span>
          <button type="button" class="rule-remove" @click="removeGroup(rule.id)">删除</button>
        </li>
      </ul>
      <p v-else class="empty">还没有「三人不能相邻」约束组</p>
    </section>

    <!-- 前排 / 后排 -->
    <section v-else class="pane">
      <p class="note">{{ rowNotes }}。标记只作为排座偏好提示，不会自动移动学生。</p>
      <div class="row-tools">
        <AppButton size="sm" variant="secondary" @click="selectAll">
          {{ allSelected ? '已全选' : '全选当前列表' }}
        </AppButton>
        <AppButton size="sm" variant="ghost" @click="clearSelection">取消选择</AppButton>
        <span class="row-tools-count">已选 {{ selectedIds.length }} 人</span>
        <AppButton size="sm" @click="applyRow('front')">设为前排</AppButton>
        <AppButton size="sm" @click="applyRow('back')">设为后排</AppButton>
        <AppButton size="sm" variant="ghost" @click="clearRowMark">取消标记</AppButton>
      </div>

      <div class="student-grid">
        <label
          v-for="student in students"
          :key="student.id"
          class="student-item"
          :class="{ 'is-checked': selectedIds.includes(student.id) }"
        >
          <input
            type="checkbox"
            :checked="selectedIds.includes(student.id)"
            @change="toggleSelect(student.id)"
          />
          <span class="student-name">{{ nameOfDisplay(student) }}</span>
          <span class="student-seat">{{ seatLabelOf(student.id) }}</span>
          <span v-if="markOf(student.id) === 'front'" class="mark is-front">前排</span>
          <span v-else-if="markOf(student.id) === 'back'" class="mark is-back">后排</span>
        </label>
      </div>

      <div class="mark-lists">
        <div class="mark-col">
          <h4 class="mark-title">前排（{{ constraints.frontRowStudents.length }}）</h4>
          <ul v-if="constraints.frontRowStudents.length" class="mark-list">
            <li v-for="id in constraints.frontRowStudents" :key="id" class="mark-row">
              <span class="mark-name">{{ nameOf(id) }}</span>
              <span class="mark-seat">{{ seatLabelOf(id) }}</span>
              <button type="button" class="rule-remove" @click="unmark(id)">取消</button>
            </li>
          </ul>
          <p v-else class="empty">未标记</p>
        </div>
        <div class="mark-col">
          <h4 class="mark-title">后排（{{ constraints.backRowStudents.length }}）</h4>
          <ul v-if="constraints.backRowStudents.length" class="mark-list">
            <li v-for="id in constraints.backRowStudents" :key="id" class="mark-row">
              <span class="mark-name">{{ nameOf(id) }}</span>
              <span class="mark-seat">{{ seatLabelOf(id) }}</span>
              <button type="button" class="rule-remove" @click="unmark(id)">取消</button>
            </li>
          </ul>
          <p v-else class="empty">未标记</p>
        </div>
      </div>
    </section>

    <template #footer>
      <AppButton @click="close">完成</AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.lead {
  font-size: var(--text-sm);
  line-height: 1.6;
  color: var(--color-text-secondary);
}

.lead strong {
  color: var(--color-text);
}

/* ---- 座位约束检查（原 ConstraintPanel 的样式，类名改前缀避免与本文件冲突） ---- */
.check {
  margin-top: var(--space-4);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.check-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-2);
}

.check-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
}

.check-sub {
  font-size: var(--font-caption);
  color: var(--color-text-faint);
}

.check-list {
  display: grid;
  gap: var(--space-1);
  list-style: none;
}

.check-ok {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background: var(--color-success-soft);
  font-size: var(--text-xs);
  line-height: 1.5;
  color: var(--color-success-strong);
}

.check-mark {
  flex-shrink: 0;
  display: inline-flex;
  line-height: 1.5;
}

.check-ok .check-mark.is-ok {
  color: var(--color-success);
}

.check-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  width: 100%;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  padding: 6px 8px;
  font-size: var(--text-xs);
  line-height: 1.5;
  color: var(--color-text-secondary);
  cursor: pointer;
  text-align: left;
  transition: background var(--transition-fast);
}

.check-row:hover {
  background: var(--color-fill-disabled);
}

.check-row.is-conflict .check-mark {
  color: var(--color-danger);
}

.check-row.is-conflict .check-text {
  color: var(--color-danger-strong);
}

.check-row.is-warn .check-mark {
  color: var(--color-warning-strong);
}

.check-row.is-warn .check-text {
  color: var(--color-warning-strong);
}

.check-tip {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
  font-size: var(--text-xs);
  line-height: 1.7;
  color: var(--color-text-faint);
}

.check-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

/* ---- 检查结论（当前方案的规则） ---- */
.report {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: var(--space-4);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-fill-disabled);
}

.report.is-ok {
  border-color: var(--color-success);
  background: var(--color-success-soft);
}

.report-ok {
  font-size: var(--text-xs);
  line-height: 1.6;
  color: var(--color-success-strong);
}

.report-item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  font-size: var(--text-xs);
  line-height: 1.6;
}

.report-badge {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: var(--radius-full);
  font-weight: 600;
}

.report-item.is-error .report-badge {
  background: var(--color-danger-soft);
  color: var(--color-danger-strong);
}

.report-item.is-warning .report-badge {
  background: var(--color-warning-soft);
  color: var(--color-warning-strong);
}

.report-text {
  flex: 1;
  color: var(--color-text-secondary);
}

.report-locate {
  flex-shrink: 0;
  border: none;
  background: transparent;
  padding: 0;
  font: inherit;
  font-weight: 600;
  color: var(--color-primary-strong);
  cursor: pointer;
}

/* ---- 分组 ---- */
.tabs {
  display: inline-flex;
  gap: 2px;
  margin-top: var(--space-4);
  padding: 3px;
  background: var(--color-fill-disabled);
  border-radius: var(--radius-md);
}

.tab {
  border: none;
  background: transparent;
  padding: 6px 14px;
  border-radius: var(--radius-xs);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
}

.tab.is-active {
  background: var(--color-surface);
  color: var(--color-text);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}

.pane {
  margin-top: var(--space-4);
}

.note {
  font-size: var(--text-xs);
  line-height: 1.6;
  color: var(--color-text-faint);
}

.form-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

/* 下拉框等分剩余宽度，按钮不参与压缩（否则「添加」二字会被挤成竖排） */
.form-row :deep(.app-select) {
  flex: 1 1 0;
  min-width: 0;
}

.form-row :deep(.app-button) {
  flex: 0 0 auto;
  white-space: nowrap;
}

.form-plus {
  flex: 0 0 auto;
  font-size: var(--text-sm);
  color: var(--color-text-faint);
}

.rule-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-3);
  max-height: 200px;
  overflow-y: auto;
}

.rule-item,
.mark-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--color-fill-disabled);
  font-size: var(--text-sm);
}

.rule-text {
  color: var(--color-text);
}

.rule-remove {
  flex-shrink: 0;
  border: none;
  background: transparent;
  padding: 0;
  font: inherit;
  font-size: var(--text-xs);
  color: var(--color-danger-strong);
  cursor: pointer;
}

.empty {
  margin-top: var(--space-3);
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}

/* ---- 前排 / 后排 ---- */
.row-tools {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  margin-top: var(--space-3);
}

.row-tools-count {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.student-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  margin-top: var(--space-3);
  max-height: 220px;
  overflow-y: auto;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.student-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  cursor: pointer;
}

.student-item.is-checked {
  background: var(--color-primary-soft);
}

.student-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text);
}

.student-seat {
  flex-shrink: 0;
  color: var(--color-text-faint);
}

.mark {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: var(--radius-full);
  font-weight: 600;
}

.mark.is-front {
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
}

.mark.is-back {
  background: var(--color-warning-soft);
  color: var(--color-warning-strong);
}

.mark-lists {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
  margin-top: var(--space-4);
}

.mark-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
}

.mark-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: var(--space-2);
  max-height: 140px;
  overflow-y: auto;
}

.mark-row {
  padding: 4px 10px;
  font-size: var(--text-xs);
}

.mark-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mark-seat {
  flex-shrink: 0;
  color: var(--color-text-faint);
}
</style>
