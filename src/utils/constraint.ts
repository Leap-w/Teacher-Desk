import { formatStudentShortName } from '@/utils/student'
import {
  areSeatsAdjacent,
  areSeatsSameDesk,
  isBackRowSeat,
  isFrontRowSeat,
  seatBlockLabel,
} from '@/utils/seat'
import type { SeatConstraint, SeatConstraintType } from '@/types/constraint'
import type { Seat, SeatBlock } from '@/types/seat'
import type { Student } from '@/types'

/** 约束类型中文标签（添加 / 管理列表 / 检查消息共用） */
export const CONSTRAINT_TYPE_LABELS: Record<SeatConstraintType, string> = {
  'no-deskmate': '不能同桌',
  'no-adjacent': '不能相邻',
  'back-row': '坐后排',
  'front-row': '坐前排',
  'same-block': '同区块',
}

/** 关系型（硬）约束类型：自动排座必须满足，违反即冲突（Phase 3D 起） */
export const HARD_CONSTRAINT_TYPES: readonly SeatConstraintType[] = ['no-deskmate', 'no-adjacent']

/** 需要第二位学生的类型；back-row / front-row 只作用于主体学生 A */
const PAIR_CONSTRAINT_TYPES: readonly SeatConstraintType[] = [
  'no-deskmate',
  'no-adjacent',
  'same-block',
]

/** 该类型是否必须提供第二位学生（录入校验、检查与自动排座共用一套判定） */
export function isPairConstraintType(type: SeatConstraintType): boolean {
  return PAIR_CONSTRAINT_TYPES.includes(type)
}

/* ========== Constraint Checker（只检查，不自动改座位） ========== */

/** 检查分组（面板按此顺序渲染，组内无问题则显示 ✓ 行） */
export type ConstraintGroup = 'relation' | 'rules' | 'tall' | 'cadre'

/** 各分组无问题时的 ✓ 文案 */
export const CONSTRAINT_OK_LINES: Record<ConstraintGroup, string> = {
  relation: '无同桌 / 相邻冲突',
  rules: '坐后排 / 坐前排 / 同区块规则均已满足',
  tall: '无高个学生坐前排',
  cadre: '班委分布正常',
}

/** 严重度：conflict = 违反手工硬约束（红）；warn = 倾向性提醒（琥珀） */
export type ConstraintSeverity = 'conflict' | 'warn'

export interface ConstraintIssue {
  key: string
  group: ConstraintGroup
  severity: ConstraintSeverity
  /** 面向用户的检查结论，如「旦增卓玛（0918）与旦增卓玛（0924）成了同桌」 */
  message: string
  /** 涉及座位（定位滚动用；顺序即建议关注顺序） */
  seatIds: string[]
  /** 涉及学生（点击定位时闪烁用） */
  studentIds: string[]
}

/** 高个学生由「高个」标签表达（档案暂无独立身高字段，同座位图强调标记） */
const TALL_TAG = '高个'

/**
 * 已有「坐后排 / 坐前排」显式规则的学生（显式规则优先，判定与自动排座同源）：
 * 自动排座不再为其叠加「高个」标签派生的后排偏好，检查器也不再报「高个学生坐前排」
 * ——否则求解器按教师规则把高个学生排到前排后，面板会立刻报一条工具自己造出来的警告。
 */
export function explicitRowRuleStudentIds(constraints: SeatConstraint[]): Set<string> {
  return new Set(
    constraints
      .filter(
        (constraint) =>
          constraint.enabled && (constraint.type === 'back-row' || constraint.type === 'front-row'),
      )
      .map((constraint) => constraint.studentA),
  )
}

/* 同桌 / 相邻 / 前排 / 后排的判定**不在这里**：唯一实现是 `utils/seat.ts`
 * （`areSeatsSameDesk` / `areSeatsAdjacent` / `isFrontRowSeat` / `isBackRowSeat`）。
 * Phase 3C/3D 曾在本文件里另写一套「同列块内左右紧邻 = 同桌」的算法，
 * V1.1.2 Phase 2 已删除：同一个词在两处给出不同判定，教师会在两个面板上看到互相矛盾的结论。 */

/**
 * 对当前方案执行五类检查（纯函数，实时调用，不做任何座位调整）：
 * 1. 不能同桌（no-deskmate 硬约束）2. 不能相邻（no-adjacent 硬约束）
 * 3. 坐后排 / 坐前排 / 同区块（规则型软规则，未满足仅提醒，Phase 3D 起）
 * 4. 高个学生坐前排（1–2 排）提醒（已有显式坐前排 / 坐后排规则的学生除外，见
 *    explicitRowRuleStudentIds）5. 班委全部集中同一区块提醒。
 * 只统计当前方案中「双方都就座」的关系；学生已删除 / 未就座则自然不产生问题。
 */
export function checkSeatConstraints(ctx: {
  constraints: SeatConstraint[]
  seats: Seat[]
  students: ReadonlyMap<string, Student>
}): ConstraintIssue[] {
  const issues: ConstraintIssue[] = []

  /** 学生 → 当前方案座位（同一学生只会出现一次） */
  const studentSeat = new Map<string, Seat>()
  for (const seat of ctx.seats) {
    if (seat.studentId && !studentSeat.has(seat.studentId)) studentSeat.set(seat.studentId, seat)
  }

  function nameOf(studentId: string): string {
    const student = ctx.students.get(studentId)
    return student ? formatStudentShortName(student) : '已删除学生'
  }

  /** 1+2：手工录入的关系型硬约束（违反 = conflict） */
  for (const constraint of ctx.constraints) {
    if (!constraint.enabled) continue
    if (!HARD_CONSTRAINT_TYPES.includes(constraint.type)) continue
    const studentB = constraint.studentB
    if (!studentB || studentB === constraint.studentA) continue
    const seatA = studentSeat.get(constraint.studentA)
    const seatB = studentSeat.get(studentB)
    if (!seatA || !seatB) continue // 任一方未就座（当前方案）则无事发生
    const label = CONSTRAINT_TYPE_LABELS[constraint.type]
    const violated =
      constraint.type === 'no-deskmate'
        ? areSeatsSameDesk(seatA, seatB)
        : areSeatsAdjacent(seatA, seatB)
    if (!violated) continue
    issues.push({
      key: constraint.id,
      group: 'relation',
      severity: 'conflict',
      message:
        constraint.type === 'no-deskmate'
          ? `${nameOf(constraint.studentA)} 与 ${nameOf(studentB)} 成了同桌（违反「${label}」）`
          : `${nameOf(constraint.studentA)} 与 ${nameOf(studentB)} 相邻而坐（违反「${label}」）`,
      seatIds: [seatA.id, seatB.id],
      studentIds: [constraint.studentA, studentB],
    })
  }

  /** 3：规则型软约束未满足（只提醒；自动排座会尽量满足它们） */
  for (const constraint of ctx.constraints) {
    if (!constraint.enabled) continue
    if (HARD_CONSTRAINT_TYPES.includes(constraint.type)) continue
    const seatA = studentSeat.get(constraint.studentA)
    if (!seatA) continue // 未就座则无从判定（与关系型一致）
    if (constraint.type === 'back-row' && !isBackRowSeat(seatA)) {
      issues.push({
        key: constraint.id,
        group: 'rules',
        severity: 'warn',
        message: `${nameOf(constraint.studentA)} 应坐后排，当前在第 ${seatA.row} 排`,
        seatIds: [seatA.id],
        studentIds: [constraint.studentA],
      })
      continue
    }
    if (constraint.type === 'front-row' && !isFrontRowSeat(seatA)) {
      issues.push({
        key: constraint.id,
        group: 'rules',
        severity: 'warn',
        message: `${nameOf(constraint.studentA)} 应坐前排，当前在第 ${seatA.row} 排`,
        seatIds: [seatA.id],
        studentIds: [constraint.studentA],
      })
      continue
    }
    if (constraint.type === 'same-block') {
      const studentB = constraint.studentB
      if (!studentB || studentB === constraint.studentA) continue
      const seatB = studentSeat.get(studentB)
      if (!seatB || seatB.block === seatA.block) continue
      issues.push({
        key: constraint.id,
        group: 'rules',
        severity: 'warn',
        message: `${nameOf(constraint.studentA)} 与 ${nameOf(studentB)} 应同区块，当前 ${seatBlockLabel(seatA.block)} / ${seatBlockLabel(seatB.block)}`,
        seatIds: [seatA.id, seatB.id],
        studentIds: [constraint.studentA, studentB],
      })
    }
  }

  /** 4：高个学生坐前排（按排聚合为一条消息，点按定位该排全部高个学生） */
  const explicitRowRuleIds = explicitRowRuleStudentIds(ctx.constraints)
  const tallByRow = new Map<number, string[]>()
  for (const [studentId, seat] of studentSeat) {
    const student = ctx.students.get(studentId)
    if (!student || !student.tags?.includes(TALL_TAG)) continue
    if (!isFrontRowSeat(seat)) continue
    // 教师已用「坐前排」规则明确让该生坐前排 → 不再报派生提醒（否则与自动排座打架）
    if (explicitRowRuleIds.has(studentId)) continue
    const list = tallByRow.get(seat.row) ?? []
    list.push(studentId)
    tallByRow.set(seat.row, list)
  }
  for (const [row, ids] of [...tallByRow.entries()].sort((a, b) => a[0] - b[0])) {
    issues.push({
      key: `tall-row-${row}`,
      group: 'tall',
      severity: 'warn',
      message: `高个学生 ${ids.map(nameOf).join('、')} 坐在第 ${row} 排`,
      seatIds: ids.map((id) => studentSeat.get(id)?.id ?? '').filter(Boolean),
      studentIds: ids,
    })
  }

  /** 5：班委全部集中在同一区块（≥2 位班委就座时才提示） */
  const cadreByBlock = new Map<SeatBlock, string[]>()
  for (const [studentId, seat] of studentSeat) {
    const student = ctx.students.get(studentId)
    if (!student || !student.cadreRole) continue
    const list = cadreByBlock.get(seat.block) ?? []
    list.push(studentId)
    cadreByBlock.set(seat.block, list)
  }
  const seatedCadres = [...cadreByBlock.values()].flat()
  if (seatedCadres.length >= 2 && cadreByBlock.size === 1) {
    const block = [...cadreByBlock.keys()][0]
    const label = seatBlockLabel(block)
    const ids = cadreByBlock.get(block) as string[]
    issues.push({
      key: 'cadre-same-block',
      group: 'cadre',
      severity: 'warn',
      message: `班委集中：${ids.length} 位班委（${ids.map(nameOf).join('、')}）都在${label}`,
      seatIds: ids.map((id) => studentSeat.get(id)?.id ?? '').filter(Boolean),
      studentIds: ids,
    })
  }

  return issues
}
