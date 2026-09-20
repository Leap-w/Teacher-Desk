<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { AppButton, AppField, AppInput, AppModal, EmptyState } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useSeatStage } from '@/composables/useSeatStage'
import { useAppSettingsStore } from '@/stores/appSettings'
import { useStudentStore } from '@/stores/student'
import { useSeatStore } from '@/stores/seat'
import { useConstraintStore } from '@/stores/constraint'
import { seatPositionLong, compareSeatPlans } from '@/utils/seat'
import { checkSeatConstraints } from '@/utils/constraint'
import { countSeatPlanConstraints } from '@/utils/seatPlanConstraint'
import type { SeatPlanConstraintReport } from '@/utils/seatPlanConstraint'
import { arrangeSeats } from '@/utils/seatArrange'
import type { ConstraintIssue } from '@/utils/constraint'
import { VIEW_NOTES } from '@/utils/seatView'
import {
  exportDateLabel,
  exportDateStamp,
  renderExportNode,
  createPdf,
  embedPdfImage,
} from '@/utils/seatExport'
import type { SeatExportKind } from '@/utils/seatExport'
import {
  buildSeatWorkbookFromTemplate,
  downloadXlsx,
  loadSeatTemplate,
} from '@/utils/seatTemplateXlsx'
import { formatStudentShortName } from '@/utils/student'
import StudentDetailModal from '@/views/Students/components/StudentDetailModal.vue'
import type { Seat, SeatChangeLog, SeatPlan } from '@/types/seat'
import type { Student } from '@/types'
import SeatClassroom from './components/SeatClassroom.vue'
import SeatCanvas from './components/SeatCanvas.vue'
import SeatExportMenu from './components/SeatExportMenu.vue'
import SeatStatusBar from './components/SeatStatusBar.vue'
import SeatToolbar from './components/SeatToolbar.vue'
import SeatPlanPanel from './components/SeatPlanPanel.vue'
import SeatSearch from './components/SeatSearch.vue'
import ConstraintEditModal from './components/ConstraintEditModal.vue'
import ConstraintManageModal from './components/ConstraintManageModal.vue'
import SeatExportGraphic from './components/SeatExportGraphic.vue'
import SeatExportSummary from './components/SeatExportSummary.vue'
import SeatCompareModal from './components/SeatCompareModal.vue'
import SeatMoreMenu from './components/SeatMoreMenu.vue'
import SeatZoomBar from './components/SeatZoomBar.vue'
import type { SeatMoreAction } from './components/SeatMoreMenu.vue'
import SeatArrangeModal from './components/SeatArrangeModal.vue'
import SeatImportModal from './components/SeatImportModal.vue'
import SettingsEntryButton from '@/components/layout/SettingsEntryButton.vue'
import SeatConstraintModal from './components/SeatConstraintModal.vue'
import { Armchair } from 'lucide-vue-next'
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
const appSettings = useAppSettingsStore()
const toast = useToast()

/**
 * 本页所有「某某学生」的文案都走这里（v3.3.1）：toast、确认弹窗、换座提示条一律同一份重名规则。
 * 散着写 `formatStudentShortName(student)` 的话，加一个参数就得满页找一遍——漏掉的那处
 * 恰恰会显示成「旦增卓玛」，而教师下一句就要问「哪个旦增卓玛」。
 */
function nameOf(student: Pick<Student, 'name' | 'idCardSuffix'>): string {
  return formatStudentShortName(student, studentStore.nameCounts)
}

/** 教室参数唯一来源：store.config（即 DEFAULT_CLASSROOM_CONFIG），页面不另写教室数字 */
const config = seatStore.config

/**
 * 视角（v3.3.0）：**开局取「教学设置 → 座位图默认视角」**，进来就是教师要的那一面，
 * 不必每次进门再切一次。进门之后在页内的切换是临时的、不写盘——
 * 临时看一眼学生视角不等于改了默认偏好（改默认偏好去设置页）。
 */
const view = ref<SeatView>(appSettings.seatDefaultView)
const selectedSeatId = ref<string | undefined>(undefined)

const plans = computed(() => seatStore.plans)
const removingPlan = ref<SeatPlan | undefined>(undefined)
const confirmOpen = ref(false)
/** v3.2.0：方案管理弹窗（原右侧「座位方案」卡片的内容；入口在方案下拉的「管理方案」） */
const planManageOpen = ref(false)

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

/** UI-4B：方案切换器选项（胶囊 Dropdown 用；创建时间来自方案元数据，只读） */
const schemeOptions = computed(() =>
  plans.value.map((plan) => ({
    id: plan.id,
    name: plan.name,
    createdAt: plan.createdAt,
    isCurrent: plan.isCurrent,
  })),
)

/** 底部状态栏：最后修改时间（本地格式，只读展示） */
const planUpdatedAtLabel = computed(() => {
  const iso = seatStore.currentPlan?.updatedAt
  if (!iso) return undefined
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return undefined
  const hhmm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${hhmm}`
})

/** 页面副标题：教室配置 + 当前就座进度，全部来自 config */
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
 *
 * V1.1.2 Phase 1：换座完成后**立刻重跑排座约束检查**——违反也允许操作完成（不自动撤销、
 * 不拦截），但必须马上让教师看见（闪烁涉及座位 + 提示条 + toast）。前排 / 后排偏好
 * 只是提醒，永不阻止拖拽。
 */
function applySeatChange(fromId: string, toId: string) {
  const fromSeat = seatsById.value.get(fromId)
  const toSeat = seatsById.value.get(toId)
  if (!fromSeat || !toSeat) return
  const fromStudent = seatStudent(fromId)
  const toStudent = seatStudent(toId)
  if (!fromStudent) return
  const reportBefore = seatStore.constraintReport
  if (toStudent) {
    if (!seatStore.swapSeats(fromId, toId)) {
      changeFailed()
      return
    }
    toast.success(`已交换：${nameOf(fromStudent)} ↔ ${nameOf(toStudent)}`)
    announceConstraintWarnings(reportBefore)
    return
  }
  if (!seatStore.moveStudent(fromId, toId)) {
    changeFailed()
    return
  }
  toast.success(`已移动：${nameOf(fromStudent)} → ${seatPositionLong(toSeat.row, toSeat.col)}`)
  announceConstraintWarnings(reportBefore)
}

/* ========== V1.1.2 Phase 1：排座约束（方案级）与 Excel 导入 ========== */

const importOpen = ref(false)
const constraintOpen = ref(false)

/** 当前方案的约束条数与检查结论（约束属于方案，切方案即换一套） */
const planConstraintCount = computed(() => countSeatPlanConstraints(seatStore.currentConstraints))
const planIssues = computed(() => seatStore.constraintReport.issues)
const planErrorCount = computed(() => seatStore.constraintReport.errors.length)

/** 约束提示条上的文案（错误优先说明） */
const planIssueSummary = computed(() => {
  const errors = seatStore.constraintReport.errors.length
  const warnings = seatStore.constraintReport.warnings.length
  const parts: string[] = []
  if (errors > 0) parts.push(`${errors} 项冲突`)
  if (warnings > 0) parts.push(`${warnings} 项提醒`)
  return parts.join(' · ')
})

/**
 * 换座后的即时约束提示：只报**这次操作新产生的**冲突（操作前就存在的老问题不重复喊），
 * 闪烁涉及座位并弹一条提示；**不撤销、不阻止**。
 */
function announceConstraintWarnings(before: SeatPlanConstraintReport) {
  const beforeKeys = new Set(before.errors.map((issue) => issue.key))
  const added = seatStore.constraintReport.errors.filter((issue) => !beforeKeys.has(issue.key))
  if (added.length === 0) return
  flashSeats(added.flatMap((issue) => issue.seatIds))
  const first = added[0]!
  toast.warning(
    added.length === 1
      ? `换座后违反排座约束：${first.message}`
      : `换座后违反 ${added.length} 条排座约束：${first.message} 等`,
  )
}

/** 约束弹窗内点「定位」：闪烁涉及座位并滚动到第一个 */
function locateConstraintSeats(seatIds: string[]) {
  if (seatIds.length === 0) return
  constraintOpen.value = false
  flashSeats(seatIds)
  classroomRef.value?.revealSeat(seatIds[0]!)
}

/** 普通点击座位：选中 / 再次点击取消选中（选中态跨视角保持） */
function onPickSeat(seatId: string) {
  selectedSeatId.value = selectedSeatId.value === seatId ? undefined : seatId
}

/* ========== Phase 3B：点击换座模式（长按卡「开始换座」触发） ========== */

const pickerFrom = ref<string | undefined>(undefined)

const pickerLabel = computed(() => {
  const student = pickerFrom.value ? seatStudent(pickerFrom.value) : undefined
  return student ? nameOf(student) : ''
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
  if (comparePair.value && !compareOpen.value) {
    exitCompare()
    return
  }
  /*
    v3.4.0：最后一档才是「退出铺满」——由深到浅，一次 Esc 只做一件事
    （换座模式 > 对比视图 > 铺满）。`handleEscape` 内部还有两道守卫：
    浏览器全屏时不抢（那个 Esc 归浏览器，状态由 fullscreenchange 同步），
    以及不在层级栈最上层时不抢（弹窗 / 长按卡开着时 Esc 归它们）。
  */
  stage.handleEscape()
}

/*
  **捕获阶段**注册（第三个参数 `true`）：本页的 Esc 链必须比其他弹层先拿到这次按键。
  原因在 v3.4.0 加铺满时暴露出来：弹窗（AppModal）的 Esc 处理器挂在 **document 冒泡**上，
  而本页挂在 window 上——冒泡顺序是 target → document → window，于是**弹窗先关、自己的
  层级令牌先弹**，等本页的 `stage.handleEscape()` 轮到执行时，层级栈里已经没有弹窗了，
  「只接最上层」的守卫形同虚设 → 一次 Esc 既关弹窗又退出铺满。
  改到捕获阶段（window 捕获 → document → target → …）就天然先于弹窗判断，守卫才成立。
*/
onMounted(() => window.addEventListener('keydown', onWindowKeydown, true))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeydown, true)
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
  toast.success(`已从学生列表中移除 ${nameOf(target)}`)
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

/* ========== v3.4.0：座位图一屏自适应 / 两种全屏（几何的唯一持有者在本页） ========== */
/**
 * 座位图**以下**、又在本组件之外的固定占高（px）：
 * 画布（AppCard 的 `padding-normal` = 24）+ 页面间距 16 + 壳层下留白 32。
 * 状态栏的高度单独实测（窄屏它会换行，写死会少算）。
 *
 * 为什么要把这个数报给 `useSeatStage`：拟合的语义是「从顶栏下沿算起的一屏」，
 * 座位图**下面的**两条说明与状态栏也在这一屏里——不扣掉它们，图会把状态栏顶出屏幕，
 * 看着「装下了」其实还差一条。
 */
const SEAT_PAGE_BELOW_PX = 72

const statusBarRef = ref<InstanceType<typeof SeatStatusBar>>()

function statusBarHeight(): number {
  const el = statusBarRef.value?.$el as HTMLElement | undefined
  return el?.offsetHeight ?? 0
}

const stage = useSeatStage({
  belowReserve: () => SEAT_PAGE_BELOW_PX + statusBarHeight(),
})

/** 控制条与模板直接用的那几个（解构出来给模板自动脱 ref） */
const {
  scaleLabel,
  mode: scaleMode,
  fullscreen: seatFullscreen,
  browserFullscreen: seatBrowserFullscreen,
  fullscreenSupported: seatFullscreenSupported,
  atMin: scaleAtMin,
  atMax: scaleAtMax,
  zoomIn: zoomSeatIn,
  zoomOut: zoomSeatOut,
  resetFit: resetSeatFit,
  toggleOverlay: toggleSeatOverlay,
  toggleBrowserFullscreen: toggleSeatBrowserFullscreen,
} = stage

/* ========== Phase 3C：学生定位（搜索 / 约束定位共用：滚动 + 闪烁 + 信息卡） ========== */

const classroomRef = ref<InstanceType<typeof SeatClassroom>>()

/**
 * 绑定三层缩放结构。**用 watch 而不是 onMounted**：`SeatClassroom` 挂在
 * `v-if="seatStore.currentPlan"` 下，第一个方案可能是本页挂载之后才建的——
 * 那一刻 `onMounted` 早就跑完了，元素拿不到，量出来全是 0（图会一动不动）。
 * watch 在组件挂上 / 卸下时各触发一次，卸载时 `stageEls()` 回 undefined，
 * `bindEls(undefined)` 正好把监听解掉。
 */
watch(classroomRef, (instance) => {
  stage.bindEls(instance?.stageEls())
})

/** 控制条左侧的状态位：全屏时这是页面里唯一还看得见的操作提示（hint 条会被盖住） */
const stageStatusNote = computed(() => {
  if (pickerFrom.value) return '换座中：点目标座位完成交换，Esc 取消'
  if (compareActive.value) return '方案对比查看中：只读'
  return undefined
})
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
    toast.info(`${nameOf(student)} 当前未就座，请先安排座位`)
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
/**
 * 「更多」菜单（v3.3.0 建；v3.3.1 补齐方案动作）：
 * 前两个动作各自打开原有的弹窗，逻辑零改动；后三个作用于**当前方案**，
 * 把原先藏在「方案下拉 → 管理方案」里的重命名 / 删除拉到一点即达，并补上复制。
 */
function onMoreAction(action: SeatMoreAction): void {
  if (action === 'arrange') openArrange()
  else if (action === 'compare') compareOpen.value = true
  else if (action === 'rename') askRename()
  else if (action === 'duplicate') duplicateCurrentPlan()
  else askRemoveCurrent()
}

/* ========== v3.3.1：当前方案的 重命名 / 复制 / 删除 ========== */

const renameOpen = ref(false)
const renameDraft = ref('')

function askRename(): void {
  const current = seatStore.currentPlan
  if (!current) return
  renameDraft.value = current.name
  renameOpen.value = true
}

function confirmRename(): void {
  const current = seatStore.currentPlan
  const name = renameDraft.value.trim()
  renameOpen.value = false
  if (!current) return
  if (!name) {
    toast.info('方案名不能为空，未改名')
    return
  }
  handleRename(current.id, name)
}

/** 副本名（不与现有方案重名：「张三 副本」「张三 副本 2」…） */
function nextCopyName(base: string): string {
  const first = `${base} 副本`
  if (!plans.value.some((plan) => plan.name === first)) return first
  let n = 2
  while (plans.value.some((plan) => plan.name === `${first} ${n}`)) n++
  return `${first} ${n}`
}

/**
 * 复制方案：座位与约束照搬，**换座记录不复制**——那是原方案的历史，
 * 复制品从「此刻的座位」开始。副本立即成为当前方案（store 的既有语义）。
 *
 * 约束不随座位走：`createPlanFromSeats` 建的是空约束，所以复制完再写一次
 * （`writeConstraints` 写的就是当前方案，且会自动规范化）。
 */
function duplicateCurrentPlan(): void {
  const current = seatStore.currentPlan
  if (!current) return
  const hadPending = seatStore.pendingLogsCount > 0
  const created = seatStore.createPlanFromSeats(current.seats, nextCopyName(current.name))
  seatStore.writeConstraints({
    sameDeskForbidden: current.constraints.sameDeskForbidden.map((rule) => ({ ...rule })),
    adjacentGroupForbidden: current.constraints.adjacentGroupForbidden.map((rule) => ({
      ...rule,
      students: [...rule.students] as [string, string, string],
    })),
    frontRowStudents: [...current.constraints.frontRowStudents],
    backRowStudents: [...current.constraints.backRowStudents],
  })
  selectedSeatId.value = undefined
  cancelPicker()
  clearFlash()
  if (hadPending) toast.info('已复制方案：未保存的「本次调整」记录已清空')
  toast.success(`已复制为「${created.name}」并切换为当前`)
}

/**
 * 删除**当前**方案：store 规定「当前方案不可删」，所以这里先切到另一份再删，
 * 确认弹窗把「会切到哪一份」说在前面。只剩一份方案时菜单项灰着（删完就没方案了）。
 */
const removeCurrentOpen = ref(false)

const removeFallback = computed(() =>
  plans.value.find((plan) => plan.id !== seatStore.currentPlan?.id),
)

function askRemoveCurrent(): void {
  if (!seatStore.currentPlan || !removeFallback.value) return
  removeCurrentOpen.value = true
}

function confirmRemoveCurrent(): void {
  const target = seatStore.currentPlan
  const fallback = removeFallback.value
  removeCurrentOpen.value = false
  if (!target || !fallback) return
  const hadPending = seatStore.pendingLogsCount > 0
  if (!seatStore.switchPlan(fallback.id) || seatStore.currentPlan?.id !== fallback.id) {
    toast.danger('删除失败：方案已变化，请刷新后重试')
    return
  }
  if (!seatStore.removePlan(target.id)) {
    toast.danger('删除失败：该方案未能删除，请刷新后重试')
    return
  }
  selectedSeatId.value = undefined
  cancelPicker()
  clearFlash()
  if (hadPending) toast.info('已删除方案：未保存的「本次调整」记录已清空')
  toast.success(`已删除「${target.name}」，当前方案为「${fallback.name}」`)
}

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
    if (kind === 'pdf-dual') {
      // 双视角 PDF（v3.4.0）：**一个视角一页**，每页都是横向 A4 整页铺满。
      // 此前是一页上、下半各塞一张——横向页比竖版矮 87mm，再对半分就真的看不清了。
      // v3.5.1：页序改成**老师视角在前**（验收标准口径）。v3.4.0 是学生视角在前，
      // 那版顺序没有任何文档依据，两者只有先后的区别，版面完全一样。
      const pdf = createPdf()
      const teacherCanvas = await captureNode(exportTeacherEl.value)
      embedPdfImage(pdf, teacherCanvas, { y: 10 })
      pdf.addPage()
      const studentCanvas = await captureNode(exportStudentEl.value)
      embedPdfImage(pdf, studentCanvas, { y: 10 })
      pdf.save(`${base}-双视角.pdf`)
    } else {
      // Excel（v3.5.1）：**复制需求方模板 `docs/座位图-9.3.xlsx` → 只改文字 → 导出**，
      // 两个视角各一张工作表。样式一律来自模板本身，这里只给标题 / 日期 / 63 个姓名。
      // 文件名照需求方口径走「{班级}座位图_{YYYY-MM-DD}.xlsx」（表内日期是点分格式，
      // 两个格式都是需求方写死的，见 utils/seatExport.ts 的 exportDateDotted）
      const buffer = await buildSeatWorkbookFromTemplate(await loadSeatTemplate(), {
        title: `${config.name}座位图`,
        date: new Date(),
        sheets: [
          { sheetName: '学生视角', seats: seatStore.currentSeats, students: studentMap.value },
          { sheetName: '老师视角', seats: seatStore.currentSeats, students: studentMap.value },
        ],
      })
      if (!downloadXlsx(buffer, `${config.name}座位图_${exportDateStamp()}.xlsx`)) {
        throw new Error('浏览器未接受下载')
      }
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
    <!--
      ========== Layer 1：页头（v3.3.0 三层结构） ==========
      ① 方案 + 人数 / 状态 + 视角   ② 搜索独占一行   ③ 工具 | 导入导出
      业务动作仍在本页编排，组件只负责分层摆放（见 SeatToolbar 的文件头）。
    -->
    <SeatToolbar
      v-model:view="view"
      v-model:scheme-id="currentPlanId"
      :occupancy="`${seatStore.occupiedCount}/${config.occupiedSeats}`"
      :pending-count="seatStore.pendingLogsCount"
      :view-note="VIEW_NOTES[view]"
      :scheme-options="schemeOptions"
      :scheme-disabled="!plans.length"
      @scheme-create="createPlan"
      @scheme-manage="planManageOpen = true"
    >
      <!-- 第一层：与「已保存 / 编辑中」同处一行的状态动作 -->
      <template #state>
        <AppButton
          v-if="hasPending"
          variant="secondary"
          title="把本次调整记录归档到当前方案"
          @click="saveAdjustments"
        >
          保存调整（{{ seatStore.pendingLogsCount }}）
        </AppButton>
      </template>

      <!-- 第二层：学生定位（姓名 / 学号后四位），独占一行 -->
      <template #search>
        <SeatSearch
          :students="studentStore.activeStudents"
          :position-of="searchPositionOf"
          @locate="locateStudent"
        />
      </template>

      <!-- 第三层左：对这个班做什么 -->
      <template #tools>
        <SettingsEntryButton module="seats" />
        <AppButton
          variant="secondary"
          :disabled="!seatStore.currentPlan"
          title="不能同桌 / 三人不能相邻 / 前排后排标记"
          @click="constraintOpen = true"
        >
          约束{{ planConstraintCount > 0 ? `（${planConstraintCount}）` : '' }}
        </AppButton>
        <!--
          自动排座与方案对比**都已实现**（Phase 3D / Phase 3C，各有弹窗与撤销），
          按「未实现才删」的原则保留；收进「更多」只是不再让它们常驻占一排。
        -->
        <SeatMoreMenu
          v-if="!compareActive"
          :arrange-disabled="!seatStore.currentPlan || studentStore.activeStudents.length === 0"
          :compare-disabled="plans.length < 2"
          :plan-disabled="!seatStore.currentPlan"
          :remove-disabled="plans.length < 2"
          @choose="onMoreAction"
        />
      </template>

      <!-- 第三层右：数据进出 -->
      <template #actions>
        <template v-if="!compareActive">
          <AppButton
            variant="secondary"
            :disabled="!seatStore.currentPlan"
            title="从 Excel 批量导入座位安排（先预览后写入）"
            @click="importOpen = true"
          >
            导入
          </AppButton>
          <SeatExportMenu
            :disabled="!seatStore.currentPlan"
            :busy="exportBusy"
            @request="runExport"
          />
        </template>
      </template>
    </SeatToolbar>

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

    <!-- V1.1.2 Phase 1：方案级排座约束的结果条（错误红 / 提醒琥珀；换座后自动刷新） -->
    <div
      v-if="planIssues.length > 0 && !compareActive"
      class="plan-constraint-hint"
      :class="{ 'is-error': planErrorCount > 0 }"
      role="status"
    >
      <span class="plan-constraint-text">
        排座约束：<strong>{{ planIssueSummary }}</strong>
        <template v-if="planErrorCount === 0"> · 仅排座偏好提醒，不影响拖拽换座</template>
        <template v-else> · 冲突需自行调整座位（不会自动撤销你的操作）</template>
        <span class="plan-constraint-detail">——{{ planIssues[0]?.message }}</span>
      </span>
      <span class="plan-constraint-actions">
        <AppButton
          size="sm"
          variant="ghost"
          @click="locateConstraintSeats(planIssues[0]?.seatIds ?? [])"
        >
          定位
        </AppButton>
        <AppButton size="sm" @click="constraintOpen = true">管理约束</AppButton>
      </span>
    </div>

    <!--
      ========== Layer 2：教室画布（页面视觉中心） ==========
      v3.2.0：右侧的「约束检查」与「座位方案」两张卡片整体撤下——座位图从
      「减掉 272px 侧栏的主区域」变回整页主体（参考图口径：一页只有一张图）。
      两卡的功能一个都没丢，只是各归其位：
      · 约束检查 → 顶部「约束」按钮打开的排座约束弹窗（结论在弹窗顶部，可定位）；
      · 座位方案 → 方案切换器下拉里的「管理方案」（重命名 / 删除 / 新建）。
    -->
    <SeatCanvas class="room-canvas">
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
        :fullscreen="seatFullscreen"
        @select="handleSeatClick"
        @change="applySeatChange"
        @quick-detail="openStudentDetail"
        @quick-swap="startPicker"
        @quick-constraint="openConstraintForSeat"
      >
        <!--
          v3.4.0 缩放 / 全屏控制条。**必须注入到座位图组件内部**：
          应用内全屏时座位图铺满整个视口、SeatToolbar 被盖住，
          控制条在那边就等于「进去了出不来」（详见 SeatZoomBar 的说明）。
        -->
        <template #controls>
          <SeatZoomBar
            :scale-label="scaleLabel"
            :at-min="scaleAtMin"
            :at-max="scaleAtMax"
            :mode="scaleMode"
            :fullscreen="seatFullscreen"
            :browser-fullscreen="seatBrowserFullscreen"
            :fullscreen-supported="seatFullscreenSupported"
            :status-note="stageStatusNote"
            :status-active="Boolean(pickerFrom)"
            @zoom-in="zoomSeatIn"
            @zoom-out="zoomSeatOut"
            @fit="resetSeatFit"
            @toggle-overlay="toggleSeatOverlay"
            @toggle-fullscreen="toggleSeatBrowserFullscreen"
          />
        </template>
      </SeatClassroom>
      <EmptyState
        v-else
        :icon="Armchair"
        title="暂无座位方案"
        description="在上方方案切换器里选择「新建方案」，创建第一份排座方案。"
      >
        <AppButton size="sm" @click="createPlan">新建方案</AppButton>
      </EmptyState>
    </SeatCanvas>

    <!-- ========== Layer 3：底部状态栏（最低视觉权重；右侧放座位标记图例） ========== -->
    <SeatStatusBar
      ref="statusBarRef"
      :plan-name="seatStore.currentPlan?.name ?? '—'"
      :updated-at="planUpdatedAtLabel"
      :pending-count="seatStore.pendingLogsCount"
    >
      <ul class="legend" aria-label="座位标记图例">
        <li v-for="item in ACCENT_LEGEND" :key="item.key" class="legend-item">
          <i class="swatch" :class="[item.cls, { 'is-dot': item.dot }]" aria-hidden="true"></i>
          {{ item.label }}
        </li>
      </ul>
    </SeatStatusBar>

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

    <!-- Phase 3C：导出入口已并入工具栏导出菜单（SeatExportMenu，执行逻辑不变） -->

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

    <!--
      v3.2.0：右侧「座位方案」卡片撤下后，这里接住它的全部能力——
      SeatPlanPanel 组件一行未改，只是从常驻侧栏改成弹窗内展示，
      入口在工具栏方案下拉的「管理方案（重命名 / 删除）」。
    -->
    <AppModal v-model="planManageOpen" title="管理座位方案" :width="520">
      <SeatPlanPanel
        :plans="plans"
        :occupied-seats="config.occupiedSeats"
        @create="createPlan"
        @select="currentPlanId = $event"
        @rename="handleRename"
        @remove="askRemove"
      />
    </AppModal>

    <!-- v3.3.1：当前方案的重命名 / 删除（「更多」菜单的入口；删除需先切走，弹窗说清切到哪份） -->
    <AppModal v-model="renameOpen" title="重命名方案" :width="400">
      <AppField label="方案名称">
        <AppInput
          v-model="renameDraft"
          :maxlength="20"
          autofocus
          placeholder="如「第一次月考后」"
          @keydown.enter.prevent="confirmRename"
        />
      </AppField>
      <template #footer>
        <AppButton variant="ghost" @click="renameOpen = false">取消</AppButton>
        <AppButton @click="confirmRename">保存</AppButton>
      </template>
    </AppModal>

    <AppModal v-model="removeCurrentOpen" title="删除方案" :width="400">
      <p class="confirm-text">
        确定删除当前方案
        <strong>{{ seatStore.currentPlan ? seatStore.currentPlan.name : '' }}</strong>
        吗？删除后无法恢复，该方案的换座记录一并删除。
      </p>
      <p class="confirm-text confirm-text--sub">
        当前方案将切换为
        <strong>{{ removeFallback ? removeFallback.name : '' }}</strong>
        。
      </p>
      <template #footer>
        <AppButton variant="ghost" @click="removeCurrentOpen = false">取消</AppButton>
        <AppButton variant="danger" @click="confirmRemoveCurrent">删除方案</AppButton>
      </template>
    </AppModal>

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
        <strong>{{ removingStudent ? nameOf(removingStudent) : '' }}</strong>
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

    <!-- V1.1.2 Phase 1：Excel 座位导入 + 方案级排座约束 -->
    <SeatImportModal v-model="importOpen" />
    <!-- v3.2.0：本弹窗是排座约束的**唯一**入口——方案规则（上面）与座位约束检查
         （v3.2.0 从右侧卡片并入）同屏，检查行可定位，添加 / 管理都从这里进。 -->
    <SeatConstraintModal
      v-model="constraintOpen"
      :issues="constraintIssues"
      :total-constraints="constraintStore.items.length"
      @locate="locateConstraintSeats"
      @locate-issue="locateIssue"
      @add="openAddConstraint"
      @manage="manageConstraintOpen = true"
    />
  </div>
</template>

<style scoped>
.seats-page {
  max-width: var(--page-max-width);
  /*
    v3.3.0 这里曾用负外边距把本页页边距单独压到 24px（当时全站是 32px）。
    v3.3.1 §七 把 `--page-pad-x` 全站改成 24px 之后，那处特例自动归零，
    于是删掉——座位页不再需要「和别人不一样」的补丁，宽度由全局令牌一份定义。
  */

  /* 页头三层 + 画布 + 状态栏之间的间距 */
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* v3.4.0：此处原有 `.seats-page > .seat-bar { margin-bottom: 0 }`——那是专为吸顶写的
   补丁（页头自带 margin-bottom，与 flex gap 叠加会变成 32px）。取消吸顶后页头的
   margin-bottom 已直接删除（见 SeatToolbar），这条补丁随之作废，间距仍是 gap 的 16px。 */

/* 图例（放在 SeatStatusBar 右侧插槽，最低视觉权重） */
.legend {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  list-style: none;
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
  border-radius: var(--radius-full);
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

/* 方案级排座约束结果条（V1.1.2 Phase 1）：默认琥珀（提醒），有冲突转红 */
.plan-constraint-hint {
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

.plan-constraint-hint.is-error {
  border-color: var(--color-danger);
  background: var(--color-danger-soft);
}

.plan-constraint-hint strong {
  color: var(--color-warning-strong);
}

.plan-constraint-hint.is-error strong {
  color: var(--color-danger-strong);
}

.plan-constraint-detail {
  margin-left: var(--space-2);
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}

.plan-constraint-actions {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

/* 教室画布（视觉中心）：独占整个主体区域，不再与右侧栏分宽 */
.room-canvas {
  width: 100%;
  min-width: 0;
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

/* 第二段说明（当前方案会切到哪一份）：弱一档，不与主问句抢注意力 */
.confirm-text--sub {
  margin-top: var(--space-2);
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.confirm-text--sub strong {
  color: var(--color-text-secondary);
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
