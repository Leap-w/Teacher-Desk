/**
 * 违纪统计纯函数（v3.8.1 · Phase 3：取消分类后仍全部实时派生）。
 *
 * **所有统计都从事件数组实时算**：没有「累计次数」字段、没有独立计数器、
 * 没有缓存表。计数器和事实一旦分叉，界面上就会长期显示一个没人能对上的错数，
 * 而这里最便宜的修法就是根本不存它。
 *
 * ## 已确定的口径（需求 §八，写在这里防止各处各算一套）
 *
 * 1. **统计范围 = 全部历史记录**（不按学期切）。
 * 2. **在读学生**参与概览人数与排行；**已软删除学生不进入在读学生排行**。
 * 3. 已软删除学生的个人历史记录**仍然保留**、仍能按 studentId 查（`buildStudentViolationStats`）。
 * 4. **每条事件恒计一次**；严重程度不加权、不折算、不扣分。
 * 5. 排行规则：次数降序 → 姓名升序（稳定中文比较）→ 稳定 id 兜底。
 * 6. 经常违纪：累计 ≥3 次，取前 10 名。
 * 7. v3.8.1 取消违纪分类后，统计只保留「三级严重程度」与「按具体事件（behaviorLabel）」两组。
 *
 * ## 纯度约定
 *
 * 所有函数**不修改入参**（排序一律先 `[...]` 复制）。这样 store 的 computed 可以安全地
 * 直接把 ref 数组喂进来，调用方也不用担心「算一次统计把列表顺序改了」。
 */
import { buildNameCounts, formatStudentShortName } from '@/utils/student'
import { VIOLATION_SEVERITY_ORDER } from '@/utils/violation'
import type { Student } from '@/types'
import type { ViolationEvent } from '@/types/violation'

/* ========== 经常违纪学生的判定常数（需求 §八） ========== */

/** 「经常违纪」的累计次数门槛 */
export const FREQUENT_VIOLATION_THRESHOLD = 3
/** 「经常违纪」展示条数上限 */
export const FREQUENT_VIOLATION_LIMIT = 10

/* ========== 中文比较 ========== */

/**
 * 稳定的中文文本比较器（姓名排行、行为文本分组共用）。
 *
 * 为什么不用 `localeCompare` 逐个调用：地区与选项有可能随宿主环境不同，
 * 而统计要在 CI（Node）与教师浏览器里给出**同一个顺序**。`Intl.Collator` 建一次、
 * 显式固定 `zh-Hans-CN`，行为与性能都更可控；`numeric` 让「学生2」排在「学生10」前面。
 *
 * 为什么不复用拼音排序（`services/pinyinSort.ts`）：那是**异步**加载的词典，
 * 而统计是 computed 里的同步派生；让排行依赖异步词典会出现「刚打开页面顺序乱跳」。
 */
const ZH_COLLATOR = new Intl.Collator('zh-Hans-CN', { sensitivity: 'variant', numeric: true })

export function compareZhText(a: string, b: string): number {
  return ZH_COLLATOR.compare(a, b)
}

/* ========== 返回结构 ========== */

/** 三级严重程度计数（键与 `ViolationSeverity` 一一对应） */
export interface ViolationSeverityCounts {
  minor: number
  moderate: number
  severe: number
}

/** 违纪概览 */
export interface ViolationOverview {
  /** 累计违纪事件数（**全部历史**，含已软删除学生的记录） */
  total: number
  /** 涉及学生人数（**只算在读学生**；传了 activeStudentIds 时按它过滤） */
  studentCount: number
  /** 三级数量（全部历史） */
  severity: ViolationSeverityCounts
}

/** 单个具体事件的计数（按 `behaviorLabel` 分组，自定义事件也在这里） */
export interface ViolationBehaviorCount {
  behaviorLabel: string
  count: number
}

/** 排行中的一名学生 */
export interface StudentViolationRank {
  studentId: string
  /** 展示名（重名时带身份证尾号，口径同全站 `formatStudentShortName`） */
  studentName: string
  /** 累计次数（每条事件计 1） */
  count: number
  /** 该生三级数量（排行卡片可以直接显示，不必再算一遍） */
  severity: ViolationSeverityCounts
  /** 最近一次违纪日期（无记录不可能出现在排行里；保留可空类型便于调用方统一处理） */
  lastDate: string | null
}

/** 单个学生的完整违纪统计（个人档案用；**已软删除学生也能查**） */
export interface StudentViolationStats {
  studentId: string
  /** 姓名快照（取自最近一条记录；学生档案里已被彻底移除时仍能显示是谁） */
  studentName: string
  total: number
  severity: ViolationSeverityCounts
  /** 实际出现过的具体事件，按次数降序（同次数按文本升序） */
  behaviors: ViolationBehaviorCount[]
  lastDate: string | null
}

/* ========== 基础计数 ========== */

function emptySeverityCounts(): ViolationSeverityCounts {
  return { minor: 0, moderate: 0, severe: 0 }
}

/** 三级计数（每条事件只落一个等级；不修改入参） */
export function countViolationsBySeverity(
  events: readonly ViolationEvent[],
): ViolationSeverityCounts {
  const counts = emptySeverityCounts()
  for (const event of events) {
    counts[event.severity] += 1
  }
  return counts
}

/**
 * 概览：
 * - `total` / `severity` 覆盖**全部历史事件**（含已软删除学生的记录）；
 * - `studentCount` 只数**在读学生**（传 `null` = 不限制，纯函数测试与「全部」口径用）。
 *
 * 为什么不全按在读学生过滤：`total` 是「违纪发生了多少次」的事实，学生退档不改变它发生过；
 * 而 `studentCount` 是「这个班现在有多少人有违纪」，退档学生不再属于这个班。
 */
export function buildViolationOverview(
  events: readonly ViolationEvent[],
  activeStudentIds: ReadonlySet<string> | null = null,
): ViolationOverview {
  const studentIds = new Set<string>()
  for (const event of events) {
    if (activeStudentIds && !activeStudentIds.has(event.studentId)) continue
    studentIds.add(event.studentId)
  }
  return {
    total: events.length,
    studentCount: studentIds.size,
    severity: countViolationsBySeverity(events),
  }
}

/** 学生 id → 违纪次数（选择器显示「累计违纪次数」用；**不区分是否在读**，由调用方按名册取） */
export function buildViolationCountByStudent(
  events: readonly ViolationEvent[],
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const event of events) {
    counts.set(event.studentId, (counts.get(event.studentId) ?? 0) + 1)
  }
  return counts
}

/* ========== 排行 ========== */

/** 排行内部用的中间态（含排序用的原始姓名，展示名另外算） */
interface RankAccumulator {
  student: Student
  count: number
  severity: ViolationSeverityCounts
  lastDate: string
}

/**
 * 学生违纪次数排行。
 *
 * - `students` 传**在读名册**（`studentStore.activeStudents`）：软删除学生不在其中，
 *   因此不会进入排行（需求 §八口径 ②）；他们的历史记录不丢，走 `buildStudentViolationStats`。
 * - 排序：次数降序 → 姓名升序（稳定中文比较）→ **studentId 升序兜底**
 *   （同名同次数也要有确定顺序，否则两次渲染可能换位置）。
 * - 只有**有违纪记录**的学生出现在排行里（0 次不进排行）。
 */
export function buildViolationRanking(
  events: readonly ViolationEvent[],
  students: readonly Student[],
  nameCounts?: ReadonlyMap<string, number>,
): StudentViolationRank[] {
  const counts = nameCounts ?? buildNameCounts(students)
  const roster = new Map(students.map((student) => [student.id, student]))
  const byStudent = new Map<string, RankAccumulator>()
  for (const event of events) {
    const student = roster.get(event.studentId)
    // 不在在读名册里（已软删 / 不存在）→ 不进排行，但也不影响它的历史记录
    if (!student) continue
    const existing = byStudent.get(event.studentId)
    if (!existing) {
      byStudent.set(event.studentId, {
        student,
        count: 1,
        severity: { ...emptySeverityCounts(), [event.severity]: 1 },
        lastDate: event.date,
      })
      continue
    }
    existing.count += 1
    existing.severity[event.severity] += 1
    if (event.date > existing.lastDate) existing.lastDate = event.date
  }

  // 排序时用原始姓名（展示名带重名消歧后缀，不能拿它比大小），所以中间态多一个 rawName
  const rows: (StudentViolationRank & { rawName: string })[] = [...byStudent.values()].map(
    (entry) => ({
      studentId: entry.student.id,
      studentName: formatStudentShortName(entry.student, counts),
      count: entry.count,
      severity: entry.severity,
      lastDate: entry.lastDate,
      rawName: entry.student.name,
    }),
  )

  rows.sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count
    const byName = compareZhText(a.rawName, b.rawName)
    if (byName !== 0) return byName
    if (a.studentId === b.studentId) return 0
    return a.studentId < b.studentId ? -1 : 1
  })

  return rows.map((row) => ({
    studentId: row.studentId,
    studentName: row.studentName,
    count: row.count,
    severity: row.severity,
    lastDate: row.lastDate,
  }))
}

/**
 * 经常违纪学生：累计 ≥ `FREQUENT_VIOLATION_THRESHOLD` 次，按排行顺序取前
 * `FREQUENT_VIOLATION_LIMIT` 名。入参就是排行结果，所以排序与并列规则天然一致。
 */
export function pickFrequentViolationStudents(
  ranking: readonly StudentViolationRank[],
): StudentViolationRank[] {
  return ranking
    .filter((row) => row.count >= FREQUENT_VIOLATION_THRESHOLD)
    .slice(0, FREQUENT_VIOLATION_LIMIT)
}

/* ========== 事件 / 行为统计 ========== */

/**
 * 按具体事件统计（**只返回出现过的行为**）：次数降序，同次数按行为文本升序。
 * 系统预设与自定义事件一视同仁：都按 `behaviorLabel` 归类——
 * 这样即使预设日后调整，历史记录的统计也不会突然归零。
 */
export function buildViolationBehaviorCounts(
  events: readonly ViolationEvent[],
): ViolationBehaviorCount[] {
  const counts = new Map<string, number>()
  for (const event of events) {
    counts.set(event.behaviorLabel, (counts.get(event.behaviorLabel) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([behaviorLabel, count]) => ({ behaviorLabel, count }))
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count
      return compareZhText(a.behaviorLabel, b.behaviorLabel)
    })
}

/* ========== 单个学生 ========== */

/**
 * 单个学生的完整违纪统计（个人档案用）。
 *
 * **只用 events，不需要学生档案**：因此已软删除、甚至已从 `students` 数组彻底消失的学生
 * 也能算出完整历史（姓名取最近一条事件的快照）。这正符合「学生删除后历史记录仍然保留」。
 * 无记录时返回全 0 而不是 `null`：个人档案页对「0 次违纪」的学生同样要能打开。
 */
export function buildStudentViolationStats(
  events: readonly ViolationEvent[],
  studentId: string,
): StudentViolationStats {
  const own = events.filter((event) => event.studentId === studentId)
  const latest = own.reduce<ViolationEvent | null>((newest, event) => {
    if (!newest) return event
    if (event.date > newest.date) return event
    if (event.date < newest.date) return newest
    return event.createdAt > newest.createdAt ? event : newest
  }, null)

  return {
    studentId,
    studentName: latest?.studentName ?? '',
    total: own.length,
    severity: countViolationsBySeverity(own),
    behaviors: buildViolationBehaviorCounts(own),
    lastDate: latest?.date ?? null,
  }
}

/* ========== 严重程度排序辅助（展示用，不参与计次） ========== */

/**
 * 按严重程度从重到轻排序（同级按日期倒序）：严重违纪独立展示区用。
 * 这里用 `VIOLATION_SEVERITY_ORDER` 只是为了**展示分组**，不改变任何计数口径。
 */
export function sortBySeverityThenDate(events: readonly ViolationEvent[]): ViolationEvent[] {
  return [...events].sort((a, b) => {
    const bySeverity = VIOLATION_SEVERITY_ORDER[b.severity] - VIOLATION_SEVERITY_ORDER[a.severity]
    if (bySeverity !== 0) return bySeverity
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1
    if (a.id === b.id) return 0
    return a.id < b.id ? -1 : 1
  })
}
