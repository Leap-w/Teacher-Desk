import { createId } from '@/utils/id'
import type { SelectOption } from '@/types'
import type { HalfDay, LeavePoint, LeaveRecord, LeaveStatus, LeaveType } from '@/types/leave'

/** 请假类型中文文案（表单选项、列表徽标共用一处） */
export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  sick: '病假',
  personal: '事假',
  other: '其他',
}

/** 请假类型表单选项 */
export const LEAVE_TYPE_OPTIONS: SelectOption<LeaveType>[] = [
  { label: LEAVE_TYPE_LABELS.sick, value: 'sick' },
  { label: LEAVE_TYPE_LABELS.personal, value: 'personal' },
  { label: LEAVE_TYPE_LABELS.other, value: 'other' },
]

/** 审批状态中文文案（列表徽标、筛选共用） */
export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: '待处理',
  approved: '已批准',
  rejected: '已驳回',
}

/** 半天中文文案（时间点文案经 formatLeavePoint / formatLeavePeriod 间接使用） */
const HALF_DAY_LABELS: Record<HalfDay, string> = { am: '上午', pm: '下午' }

/** 半天表单选项（顺序即时间顺序） */
export const HALF_DAY_OPTIONS: SelectOption<HalfDay>[] = [
  { label: HALF_DAY_LABELS.am, value: 'am' },
  { label: HALF_DAY_LABELS.pm, value: 'pm' },
]

/** 全部已知请假类型（load 守卫与写入校验共用；类型值扩展时同步） */
export const KNOWN_LEAVE_TYPES: readonly LeaveType[] = ['sick', 'personal', 'other']

/** 全部已知审批状态（load 守卫用） */
const KNOWN_LEAVE_STATUSES: readonly LeaveStatus[] = ['pending', 'approved', 'rejected']

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MS_PER_DAY = 86_400_000

/**
 * 日期键 → 天序号（1970-01-01 起的天数，两个天序号相减即相隔天数）。
 * 用 `Date.UTC` 按年 / 月 / 日构造，全程 UTC，不读本地时区与夏令时；
 * 跨月 / 跨年的进位交给日历本身——直接对 `YYYYMMDD` 做十进制算术，
 * 会在 9-30 → 10-01 这种进位处把相差 1 天算成 71 天。
 */
function dayIndexOf(dateKey: string): number {
  const year = Number(dateKey.slice(0, 4))
  const month = Number(dateKey.slice(5, 7))
  const day = Number(dateKey.slice(8, 10))
  return Date.UTC(year, month - 1, day) / MS_PER_DAY
}

/**
 * 日期键守卫：`YYYY-MM-DD` 且**这一天真实存在**。
 * 只判 `1..12 月` `1..31 日` 会放过「2 月 31 日」——它既会让
 * `<input type="date">` 静默渲染为空（教师看着空日期点保存），
 * 又会让时长计算凭空多出几天；因此回读校验：`Date` 会把不存在的
 * 日期顺延（2-31 → 3-3），对不上即拒绝（同 normalizeLesson 的「严格判定」口径）。
 */
function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_KEY_PATTERN.test(value)) return false
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const roundTrip = new Date(Date.UTC(year, month - 1, day))
  return (
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() + 1 === month &&
    roundTrip.getUTCDate() === day
  )
}

/** 半天守卫 */
function isHalfDay(value: unknown): value is HalfDay {
  return value === 'am' || value === 'pm'
}

/** 时间点守卫（日期 + 半天） */
export function isLeavePoint(value: unknown): value is LeavePoint {
  if (!value || typeof value !== 'object') return false
  const point = value as Partial<LeavePoint>
  return isDateKey(point.date) && isHalfDay(point.half)
}

/**
 * 半天顺序键：把「日期 + 上午 / 下午」合成一个可比较的数值（天序号 × 2 + 半天偏移）。
 * 比较与相减共用这一个键——两者必须同源，否则「跨月时长」会与「跨月先后」打架
 * （注：不要用 `new Date('2026-09-11')`，那会被当作 UTC 午夜，东八区之外整体差一天；
 * `dayIndexOf` 是显式 `Date.UTC`，没有这个陷阱）。
 */
export function halfDayKey(point: LeavePoint): number {
  return dayIndexOf(point.date) * 2 + (point.half === 'pm' ? 1 : 0)
}

/** 请假时段的半天数（含首尾：同一天上午 → 下午 = 2 个半天 = 1 天） */
function leaveHalfDayCount(start: LeavePoint, end: LeavePoint): number {
  return halfDayKey(end) - halfDayKey(start) + 1
}

/** 时长文案：半天 / 1 天 / 1 天半（按半天折算，不出现 1.5 天这类小数） */
export function formatLeaveDuration(start: LeavePoint, end: LeavePoint): string {
  const halves = leaveHalfDayCount(start, end)
  if (halves <= 2) return halves === 2 ? '1 天' : '半天'
  const days = Math.floor(halves / 2)
  return halves % 2 === 1 ? `${days} 天半` : `${days} 天`
}

/** 日期键 → 中文月日，如「9月11日」（纯字符串解析，不经 Date，不涉时区） */
function formatMonthDay(dateKey: string): string {
  return `${Number(dateKey.slice(5, 7))}月${Number(dateKey.slice(8, 10))}日`
}

/** 时间点文案，如「9月11日 上午」（离校 / 返校登记展示用） */
export function formatLeavePoint(point: LeavePoint): string {
  return `${formatMonthDay(point.date)} ${HALF_DAY_LABELS[point.half]}`
}

/** 时段文案：同一天合并为「9月11日 上午 → 下午」，跨天为「9月11日 上午 → 9月12日 下午」 */
export function formatLeavePeriod(start: LeavePoint, end: LeavePoint): string {
  if (start.date === end.date) {
    return `${formatMonthDay(start.date)} ${HALF_DAY_LABELS[start.half]} → ${HALF_DAY_LABELS[end.half]}`
  }
  return `${formatLeavePoint(start)} → ${formatLeavePoint(end)}`
}

/**
 * 单条请假记录的健壮化（load 时逐条调用，风格同 normalizeStudent / normalizeConstraint）：
 * 学生、类型、起止时段、原因缺一即失去意义 → **丢弃该条**，不补臆造默认值（§11.3）。
 * 唯一的例外是状态：无法识别时按「待处理」保守处理——不凭空变成已批准（那会让一条
 * 未审批的请假直接生效），且教师能在列表里看到并处理它。
 */
export function normalizeLeaveRecord(raw: unknown): LeaveRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<LeaveRecord>
  if (typeof item.studentId !== 'string' || !item.studentId) return null
  if (typeof item.type !== 'string' || !KNOWN_LEAVE_TYPES.includes(item.type as LeaveType)) {
    return null
  }
  if (!isLeavePoint(item.start) || !isLeavePoint(item.end)) return null
  if (halfDayKey(item.end) < halfDayKey(item.start)) return null
  const reason = typeof item.reason === 'string' ? item.reason.trim() : ''
  if (!reason) return null
  const status =
    typeof item.status === 'string' && KNOWN_LEAVE_STATUSES.includes(item.status as LeaveStatus)
      ? (item.status as LeaveStatus)
      : 'pending'
  const decisionNote = typeof item.decisionNote === 'string' ? item.decisionNote.trim() : ''
  // 离校 / 返校：形状合法**且时间线自洽**才采用（写入路径保证「先离校、后返校」，
  // load 路径同样要守）。被改坏的时间戳不展示，但记录本身仍保留——只留离校时间
  // 至少是「已离校」这个说得通的状态，教师可重新登记返校。
  const leftSchool = isLeavePoint(item.leftSchool) ? item.leftSchool : undefined
  const backToSchool =
    leftSchool &&
    isLeavePoint(item.backToSchool) &&
    halfDayKey(item.backToSchool) >= halfDayKey(leftSchool)
      ? item.backToSchool
      : undefined
  return {
    id: typeof item.id === 'string' && item.id ? item.id : createId(),
    studentId: item.studentId,
    studentName: typeof item.studentName === 'string' ? item.studentName.trim() : '',
    type: item.type as LeaveType,
    start: { date: item.start.date, half: item.start.half },
    end: { date: item.end.date, half: item.end.half },
    reason,
    status,
    createdAt:
      typeof item.createdAt === 'string' && item.createdAt
        ? item.createdAt
        : new Date().toISOString(),
    decidedAt: typeof item.decidedAt === 'string' && item.decidedAt ? item.decidedAt : undefined,
    decisionNote: decisionNote || undefined,
    leftSchool,
    backToSchool,
  }
}

/**
 * 列表排序：**待处理置顶**，组内按开始时间升序（最早请假的先批）；
 * 其余（已批准 / 已驳回）按开始时间倒序（最近发生的先看）。
 * 同一天开始的按提交时间升序，保证顺序确定、刷新不变。
 */
export function sortLeaveRecords(records: LeaveRecord[]): LeaveRecord[] {
  return [...records].sort((a, b) => {
    const groupA = a.status === 'pending' ? 0 : 1
    const groupB = b.status === 'pending' ? 0 : 1
    if (groupA !== groupB) return groupA - groupB
    const diff = halfDayKey(a.start) - halfDayKey(b.start)
    const ordered = groupA === 0 ? diff : -diff
    return ordered !== 0 ? ordered : a.createdAt.localeCompare(b.createdAt)
  })
}

/** 两个时段是否重叠（闭区间、含半天；供表单「已有请假记录」提示，不做拦截） */
export function isPeriodOverlapping(
  a: { start: LeavePoint; end: LeavePoint },
  b: { start: LeavePoint; end: LeavePoint },
): boolean {
  return halfDayKey(a.start) <= halfDayKey(b.end) && halfDayKey(b.start) <= halfDayKey(a.end)
}
