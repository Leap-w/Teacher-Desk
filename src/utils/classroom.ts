/**
 * 课堂工具纯逻辑（V2.3.0-alpha · Phase Classroom-1）。
 *
 * **One-Tap Classroom 规范**：一秒内启动、大控件远距离可操作、直接读现有数据。
 * 三条原则在代码上的落点就是这里——组件只做渲染与交互，规则全部是可测的纯函数：
 * - 学生名单来自 Student Store（在读学生），值日组来自 Duty Store，**不维护第二份数据**；
 * - 重名消歧复用 `utils/student.ts` 的同一份实现（与档案页一致）；
 * - 随机源可注入（`rng`），因此「抽到谁」在测试里是确定的。
 */
import type { Student } from '@/types'
import { disambiguatorOf } from '@/utils/student'

/* ==================== 随机点名 ==================== */

export type PickMode = 'all' | 'male' | 'female' | 'duty'

/** 四种点名模式的元信息（顺序即界面顺序） */
export const PICK_MODES: { key: PickMode; label: string; hint: string }[] = [
  { key: 'all', label: '全班', hint: '全体在读学生' },
  { key: 'male', label: '男生', hint: '按性别筛选' },
  { key: 'female', label: '女生', hint: '按性别筛选' },
  { key: 'duty', label: '今日值日组', hint: '今天轮到的那一组' },
]

/** 点名滚动时长（拍板：约 1 秒；组件用它做动画，测试用它断言） */
export const PICK_ROLL_MS = 1000

/**
 * 某个模式的候选池。
 * - `all` / `male` / `female`：在读学生按性别筛选；
 * - `duty`：**今日值日组的成员**（传入的组员必须已在读；当天没有值日组 → 空池）。
 */
export function pickPoolFor(
  mode: PickMode,
  students: Student[],
  todayGroupStudentIds: string[] = [],
): Student[] {
  if (mode === 'all') return students
  if (mode === 'male') return students.filter((student) => student.gender === 'male')
  if (mode === 'female') return students.filter((student) => student.gender === 'female')
  const inGroup = new Set(todayGroupStudentIds)
  return students.filter((student) => inGroup.has(student.id))
}

/**
 * 从候选池随机抽一位；池空返回 undefined（界面据此显示空态，不编造名字）。
 * `rng` 可注入（默认 `Math.random`），测试里因此完全可复现。
 */
export function pickRandom(pool: Student[], rng: () => number = Math.random): Student | undefined {
  if (pool.length === 0) return undefined
  const index = Math.floor(rng() * pool.length)
  return pool[Math.min(Math.max(index, 0), pool.length - 1)]
}

/**
 * 展示用姓名（含重名消歧）：「旦增卓玛（第3组）」/「旦增卓玛（0012）」。
 * 不重名时就是姓名本身——与档案页、座位图上的写法一致。
 */
export function displayNameOf(
  student: Student,
  nameCounts: Map<string, number>,
  dutyGroupNameById: Map<string, string>,
): string {
  const suffix = disambiguatorOf(student, nameCounts, dutyGroupNameById)
  return suffix ? `${student.name}（${suffix}）` : student.name
}

/** 点名结果（组件渲染用；resolved 为 false 表示这一池是空的） */
export interface PickOutcome {
  student?: Student
  displayName?: string
  /** 空池原因（界面直接显示这句，而不是一个空框） */
  emptyReason?: string
}

const EMPTY_REASONS: Record<PickMode, string> = {
  all: '还没有在读学生，先去「学生档案」添加',
  male: '没有男生（或还没填性别）',
  female: '没有女生（或还没填性别）',
  duty: '今天没有值日组（去「值日管理」设起点）',
}

/** 抽一次：返回结果或**可读的空池原因** */
export function drawOnce(
  mode: PickMode,
  students: Student[],
  todayGroupStudentIds: string[],
  nameCounts: Map<string, number>,
  dutyGroupNameById: Map<string, string>,
  rng: () => number = Math.random,
): PickOutcome {
  const pool = pickPoolFor(mode, students, todayGroupStudentIds)
  const student = pickRandom(pool, rng)
  if (!student) return { emptyReason: EMPTY_REASONS[mode] }
  return { student, displayName: displayNameOf(student, nameCounts, dutyGroupNameById) }
}

/** 滚动动画期间循环显示的候选（约 1 秒里快速换名字） */
export function rollFrame(
  pool: Student[],
  nameCounts: Map<string, number>,
  dutyGroupNameById: Map<string, string>,
  tick: number,
): string {
  if (pool.length === 0) return '—'
  const student = pool[tick % pool.length]!
  return displayNameOf(student, nameCounts, dutyGroupNameById)
}

/** 一秒钟大约换多少个名字（讲台下看起来像「快速滚动」而不是闪屏） */
export const PICK_ROLL_TICKS = 12
/** 每个 tick 的间隔（毫秒）：12 × 83 ≈ 1000ms */
export const PICK_TICK_MS = Math.round(PICK_ROLL_MS / PICK_ROLL_TICKS)

/* ==================== 课堂计时器 ==================== */

/** 四个预设（分钟）——课堂常用：默读 / 讨论 / 练习 / 分组任务 */
export const TIMER_PRESETS_MIN = [1, 3, 5, 10] as const

/** 自定义分钟数的允许范围（1–180 分钟；超出即拒绝，不静默取整） */
export const TIMER_MIN_MINUTES = 1
export const TIMER_MAX_MINUTES = 180

/** 校验自定义分钟数：整数且在范围内才接受 */
export function isValidMinutes(value: number): boolean {
  return Number.isInteger(value) && value >= TIMER_MIN_MINUTES && value <= TIMER_MAX_MINUTES
}

/** 毫秒 → `MM:SS`（不足两位补零；超过 99 分钟按实际位数显示） */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/** 剩余时间（毫秒）；不会小于 0（到点即 0，界面据此提示） */
export function remainingMs(totalMs: number, elapsedMs: number): number {
  return Math.max(0, totalMs - elapsedMs)
}

/** 是否已到点（剩余为 0） */
export function isFinished(totalMs: number, elapsedMs: number): boolean {
  return remainingMs(totalMs, elapsedMs) === 0
}

/** 计时进度 0–1（进度环 / 进度条用；总时为 0 视为已完成） */
export function timerProgress(totalMs: number, elapsedMs: number): number {
  if (totalMs <= 0) return 1
  return Math.min(1, Math.max(0, elapsedMs / totalMs))
}

/** 计时器界面状态机（组件只做映射） */
export type TimerPhase = 'idle' | 'running' | 'paused' | 'finished'

export function nextPhase(
  current: TimerPhase,
  action: 'start' | 'pause' | 'reset' | 'tick',
): TimerPhase {
  if (action === 'reset') return 'idle'
  if (action === 'tick') return current === 'running' ? 'finished' : current
  if (action === 'pause') return current === 'running' ? 'paused' : current
  // start：空闲 / 暂停 / 已结束（重新开始）都能进 running；运行中按「暂停」处理更符合直觉
  if (current === 'running') return 'paused'
  return 'running'
}

/* ==================== 抽签（值日组） ==================== */

/** 抽签用的组信息（只读投影，不新增分组模型） */
export interface LotteryGroup {
  id: string
  name: string
  memberCount: number
}

/**
 * 从值日组里随机抽一组；空数组返回 undefined（界面显示「还没有值日组」）。
 * 与点名同样支持注入 rng。
 */
export function pickRandomGroup(
  groups: LotteryGroup[],
  rng: () => number = Math.random,
): LotteryGroup | undefined {
  if (groups.length === 0) return undefined
  const index = Math.floor(rng() * groups.length)
  return groups[Math.min(Math.max(index, 0), groups.length - 1)]
}

/** 抽签结果文案：「第2组」这种组名直接来自值日管理，不在这里改口径 */
export function groupResultLabel(group: LotteryGroup | undefined): string {
  return group ? group.name : '还没有值日组'
}

/* ==================== 防连点 / 后台恢复（RC-03 · RC-04） ==================== */

/**
 * 点名 / 抽签的防连点窗口（毫秒）。
 * 取值 = 滚动动画时长：讲台上连点两下不该抽出两个人——动画期间与刚定格的瞬间都不重开。
 */
export const DRAW_COOLDOWN_MS = PICK_ROLL_MS

/** 计时器控制按钮的防抖窗口：双击「开始」不该被读成「开始 → 暂停」 */
export const CONTROL_DEBOUNCE_MS = 300

/**
 * 某个时刻是否允许触发。`lastAt` 为 `null` 表示从未触发过。
 * 纯函数、时钟由调用方给 → 测试里不需要真的等 1 秒。
 */
export function canTrigger(
  lastAt: number | null,
  now: number,
  cooldown = DRAW_COOLDOWN_MS,
): boolean {
  if (lastAt === null) return true
  return now - lastAt >= cooldown
}

/** 计时器控制按钮（开始 / 暂停 / 重置）是否允许触发：比防连点短得多的一档 */
export function canTriggerControl(lastAt: number | null, now: number): boolean {
  return canTrigger(lastAt, now, CONTROL_DEBOUNCE_MS)
}

/**
 * 已计时毫秒（RC-04）：**用时间戳相减，不累加 tick**。
 *
 * 浏览器会把后台标签页的 `setInterval` 压到 1 秒甚至更慢，累加 tick 的计时器
 * 一切后台回来就会少走一截（教师在讲台上切到课件再切回来，时间就不对了）。
 * 起跑时刻记一次、每次刷新用「现在 − 起跑」重算，因此切后台 / 回前台都准。
 */
export function elapsedSince(startedAt: number, now: number, totalMs: number): number {
  return Math.min(Math.max(0, now - startedAt), totalMs)
}

/* ==================== 页面元信息 ==================== */

/** 三个工具（页面横排的卡片顺序；测试据此断言「只做三个」） */
export const CLASSROOM_TOOLS = [
  { key: 'picker', title: '随机点名', description: '全班 / 男生 / 女生 / 今日值日组' },
  { key: 'timer', title: '课堂计时器', description: '1 / 3 / 5 / 10 分钟或自定义' },
  { key: 'lottery', title: '抽签', description: '从值日组里随机抽一组' },
] as const
