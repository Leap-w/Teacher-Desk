/**
 * 方案级排座约束检查器（V1.1.2 Phase 1）。
 *
 * **只检查，不自动改座位**：返回「哪些学生 / 哪些座位违反了哪条约束」，
 * 由页面负责提示与定位。自动排座算法本阶段不做，这里的结论也不参与任何求解。
 *
 * 规则（判定函数全部来自 `utils/seat.ts`，本模块不自己实现任何几何判断）：
 * 1. 不能同桌 → **错误**：同排同列块即同一桌（每桌 3 座，见 `areSeatsSameDesk`）；
 * 2. 三人不能相邻组 → **错误**：组内任意两人四邻域相邻即算违反（不含对角、**不含跨过道**）；
 * 3. 前排学生未在前排 → **警告**；4. 后排学生未在后排 → **警告**（`isFrontRowSeat` / `isBackRowSeat`）。
 *
 * V1.1.2 Phase 2：本模块与 Phase 3C/3D 的全局约束检查器**共用同一套关系函数与同一份阈值**，
 * 全项目不再有第二套「同桌 / 相邻」算法。
 */
import {
  areSeatsAdjacent,
  areSeatsSameDesk,
  BACK_ROW_MIN,
  FRONT_ROW_LIMIT,
  isBackRowSeat,
  isFrontRowSeat,
  seatBlockLabel,
} from '@/utils/seat'
import { buildNameCounts, formatStudentShortName } from '@/utils/student'
import { DEFAULT_CLASSROOM_CONFIG } from '@/types/classroom'
import type { ClassroomConfig } from '@/types/classroom'
import type { Seat, SeatPlan, SeatPlanConstraints } from '@/types/seat'
import type { Student } from '@/types'

/** 约束类型中文名（弹窗分组标题 / 检查结论共用） */
export const PLAN_CONSTRAINT_LABELS = {
  sameDeskForbidden: '不能同桌',
  adjacentGroupForbidden: '三人不能相邻',
  frontRowStudents: '前排学生',
  backRowStudents: '后排学生',
} as const

/** 前后排口径说明（阈值与两个检查器同源，只有一份数字） */
export function rowRuleNote(config: ClassroomConfig = DEFAULT_CLASSROOM_CONFIG): string {
  return `前排 = 第 1~${FRONT_ROW_LIMIT} 排；后排 = 第 ${BACK_ROW_MIN}~${config.rows} 排`
}

/** 检查项类型 */
export type SeatPlanIssueKind =
  'same-desk-forbidden' | 'adjacent-group-forbidden' | 'front-row-missing' | 'back-row-missing'

/** 严重度：error = 违反手工硬约束；warning = 排座偏好未满足（**不阻止拖拽**） */
export type SeatPlanIssueSeverity = 'error' | 'warning'

/** 一条检查结论：三种信息缺一不可——说给教师听的话术、要闪的座位、要闪的学生 */
export interface SeatPlanConstraintIssue {
  key: string
  kind: SeatPlanIssueKind
  severity: SeatPlanIssueSeverity
  message: string
  studentIds: string[]
  seatIds: string[]
}

export interface SeatPlanConstraintReport {
  /** 无错误即通过（警告不影响通过） */
  ok: boolean
  errors: SeatPlanConstraintIssue[]
  warnings: SeatPlanConstraintIssue[]
  /** 错误在前、警告在后（页面展示顺序即此顺序） */
  issues: SeatPlanConstraintIssue[]
}

/** 空结论（无方案 / 方案尚未加载） */
export function emptyConstraintReport(): SeatPlanConstraintReport {
  return { ok: true, errors: [], warnings: [], issues: [] }
}

/** 约束条数（页面用：按钮上显示「排座约束（N）」） */
export function countSeatPlanConstraints(constraints: SeatPlanConstraints | undefined): number {
  if (!constraints) return 0
  return (
    constraints.sameDeskForbidden.length +
    constraints.adjacentGroupForbidden.length +
    constraints.frontRowStudents.length +
    constraints.backRowStudents.length
  )
}

/** 位置简写：第 3 排中区 */
function seatPlace(seat: Seat): string {
  return `第 ${seat.row} 排${seatBlockLabel(seat.block)}`
}

/**
 * 对一份方案执行四类检查（纯函数，实时调用）。
 * 学生已删除 / 未就座 → 关系型约束自然不产生结论（与既有检查器同一口径）；
 * 前后排偏好同样只统计**已就座**的学生。
 * 不需要教室配置：座位自带 row / col / block，前后排阈值是与既有检查器同源的模块常量。
 */
export function validateSeatPlanConstraints(
  plan: SeatPlan | undefined,
  students: ReadonlyMap<string, Student>,
): SeatPlanConstraintReport {
  if (!plan) return emptyConstraintReport()
  const constraints = plan.constraints
  if (!constraints) return emptyConstraintReport()

  /** 学生 → 本方案座位（同一学生至多一处） */
  const studentSeat = new Map<string, Seat>()
  for (const seat of plan.seats) {
    if (seat.studentId && !studentSeat.has(seat.studentId)) studentSeat.set(seat.studentId, seat)
  }

  // 重名消歧要看整份名册（v3.3.1）；只算一次，下面每份报告共用
  const nameCounts = buildNameCounts([...students.values()])

  function nameOf(studentId: string): string {
    const student = students.get(studentId)
    return student ? formatStudentShortName(student, nameCounts) : '已删除学生'
  }

  const errors: SeatPlanConstraintIssue[] = []
  const warnings: SeatPlanConstraintIssue[] = []

  /** 1：不能同桌（同排同列块 = 同一桌） */
  for (const rule of constraints.sameDeskForbidden) {
    const seatA = studentSeat.get(rule.studentA)
    const seatB = studentSeat.get(rule.studentB)
    if (!seatA || !seatB) continue // 任一方未就座则无事发生
    if (!areSeatsSameDesk(seatA, seatB)) continue
    errors.push({
      key: `same-desk-${rule.id}`,
      kind: 'same-desk-forbidden',
      severity: 'error',
      message: `${nameOf(rule.studentA)} 与 ${nameOf(rule.studentB)} 成了同桌（${seatPlace(seatA)}）`,
      studentIds: [rule.studentA, rule.studentB],
      seatIds: [seatA.id, seatB.id],
    })
  }

  /** 2：三人不能相邻组（组内任意两人相邻即违反） */
  for (const rule of constraints.adjacentGroupForbidden) {
    const seated = rule.students
      .map((studentId) => ({ studentId, seat: studentSeat.get(studentId) }))
      .filter((item): item is { studentId: string; seat: Seat } => Boolean(item.seat))
    if (seated.length < 2) continue
    const offenders: Array<{ a: string; b: string; seatA: Seat; seatB: Seat }> = []
    for (let i = 0; i < seated.length; i++) {
      for (let j = i + 1; j < seated.length; j++) {
        if (areSeatsAdjacent(seated[i]!.seat, seated[j]!.seat)) {
          offenders.push({
            a: seated[i]!.studentId,
            b: seated[j]!.studentId,
            seatA: seated[i]!.seat,
            seatB: seated[j]!.seat,
          })
        }
      }
    }
    if (offenders.length === 0) continue
    const pairs = offenders.map(
      (item) =>
        `${nameOf(item.a)} 与 ${nameOf(item.b)}（${seatPlace(item.seatA)} / ${seatPlace(item.seatB)}）`,
    )
    errors.push({
      key: `adjacent-group-${rule.id}`,
      kind: 'adjacent-group-forbidden',
      severity: 'error',
      message: `三人不能相邻组冲突：${pairs.join('；')}`,
      studentIds: [...new Set(offenders.flatMap((item) => [item.a, item.b]))],
      seatIds: [...new Set(offenders.flatMap((item) => [item.seatA.id, item.seatB.id]))],
    })
  }

  /** 3+4：前排 / 后排偏好（只提醒；同一类聚合成一条，便于教师一次看全） */
  const rowPreference = (
    studentIds: readonly string[],
    kind: 'front-row-missing' | 'back-row-missing',
  ) => {
    const violated: Array<{ studentId: string; seat: Seat }> = []
    for (const studentId of studentIds) {
      const seat = studentSeat.get(studentId)
      if (!seat) continue
      const ok = kind === 'front-row-missing' ? isFrontRowSeat(seat) : isBackRowSeat(seat)
      if (!ok) violated.push({ studentId, seat })
    }
    if (violated.length === 0) return
    const label = kind === 'front-row-missing' ? '前排' : '后排'
    const detail = violated
      .map((item) => `${nameOf(item.studentId)}（第 ${item.seat.row} 排）`)
      .join('、')
    warnings.push({
      key: kind,
      kind,
      severity: 'warning',
      message: `${violated.length} 名学生未处于指定${label}：${detail}`,
      studentIds: violated.map((item) => item.studentId),
      seatIds: violated.map((item) => item.seat.id),
    })
  }
  rowPreference(constraints.frontRowStudents, 'front-row-missing')
  rowPreference(constraints.backRowStudents, 'back-row-missing')

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    issues: [...errors, ...warnings],
  }
}
