import { formatMonthDay } from '@/utils/date'
import { createId } from '@/utils/id'
import {
  HALF_DAY_LABELS,
  formatDayPoint,
  halfDayKey,
  isDayPoint,
  normalizeRegisterEndpoints,
} from '@/utils/point'
import type { SelectOption } from '@/types'
import type { DayPoint } from '@/types/point'
import type { LeaveRecord, LeaveStatus, LeaveType } from '@/types/leave'

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

/** 状态中文文案（列表徽标共用）。V1.1.5 起请假管理只做**记录**、不做审批：
 * 数据值保持不变（历史数据兼容），仅展示词改为记录口径——
 * 「记录中」= 记录已建、还没登记离校；「已记录」= 生效的请假记录（V1.1.5 起新建即此状态）；
 * 「已作废」= 旧版审批流驳回的记录（保留只读，不算一次请假） */
export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: '记录中',
  approved: '已记录',
  rejected: '已作废',
}

/** 全部已知请假类型（load 守卫与写入校验共用；类型值扩展时同步） */
export const KNOWN_LEAVE_TYPES: readonly LeaveType[] = ['sick', 'personal', 'other']

/** 全部已知审批状态（load 守卫用） */
const KNOWN_LEAVE_STATUSES: readonly LeaveStatus[] = ['pending', 'approved', 'rejected']

/** 请假时段的半天数（含首尾：同一天上午 → 下午 = 2 个半天 = 1 天） */
function leaveHalfDayCount(start: DayPoint, end: DayPoint): number {
  return halfDayKey(end) - halfDayKey(start) + 1
}

/** 时长文案：半天 / 1 天 / 1 天半（按半天折算，不出现 1.5 天这类小数） */
export function formatLeaveDuration(start: DayPoint, end: DayPoint): string {
  const halves = leaveHalfDayCount(start, end)
  if (halves <= 2) return halves === 2 ? '1 天' : '半天'
  const days = Math.floor(halves / 2)
  return halves % 2 === 1 ? `${days} 天半` : `${days} 天`
}

/** 时段文案：同一天合并为「9月11日 上午 → 下午」，跨天为「9月11日 上午 → 9月12日 下午」 */
export function formatLeavePeriod(start: DayPoint, end: DayPoint): string {
  if (start.date === end.date) {
    return `${formatMonthDay(start.date)} ${HALF_DAY_LABELS[start.half]} → ${HALF_DAY_LABELS[end.half]}`
  }
  return `${formatDayPoint(start)} → ${formatDayPoint(end)}`
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
  if (!isDayPoint(item.start) || !isDayPoint(item.end)) return null
  if (halfDayKey(item.end) < halfDayKey(item.start)) return null
  const reason = typeof item.reason === 'string' ? item.reason.trim() : ''
  if (!reason) return null
  // V1.1.5 起不再有审批：旧「待处理」在读取时归一为「已记录」（记录即生效，可登记离校 / 返校）；
  // 旧「已驳回」保留原值——那是一次「最终没有发生的请假」，改成就成了编造历史
  const rawStatus =
    typeof item.status === 'string' && KNOWN_LEAVE_STATUSES.includes(item.status as LeaveStatus)
      ? (item.status as LeaveStatus)
      : 'approved'
  const status: LeaveStatus = rawStatus === 'pending' ? 'approved' : rawStatus
  const decisionNote = typeof item.decisionNote === 'string' ? item.decisionNote.trim() : ''
  // 离校 / 返校两端：公共件按「形状合法 + 时间线自洽」健壮化（读回路径的守卫，
  // 与写入路径的 registerPointError 同源，见 utils/point.ts）
  const { leftSchool, backToSchool } = normalizeRegisterEndpoints(item)
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
 * 列表排序（记录口径）：按开始时段**倒序**（最近发生 / 即将发生的在前），
 * 同时段按提交时间升序，保证顺序确定、刷新不变。
 */
export function sortLeaveRecords(records: LeaveRecord[]): LeaveRecord[] {
  return [...records].sort((a, b) => {
    const diff = halfDayKey(b.start) - halfDayKey(a.start)
    return diff !== 0 ? diff : a.createdAt.localeCompare(b.createdAt)
  })
}

/* ========== V1.1.5：记录筛选（全部 / 今日 / 本周 / 未返校 / 已返校） ========== */

/** 列表筛选（需求给定的五项；后两项按离校 / 返校登记判定，不看日期） */
export type LeaveFilter = 'all' | 'today' | 'week' | 'out' | 'back'

export const LEAVE_FILTER_LABELS: Record<LeaveFilter, string> = {
  all: '全部',
  today: '今日',
  week: '本周',
  out: '未返校',
  back: '已返校',
}

/** 请假时段是否与「今天」相交（含首尾半天） */
export function isLeaveToday(record: LeaveRecord, today: string): boolean {
  return record.start.date <= today && record.end.date >= today
}

/** 该日期键所在周的周日（与值日 / 工作清单同一 ISO 周口径） */
function weekEndOfDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const d = new Date(year ?? 2026, (month ?? 1) - 1, day ?? 1)
  const weekday = d.getDay() === 0 ? 7 : d.getDay()
  d.setDate(d.getDate() + (7 - weekday))
  const month2 = `${d.getMonth() + 1}`.padStart(2, '0')
  const day2 = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${month2}-${day2}`
}

/** 请假时段是否与「本周」（今天 ~ 周日）相交 */
export function isLeaveThisWeek(record: LeaveRecord, today: string): boolean {
  return record.start.date <= weekEndOfDate(today) && record.end.date >= today
}

/** 按筛选条件取子集（纯函数；'out' / 'back' 只看登记端点，与日期无关） */
export function filterLeaveRecords(
  records: LeaveRecord[],
  filter: LeaveFilter,
  today: string,
): LeaveRecord[] {
  const sorted = sortLeaveRecords(records)
  switch (filter) {
    case 'today':
      return sorted.filter((item) => isLeaveToday(item, today))
    case 'week':
      return sorted.filter((item) => isLeaveThisWeek(item, today))
    case 'out':
      return sorted.filter(
        (item) => item.leftSchool !== undefined && item.backToSchool === undefined,
      )
    case 'back':
      return sorted.filter((item) => item.backToSchool !== undefined)
    default:
      return sorted
  }
}

/** 两个时段是否重叠（闭区间、含半天；供表单「已有请假记录」提示，不做拦截） */
export function isPeriodOverlapping(
  a: { start: DayPoint; end: DayPoint },
  b: { start: DayPoint; end: DayPoint },
): boolean {
  return halfDayKey(a.start) <= halfDayKey(b.end) && halfDayKey(b.start) <= halfDayKey(a.end)
}
