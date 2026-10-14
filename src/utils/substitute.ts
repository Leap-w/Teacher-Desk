/**
 * 代课记录（v3.7.5）纯逻辑：规范化 / 复活 / 排序 / 日期范围筛选 / 统计。
 *
 * 本文件**不碰存储、不碰 store**：输入盘上原文或内存数组，输出干净的记录，
 * 因此可以被首屏加载、跨标签页同步、表单校验、单测共用同一份口径（同 `utils/fund.ts`）。
 */
import { isDateKey } from '@/utils/date'
import { isValidPeriodId, periodOrderOf } from '@/utils/timetable'
import type {
  SubstituteRecord,
  SubstituteSummary,
  SubstituteTeacherCount,
} from '@/types/substitute'

/**
 * 文本字段长度上限（表单 maxlength 与数据层兜底共用；超长按上限截断而不是丢弃整条
 * ——截断只损失末尾几个字，丢弃会让教师「明明存过却不见了」）。
 */
export const SUBSTITUTE_TEXT_MAX = {
  teacher: 20,
  subject: 20,
  remark: 50,
} as const

function textOf(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  return text.slice(0, max)
}

/* ========== 读盘：规范化 / 复活 ========== */

/**
 * 盘上一条 → 内存里的代课记录；形状不对返回 null。
 *
 * **五个必填字段缺一即丢**（日期 / 节次 / 被代课教师 / 实际代课教师 / 科目）：
 * 缺任何一项这条记录都说不清「谁替谁上了哪天的哪节课」，补默认值等于臆造（§11.3）。
 * `remark` 可选；`createdAt` 缺失按空串读回（只在内部排序用，不该因此丢记录）。
 */
export function normalizeSubstitute(raw: unknown): SubstituteRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const id = typeof source.id === 'string' && source.id.trim() ? source.id.trim() : ''
  const date = source.date
  const originalTeacher = textOf(source.originalTeacher, SUBSTITUTE_TEXT_MAX.teacher)
  const substituteTeacher = textOf(source.substituteTeacher, SUBSTITUTE_TEXT_MAX.teacher)
  const subject = textOf(source.subject, SUBSTITUTE_TEXT_MAX.subject)
  if (!id) return null
  if (!isDateKey(date)) return null
  if (!isValidPeriodId(source.periodId)) return null
  if (!originalTeacher || !substituteTeacher || !subject) return null
  const remark = textOf(source.remark, SUBSTITUTE_TEXT_MAX.remark)
  return {
    id,
    date,
    periodId: source.periodId,
    originalTeacher,
    substituteTeacher,
    subject,
    // 空备注**不写这个字段**：`remark: ''` 与「没有备注」在展示与云端比对里
    // 是两种数据，省掉这个键能让两边天然一致（同 fund 的 note 口径）
    ...(remark ? { remark } : {}),
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : '',
  }
}

/**
 * 盘上整个数组 → 内存列表：逐条规范化 + **同 id 只留首条**
 * （重复 id 会让 v-for key 冲突，且外部篡改可能造出来）。
 */
export function reviveSubstitutes(raw: unknown[]): SubstituteRecord[] {
  const seen = new Set<string>()
  const list: SubstituteRecord[] = []
  for (const item of raw) {
    const value = normalizeSubstitute(item)
    if (value === null) continue
    if (seen.has(value.id)) continue
    seen.add(value.id)
    list.push(value)
  }
  if (list.length < raw.length) {
    // 不覆盖缓存：盘上原文保留，界面先用过滤后的结果（改坏的数据仍可人工找回）
    console.warn(`[substitute] 丢弃 ${raw.length - list.length} 条不合法的代课记录（缓存原文保留）`)
  }
  return list
}

/* ========== 排序 / 筛选 / 统计 ========== */

/**
 * 列表排序：**日期倒序**（最近的在最前），同一天按节次先后升序，
 * 末位用建档时间与 id 兜底，保证顺序确定、刷新不变。
 *
 * 教师与科目名比对必须写明 `zh-Hans-CN`（拼音序，同 `utils/weekend.ts` 的约定），
 * 否则 CI 的 Linux runner 会退化成码点序、结果机器相关。日期串与 id 是纯 ASCII，不加参数。
 */
export function sortSubstitutes(records: readonly SubstituteRecord[]): SubstituteRecord[] {
  return [...records].sort((a, b) => {
    const byDate = b.date.localeCompare(a.date)
    if (byDate !== 0) return byDate
    const byPeriod = periodOrderOf(a.periodId) - periodOrderOf(b.periodId)
    if (byPeriod !== 0) return byPeriod
    const bySubject = a.subject.localeCompare(b.subject, 'zh-Hans-CN')
    if (bySubject !== 0) return bySubject
    const byCreated = a.createdAt.localeCompare(b.createdAt)
    return byCreated !== 0 ? byCreated : a.id.localeCompare(b.id)
  })
}

/**
 * 日期是否落在筛选范围内（**两端都含**）。`from` / `to` 留空即该端不限
 * （`''` 是「没设」而不是「比什么都小」——留空应看到全部，不该筛成空列表）。
 */
export function isInSubstituteRange(date: string, from: string, to: string): boolean {
  if (from && date < from) return false
  if (to && date > to) return false
  return true
}

/** 按日期范围筛（保持传入顺序；需要展示顺序时先过 `sortSubstitutes`） */
export function filterSubstitutes(
  records: readonly SubstituteRecord[],
  from: string,
  to: string,
): SubstituteRecord[] {
  return records.filter((item) => isInSubstituteRange(item.date, from, to))
}

/** 按某位教师名把记录聚成计数表（节数降序、同数按姓名拼音升序） */
function countBy(
  records: readonly SubstituteRecord[],
  pick: (record: SubstituteRecord) => string,
): SubstituteTeacherCount[] {
  const counts = new Map<string, number>()
  for (const record of records) {
    const name = pick(record)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN'))
}

/**
 * 统计（实时计算，不落库、不缓存）：总节数 + 按实际代课教师 + 按被代课教师。
 * 传入的应是**已按筛选范围过滤**的列表——统计口径与列表所见一致，数字不会自说自话。
 */
export function summarizeSubstitutes(records: readonly SubstituteRecord[]): SubstituteSummary {
  return {
    total: records.length,
    bySubstituteTeacher: countBy(records, (record) => record.substituteTeacher),
    byOriginalTeacher: countBy(records, (record) => record.originalTeacher),
  }
}
