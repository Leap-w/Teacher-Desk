<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { AppButton, AppCard, AppModal, AppSelect, EmptyState } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useStudentStore } from '@/stores/student'
import { useSeatStore } from '@/stores/seat'
import { useConstraintStore } from '@/stores/constraint'
import { seatPositionLong, compareSeatPlans } from '@/utils/seat'
import { checkSeatConstraints } from '@/utils/constraint'
import { arrangeSeats } from '@/utils/seatArrange'
import type { ConstraintIssue } from '@/utils/constraint'
import {
  exportDateLabel,
  exportDateStamp,
  renderExportNode,
  downloadPng,
  createPdf,
  embedPdfImage,
  A4_HEIGHT_MM,
} from '@/utils/seatExport'
import type { SeatExportKind } from '@/utils/seatExport'
import { formatStudentDisplayName, formatStudentShortName } from '@/utils/student'
import StudentDetailModal from '@/views/Students/components/StudentDetailModal.vue'
import type { Seat, SeatChangeLog, SeatPlan } from '@/types/seat'
import type { Student } from '@/types'
import SeatClassroom from './components/SeatClassroom.vue'
import SeatPlanPanel from './components/SeatPlanPanel.vue'
import SeatSearch from './components/SeatSearch.vue'
import ConstraintPanel from './components/ConstraintPanel.vue'
import ConstraintEditModal from './components/ConstraintEditModal.vue'
import ConstraintManageModal from './components/ConstraintManageModal.vue'
import SeatExportDialog from './components/SeatExportDialog.vue'
import SeatExportGraphic from './components/SeatExportGraphic.vue'
import SeatExportSummary from './components/SeatExportSummary.vue'
import SeatCompareModal from './components/SeatCompareModal.vue'
import SeatArrangeModal from './components/SeatArrangeModal.vue'

type SeatView = 'teacher' | 'student'

/** 座位强调标记图例（颜色一律取自 theme.css，与 SeatClassroom 标记一致） */
const ACCENT_LEGEND = [
  { key: 'cadre', label: '班委', cls: 'is-cadre', dot: false },
  { key: 'tall', label: '高个', cls: 'is-tall', dot: false },
  { key: 'tag', label: '其他标签', cls: 'is-tag', dot: true },
] as const

const seatStore = useSeatStore()
const studentStore = useStudentStore()
const constraintStore = useConstraintStore()
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

/** 当前方案座位查表（编排层判断交换 / 移动与取位置用；方案对比查看时以 B 方案为准） */
const seatsById = computed(() => new Map(displaySeats.value.map((seat) => [seat.id, seat])))

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
  confirmOpen.value = false
  // **确认后不清空 removingPlan**：弹窗有淡出动画，动画期间仍在渲染——清掉会让
  // 「确定删除座位方案 XXX 吗」先变成空名（§9.8）。下次打开时由 askRemove 覆盖。
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
  if (event.key !== 'Escape') return
  if (pickerFrom.value) {
    cancelPicker()
    return
  }
  // 对比弹窗打开时 Esc 归弹窗（关闭它），不额外退出对比视图
  if (comparePair.value && !compareOpen.value) exitCompare()
}

onMounted(() => window.addEventListener('keydown', onWindowKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeydown)
  if (flashTimer !== undefined) window.clearTimeout(flashTimer)
})

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
  confirmStudentRemoveOpen.value = false
  // **确认后不清空**（同上）：确认弹窗淡出期间仍要显示「确定从学生列表中移除 XXX 吗」。
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

/* ========== Phase 3C：方案对比查看（只读高亮模式） ========== */

const compareOpen = ref(false)
/** 对比选中的方案对（A = 基准，B = 对照 = 座位图展示方）；清除 = 退出对比 */
const comparePair = ref<{ planAId: string; planBId: string } | undefined>(undefined)
/** 对比弹窗内的方案选择（重开时保留上次选择） */
const compareSelA = ref('')
const compareSelB = ref('')

const compareActive = computed(() => Boolean(comparePair.value))
const comparePlanA = computed(() =>
  plans.value.find((plan) => plan.id === comparePair.value?.planAId),
)
const comparePlanB = computed(() =>
  plans.value.find((plan) => plan.id === comparePair.value?.planBId),
)

/** 座位图展示的座位：对比查看时展示 B 方案；平时为当前方案（当前方案不存在回退空数组） */
const displaySeats = computed<Seat[]>(() => {
  if (comparePair.value) {
    const planB = comparePlanB.value
    if (planB) return planB.seats
  }
  return seatStore.currentSeats
})

const compareResult = computed(() => {
  const pair = comparePair.value
  if (!pair) return undefined
  const planA = comparePlanA.value
  const planB = comparePlanB.value
  if (!planA || !planB) return undefined
  return compareSeatPlans(planA, planB, studentMap.value)
})

/** 变化高亮集合（只含 id）；座位图黄色描边用 */
const changedStudentIds = computed(() => compareResult.value?.changedStudentIds)

function applyCompare(pair: { planAId: string; planBId: string }) {
  compareSelA.value = pair.planAId
  compareSelB.value = pair.planBId
  comparePair.value = pair
  compareOpen.value = false
  selectedSeatId.value = undefined
  cancelPicker()
  toast.success('已切换对比查看：黄色描边 = 相对基准方案调整了座位的学生')
}

/** 退出对比：回到当前方案常规编辑（数据从未被修改，直接还原视图） */
function exitCompare() {
  comparePair.value = undefined
  selectedSeatId.value = undefined
  cancelPicker()
}

/** 手动切换当前方案（含新建/删除）时退出对比，避免展示与「当前方案」脱节 */
watch(
  () => seatStore.currentPlan?.id,
  () => {
    comparePair.value = undefined
  },
)

/** 对比对象方案被删除 → 自动退出对比（避免停留在无 B 方案的只读视图） */
watch(plans, (list) => {
  const pair = comparePair.value
  if (!pair) return
  const hasA = list.some((plan) => plan.id === pair.planAId)
  const hasB = list.some((plan) => plan.id === pair.planBId)
  if (!hasA || !hasB) comparePair.value = undefined
})

/** 空位判空（展示方案中无学生） */
function isSeatEmpty(seatId: string): boolean {
  return !seatStudent(seatId)
}

/* ========== Phase 3C：学生定位（搜索 / 约束定位共用：滚动 + 闪烁 + 信息卡） ========== */

const classroomRef = ref<InstanceType<typeof SeatClassroom>>()
/** 正在闪烁定位的座位（3 次由 CSS 动画完成，随后由定时器清空以便重放） */
const flashSeatIds = ref<Set<string>>(new Set())
let flashTimer: number | undefined

function flashSeats(seatIds: string[]) {
  const ids = [...new Set(seatIds)]
  if (ids.length === 0) return
  if (flashTimer !== undefined) window.clearTimeout(flashTimer)
  flashSeatIds.value = new Set(ids)
  flashTimer = window.setTimeout(() => {
    flashSeatIds.value = new Set()
    flashTimer = undefined
  }, 1750)
}

/** 学生 → 所在展示座位 id（未就座返回 undefined） */
function seatIdOfStudent(studentId: string): string | undefined {
  return displaySeats.value.find((seat) => seat.studentId === studentId)?.id
}

/** 定位学生：滚动 + 闪烁 + 信息卡；未就座只提示 */
function locateStudent(student: Student) {
  const seatId = seatIdOfStudent(student.id)
  if (!seatId) {
    toast.info(`${formatStudentShortName(student)} 当前未就座，请先安排座位`)
    return
  }
  flashSeats([seatId])
  classroomRef.value?.revealSeat(seatId)
  // 等平滑滚动到位再弹卡，锚点取座位中心
  window.setTimeout(() => classroomRef.value?.openQuickCard(seatId), 420)
}

/** 搜索候选的「当前位置」文案（座位页顶部的定位搜索框） */
function searchPositionOf(studentId: string): string | undefined {
  const seatId = seatIdOfStudent(studentId)
  if (!seatId) return undefined
  const seat = seatsById.value.get(seatId)
  return seat ? seatPositionLong(seat.row, seat.col) : undefined
}

/** 约束检查行点击定位：涉及座位全部闪烁，滚动到第一个座位 */
function locateIssue(issue: ConstraintIssue) {
  flashSeats(issue.seatIds)
  const first = issue.seatIds[0]
  if (!first) return
  classroomRef.value?.revealSeat(first)
  // 有已就座学生才弹信息卡（约束行涉及的都是已就座者）
  const seated = issue.seatIds.find((id) => !isSeatEmpty(id))
  if (seated) window.setTimeout(() => classroomRef.value?.openQuickCard(seated), 420)
}

/* ========== Phase 3C：约束检查（只读）与约束管理 ========== */

const editConstraintOpen = ref(false)
/** 从信息卡进入时为卡主预设学生 A；约束面板「添加约束」为空（自行选择） */
const editConstraintPreset = ref<Student | undefined>(undefined)
const manageConstraintOpen = ref(false)

/** 实时检查结果（computed：约束 / 座位 / 学生任一变化即重算，零手工刷新） */
const constraintIssues = computed(() =>
  checkSeatConstraints({
    constraints: constraintStore.items,
    seats: displaySeats.value,
    students: studentMap.value,
  }),
)

function openAddConstraint() {
  editConstraintPreset.value = undefined
  editConstraintOpen.value = true
}

/** 信息卡「＋ 座位约束」：以卡主为约束主体学生 A */
function openConstraintForSeat(seatId: string) {
  const student = seatStudent(seatId)
  if (!student) return
  editConstraintPreset.value = student
  editConstraintOpen.value = true
}

/* ========== Phase 3D：自动排座（生成新方案 / 换一种排法 / 撤销） ========== */

const arrangeOpen = ref(false)
/** 上一次求解的硬约束冲突（弹窗展示；求解成功或重新打开弹窗时清空） */
const arrangeConflicts = ref<string[]>([])
/** 排法种子：同种子同结果，「换一种排法」= 递增种子 */
const arrangeSeed = ref(1)

/** 自动排座结果（页面级状态，不跨刷新）：结果条与撤销 / 换一种排法的唯一依据 */
interface ArrangeOutcome {
  planId: string
  /** 生成前的当前方案（撤销时切回它） */
  prevPlanId: string
  /** 生成（或上次换排法）后立刻读回的方案 updatedAt：与当前值不符即视为已被编辑 */
  createdUpdatedAt: string
  /** 未满足的软规则条数（取检查器的 rules 分组，口径与约束面板一致） */
  unmet: number
}

const arrangeResult = ref<ArrangeOutcome | undefined>(undefined)

/** 自动排座方案及其原方案（方案被删除后结果条自动收起） */
const arrangePlan = computed(() =>
  arrangeResult.value
    ? plans.value.find((plan) => plan.id === arrangeResult.value?.planId)
    : undefined,
)
const arrangePrevPlan = computed(() =>
  arrangeResult.value
    ? plans.value.find((plan) => plan.id === arrangeResult.value?.prevPlanId)
    : undefined,
)

/**
 * 结果条操作是否仍可用：方案仍是当前（未被手动切换）且未被编辑（updatedAt 未变）。
 * 重命名方案、删除学生触发的座位释放 / 启动清扫都会改写 updatedAt → 入口隐藏；
 * 保守但安全（宁可少给撤销入口，也不误删教师后续的改动）。
 */
const arrangeIntact = computed(() => {
  const plan = arrangePlan.value
  const outcome = arrangeResult.value
  if (!plan || !outcome) return false
  return plan.isCurrent && plan.updatedAt === outcome.createdUpdatedAt
})

/** 未满足的软规则条数（与约束面板同源：检查器的 rules 分组） */
function unmetRuleCount(): number {
  return constraintIssues.value.filter((issue) => issue.group === 'rules').length
}

/**
 * 结果条展示的未满足软规则条数：方案仍可用时取实时值（教师此后增删软规则，结果条与
 * 约束面板同步变化），方案已被编辑 / 切换时退回生成时的快照（此时实时值属于别的方案）。
 */
const arrangeUnmet = computed(() =>
  arrangeIntact.value ? unmetRuleCount() : (arrangeResult.value?.unmet ?? 0),
)

/** 清空座位闪烁（旧方案的闪烁座位 id 与新方案同名，排座后立即复位） */
function clearFlash() {
  if (flashTimer !== undefined) {
    window.clearTimeout(flashTimer)
    flashTimer = undefined
  }
  flashSeatIds.value = new Set()
}

/** 打开自动排座弹窗：清掉上一次的冲突结论 */
function openArrange() {
  arrangeConflicts.value = []
  arrangeOpen.value = true
}

/** 求解一次并同步冲突提示（纯计算，不落库） */
function solveArrange() {
  const result = arrangeSeats({
    students: studentStore.activeStudents,
    constraints: constraintStore.items,
    config,
    seed: arrangeSeed.value,
  })
  arrangeConflicts.value = result.ok ? [] : result.conflicts
  return result
}

/** 「自动排座」：求解成功则生成新方案（原方案原样保留，可对比 / 随时切回）；未能满足硬约束只报告冲突 */
function generateArrange() {
  const prevPlanId = seatStore.currentPlan?.id ?? ''
  // 每次生成换种子：同一输入下重复点「生成方案」也得到不同排法（同种子同结果是求解器的性质）
  arrangeSeed.value += 1
  const result = solveArrange()
  if (!result.ok) return
  const hadPending = seatStore.pendingLogsCount > 0
  const created = seatStore.createPlanFromSeats(result.seats)
  // 落库后从 plans 读回（createPlanFromSeats 返回的是副本），撤销基线取读回对象的 updatedAt
  const stored = plans.value.find((plan) => plan.id === created.id)
  selectedSeatId.value = undefined
  cancelPicker()
  clearFlash()
  arrangeOpen.value = false
  arrangeResult.value = {
    planId: created.id,
    prevPlanId,
    createdUpdatedAt: stored?.updatedAt ?? created.updatedAt,
    unmet: unmetRuleCount(),
  }
  if (hadPending) toast.info('已生成自动排座方案：未保存的「本次调整」记录已清空')
  const unplaced = result.unplacedStudentIds.length
  toast.success(
    unplaced > 0
      ? `已生成「${created.name}」：${unplaced} 名学生超出可排座位，未安排`
      : `已生成「${created.name}」并切换为当前`,
  )
}

/** 换一种排法：换种子重排并替换自动排座方案的座位（沿用同一方案与名称，不堆积方案） */
function rerollArrange() {
  const outcome = arrangeResult.value
  const plan = arrangePlan.value
  if (!outcome || !plan || !arrangeIntact.value) return
  arrangeSeed.value += 1
  const result = solveArrange()
  if (!result.ok) {
    toast.danger('换一种排法失败：未能满足全部硬约束')
    return
  }
  const hadPending = seatStore.pendingLogsCount > 0
  if (!seatStore.replacePlanSeats(plan.id, result.seats)) {
    toast.danger('换一种排法失败：方案已变化，请刷新后重试')
    return
  }
  const stored = plans.value.find((item) => item.id === plan.id)
  outcome.createdUpdatedAt = stored?.updatedAt ?? outcome.createdUpdatedAt
  outcome.unmet = unmetRuleCount()
  selectedSeatId.value = undefined
  // 与生成 / 撤销一致：重排后源座位可能已换人，点击换座模式必须退出
  cancelPicker()
  clearFlash()
  if (hadPending) toast.info('已重新排座：未保存的「本次调整」记录已清空')
  toast.success('已换一种排法')
}

/**
 * 撤销自动排座：切回原方案 → 删除自动排座方案（只复用既有 store API，不做通用撤销栈）。
 * switchPlan 对「目标不存在」与「已是当前」都返回 false，故以切换后的当前方案 id 判定结果，
 * 不把返回值 false 当作失败。
 */
function undoArrange() {
  const outcome = arrangeResult.value
  const prevPlan = arrangePrevPlan.value
  if (!outcome || !arrangeIntact.value) return
  if (!prevPlan) {
    toast.danger('原方案已不存在，无法撤销自动排座')
    arrangeResult.value = undefined
    return
  }
  const hadPending = seatStore.pendingLogsCount > 0
  seatStore.switchPlan(outcome.prevPlanId)
  if (seatStore.currentPlan?.id !== outcome.prevPlanId) {
    toast.danger('原方案已不存在，无法撤销自动排座')
    return
  }
  if (!seatStore.removePlan(outcome.planId)) {
    toast.danger('撤销失败：请手动删除该自动排座方案')
    return
  }
  arrangeResult.value = undefined
  selectedSeatId.value = undefined
  cancelPicker()
  clearFlash()
  if (hadPending) toast.info('已撤销自动排座：未保存的「本次调整」记录已清空')
  toast.success(`已撤销自动排座，已切回「${prevPlan.name}」`)
}

/* ========== Phase 3C：导出（PNG / PDF；离屏静态图渲染，不触碰页面状态） ========== */

const exportOpen = ref(false)
const exportBusy = ref<SeatExportKind | null>(null)
const compareBusy = ref(false)
/** 导出日期文案（每次导出开始固定，保证标题 / 副标题 / 文件名同一天） */
const exportedDateText = ref(exportDateLabel())

/** 离屏导出节点（html-to-image 抓取目标；双视角实例常驻挂载） */
const exportTeacherEl = ref<HTMLElement>()
const exportStudentEl = ref<HTMLElement>()
const compareNormalEl = ref<HTMLElement>()
const compareChangedEl = ref<HTMLElement>()
const compareSummaryEl = ref<HTMLElement>()

/** 导出用大标题 / 副标题（与规范一致：标题 = 班级名 + 座位表，副标题附方案名 + 日期 + 视角） */
const exportTitle = computed(() => `${config.name} 座位表`)
const exportSubtitle = (viewLabel?: string) =>
  `方案：${seatStore.currentPlan?.name ?? '—'} · ${exportedDateText.value}${
    viewLabel ? ` · ${viewLabel}` : ''
  }`

const compareSubtitle = computed(() => {
  if (!comparePlanB.value) return ''
  return `方案：${comparePlanB.value.name} · ${exportedDateText.value} · 老师视角`
})

const compareSummarySubtitle = computed(() => {
  if (!comparePlanA.value || !comparePlanB.value) return ''
  return `${comparePlanA.value.name} → ${comparePlanB.value.name} · ${exportedDateText.value}`
})

/** 等一次渲染帧（画布内文字 / 排版稳定后快照） */
async function captureNode(node: HTMLElement | undefined): Promise<HTMLCanvasElement> {
  if (!node) throw new Error('导出节点未就绪')
  await nextTick()
  await new Promise((resolve) => requestAnimationFrame(resolve))
  return renderExportNode(node)
}

function baseFilename(): string {
  const planName = seatStore.currentPlan?.name ?? '座位'
  return `${config.name}-座位表-${planName}-${exportDateStamp()}`
}

async function runExport(kind: SeatExportKind) {
  if (exportBusy.value || !seatStore.currentPlan) return
  exportBusy.value = kind
  exportedDateText.value = exportDateLabel()
  try {
    const base = baseFilename()
    if (kind === 'png-teacher' || kind === 'png-student') {
      const isTeacher = kind === 'png-teacher'
      const node = isTeacher ? exportTeacherEl.value : exportStudentEl.value
      const canvas = await captureNode(node)
      downloadPng(canvas, `${base}-${isTeacher ? '老师视角' : '学生视角'}.png`)
    } else if (kind === 'pdf-teacher') {
      const pdf = createPdf()
      const canvas = await captureNode(exportTeacherEl.value)
      embedPdfImage(pdf, canvas, { y: 10 })
      pdf.save(`${base}-老师视角.pdf`)
    } else {
      // 双视角 PDF：同一 A4 页上、下半各放一张图
      const pdf = createPdf()
      const budget = (A4_HEIGHT_MM - 26) / 2
      let y = 10
      const studentCanvas = await captureNode(exportStudentEl.value)
      y += embedPdfImage(pdf, studentCanvas, { y, maxHeight: budget })
      y += 6
      const teacherCanvas = await captureNode(exportTeacherEl.value)
      embedPdfImage(pdf, teacherCanvas, { y, maxHeight: A4_HEIGHT_MM - 20 - y })
      pdf.save(`${base}-双视角.pdf`)
    }
    toast.success('已导出座位图')
  } catch (error) {
    console.error('[seat export] 导出失败：', error)
    toast.danger('导出失败：请刷新后重试')
  } finally {
    exportBusy.value = null
  }
}

/** 对比 PDF：第 1 页 = B 方案全图，第 2 页 = 变化摘要，第 3 页 = 变化高亮图 */
async function runCompareExport() {
  if (compareBusy.value || !compareResult.value) return
  const planA = comparePlanA.value
  const planB = comparePlanB.value
  if (!planA || !planB) return
  compareBusy.value = true
  exportedDateText.value = exportDateLabel()
  try {
    const pdf = createPdf()
    const normal = await captureNode(compareNormalEl.value)
    embedPdfImage(pdf, normal, { y: 10 })
    const summary = await captureNode(compareSummaryEl.value)
    pdf.addPage()
    embedPdfImage(pdf, summary, { y: 10 })
    const changed = await captureNode(compareChangedEl.value)
    pdf.addPage()
    embedPdfImage(pdf, changed, { y: 10 })
    pdf.save(`${config.name}-座位对比-${planA.name}-${planB.name}-${exportDateStamp()}.pdf`)
    toast.success('已导出方案对比 PDF（3 页）')
  } catch (error) {
    console.error('[seat export] 对比导出失败：', error)
    toast.danger('导出失败：请刷新后重试')
  } finally {
    compareBusy.value = false
  }
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
        <AppButton
          v-if="!compareActive"
          variant="secondary"
          :disabled="!seatStore.currentPlan || studentStore.activeStudents.length === 0"
          title="按约束与规则自动生成一份新方案"
          @click="openArrange"
        >
          自动排座
        </AppButton>
        <AppButton
          v-if="!compareActive"
          variant="secondary"
          :disabled="plans.length < 2"
          title="对比两份方案的座位差异（只读查看）"
          @click="compareOpen = true"
        >
          方案对比
        </AppButton>
        <AppButton
          v-if="!compareActive"
          :disabled="!seatStore.currentPlan"
          title="导出当前方案座位图为图片 / PDF"
          @click="exportOpen = true"
        >
          导出座位图
        </AppButton>
        <AppButton variant="ghost" @click="createPlan">＋ 新建方案</AppButton>
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

      <!-- Phase 3C：学生定位（姓名 / 学号后四位） -->
      <SeatSearch
        :students="studentStore.activeStudents"
        :position-of="searchPositionOf"
        @locate="locateStudent"
      />

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

    <!-- Phase 3C：方案对比查看提示条（变化黄色描边 · 只读） -->
    <div v-if="compareActive" class="compare-hint" role="status">
      <span class="compare-hint-text">
        对比查看：<strong>{{ comparePlanA?.name }}</strong> →
        <strong>{{ comparePlanB?.name }}</strong>
        · 黄色描边 = 相对基准方案变化的学生 · 只读
      </span>
      <span class="compare-hint-actions">
        <AppButton size="sm" variant="ghost" @click="exitCompare">退出对比</AppButton>
        <AppButton size="sm" :disabled="compareBusy" @click="runCompareExport">
          导出对比 PDF{{ compareBusy ? '…' : '' }}
        </AppButton>
      </span>
    </div>

    <!-- Phase 3D：自动排座结果条（换一种排法 / 撤销；方案被切换或编辑后关闭入口） -->
    <div v-if="arrangeResult && arrangePlan && !compareActive" class="arrange-hint" role="status">
      <span class="arrange-hint-text">
        已生成「<strong>{{ arrangePlan.name }}</strong
        >」· 未满足软规则 <strong>{{ arrangeUnmet }}</strong> 条<template v-if="!arrangeIntact">
          · 该方案已被编辑或切换，撤销与换一种排法已关闭</template
        >
      </span>
      <span class="arrange-hint-actions">
        <AppButton v-if="arrangeIntact" size="sm" variant="ghost" @click="rerollArrange">
          换一种排法
        </AppButton>
        <AppButton
          v-if="arrangeIntact && arrangePrevPlan"
          size="sm"
          variant="ghost"
          @click="undoArrange"
        >
          撤销
        </AppButton>
        <AppButton size="sm" @click="arrangeResult = undefined">关闭</AppButton>
      </span>
    </div>

    <div class="seats-layout">
      <AppCard padding="none" class="room-card">
        <SeatClassroom
          v-if="seatStore.currentPlan"
          ref="classroomRef"
          :config="config"
          :seats="displaySeats"
          :students="studentMap"
          :view="view"
          :selected-id="selectedSeatId"
          :pick-source-id="pickerFrom"
          :flash-seat-ids="flashSeatIds"
          :changed-student-ids="changedStudentIds"
          :interactive="!compareActive"
          @select="handleSeatClick"
          @change="applySeatChange"
          @quick-detail="openStudentDetail"
          @quick-swap="startPicker"
          @quick-constraint="openConstraintForSeat"
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

      <aside class="side-col">
        <ConstraintPanel
          :issues="constraintIssues"
          :total-constraints="constraintStore.items.length"
          @locate="locateIssue"
          @add="openAddConstraint"
          @manage="manageConstraintOpen = true"
        />
        <SeatPlanPanel
          class="plan-panel"
          :plans="plans"
          :occupied-seats="config.occupiedSeats"
          @create="createPlan"
          @select="currentPlanId = $event"
          @rename="handleRename"
          @remove="askRemove"
        />
      </aside>
    </div>

    <!-- ========== Phase 3C：离屏导出渲染区（双视角实例常驻；对比页在对比查看时挂载） ========== -->
    <div class="export-stage" aria-hidden="true">
      <div ref="exportTeacherEl" class="stage-node">
        <SeatExportGraphic
          v-if="seatStore.currentPlan"
          :config="config"
          :seats="seatStore.currentSeats"
          :students="studentMap"
          view="teacher"
          :title="exportTitle"
          :subtitle="exportSubtitle('老师视角')"
        />
      </div>
      <div ref="exportStudentEl" class="stage-node">
        <SeatExportGraphic
          v-if="seatStore.currentPlan"
          :config="config"
          :seats="seatStore.currentSeats"
          :students="studentMap"
          view="student"
          :title="exportTitle"
          :subtitle="exportSubtitle('学生视角')"
        />
      </div>
      <template v-if="compareActive">
        <div ref="compareNormalEl" class="stage-node">
          <SeatExportGraphic
            v-if="comparePlanB"
            :config="config"
            :seats="comparePlanB.seats"
            :students="studentMap"
            view="teacher"
            :title="exportTitle"
            :subtitle="compareSubtitle"
          />
        </div>
        <div ref="compareChangedEl" class="stage-node">
          <SeatExportGraphic
            v-if="comparePlanB && compareResult"
            :config="config"
            :seats="comparePlanB.seats"
            :students="studentMap"
            view="teacher"
            :title="exportTitle"
            :subtitle="compareSubtitle"
            :changed-student-ids="compareResult.changedStudentIds"
            :highlight-note="`黄色描边：相对「${comparePlanA?.name}」调整了座位的学生`"
          />
        </div>
        <div ref="compareSummaryEl" class="stage-node">
          <SeatExportSummary
            v-if="compareResult"
            :title="`${config.name} 座位表 · 方案对比`"
            :subtitle="compareSummarySubtitle"
            :entries="compareResult.entries"
            :total="compareResult.total"
          />
        </div>
      </template>
    </div>

    <!-- Phase 3C：导出面板 -->
    <SeatExportDialog
      v-model="exportOpen"
      :plan-name="seatStore.currentPlan?.name ?? ''"
      :busy="exportBusy"
      @request="runExport"
    />

    <!-- Phase 3C：方案对比弹窗（选择 A/B，展示结果明细） -->
    <SeatCompareModal
      v-model="compareOpen"
      :plans="plans"
      :students="studentMap"
      :preset-a="compareSelA"
      :preset-b="compareSelB"
      v-model:plan-a-id="compareSelA"
      v-model:plan-b-id="compareSelB"
      @apply="applyCompare"
    />

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

    <!-- Phase 3C：座位约束 添加 / 管理 -->
    <ConstraintEditModal
      v-model="editConstraintOpen"
      :preset-student="editConstraintPreset"
      :students="studentStore.activeStudents"
    />
    <ConstraintManageModal v-model="manageConstraintOpen" :students="studentStore.activeStudents" />

    <!-- Phase 3D：自动排座（生成新方案；求解与落库都在本页编排，弹窗只做确认与冲突展示） -->
    <SeatArrangeModal
      v-model="arrangeOpen"
      :students="studentStore.activeStudents"
      :constraints="constraintStore.items"
      :config="config"
      :conflicts="arrangeConflicts"
      @generate="generateArrange"
    />
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

/* 方案对比查看提示条（Phase 3C） */
.compare-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-bottom: var(--space-3);
  padding: 8px 14px;
  border: 1px solid var(--color-warning);
  border-radius: var(--radius-md);
  background: var(--color-warning-soft);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.compare-hint strong {
  color: var(--color-warning-strong);
}

.compare-hint-actions {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

/* 自动排座结果条（Phase 3D） */
.arrange-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-bottom: var(--space-3);
  padding: 8px 14px;
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-md);
  background: var(--color-primary-soft);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.arrange-hint strong {
  color: var(--color-primary-strong);
}

.arrange-hint-actions {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
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

/* 右侧栏：约束检查 + 方案列表（Phase 3C 起） */
.side-col {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  width: 272px;
  flex-shrink: 0;
}

.plan-panel {
  width: 100%;
}

/* 离屏导出渲染区：常驻但不占位 / 不产生滚动条（左上极远负坐标），供 html-to-image 抓取 */
.export-stage {
  position: fixed;
  left: -10000px;
  top: -4000px;
  pointer-events: none;
  z-index: -1;
}

.stage-node {
  width: max-content;
  margin-bottom: 40px;
}

@media (max-width: 960px) {
  .seats-layout {
    flex-direction: column;
  }

  .side-col {
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
