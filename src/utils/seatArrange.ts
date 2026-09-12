import {
  CONSTRAINT_TYPE_LABELS,
  explicitRowRuleStudentIds,
  HARD_CONSTRAINT_TYPES,
  isPairConstraintType,
} from '@/utils/constraint'
import { areSeatsAdjacent, areSeatsSameDesk, buildSeatGrid } from '@/utils/seat'
import { formatStudentShortName } from '@/utils/student'
import { DEFAULT_CLASSROOM_CONFIG } from '@/types/classroom'
import type { ClassroomConfig } from '@/types/classroom'
import type { SeatConstraint } from '@/types/constraint'
import type { Seat } from '@/types/seat'
import type { Student } from '@/types'

/**
 * 自动排座求解器（Phase 3D，纯函数，无 store 依赖）。
 *
 * 输入 = 学生档案既有字段（学号 / 姓名 / 标签）+ 约束表 + 教室配置；输出 = 一份完整座位网格。
 * - 硬约束（不能同桌 / 不能相邻）：绝不违反；找不到解时不产出方案，改为报告冲突来源。
 *   判定**只用** `utils/seat.ts` 的关系函数（V1.1.2 Phase 2 统一，本模块不自带任何几何算法）：
 *   「不能同桌」= 不同坐一张长桌（同排同列块，1 号与 3 号隔着一个人也算同桌）；
 *   「不能相邻」= 四邻域（上下左右），不含对角、不含跨过道（3 与 4 / 6 与 7 不算相邻）；
 * - 软规则（坐后排 / 坐前排 / 同区块）与「高个」标签派生的后排偏好：尽量满足，
 *   未满足的部分由 `checkSeatConstraints` 的 rules 分组逐条提示（判定与消息单一来源）；
 * - 确定性：同一输入 + 同一种子 = 同一结果（换种子 = 换一种排法）；排序键一律在函数内部计算，
 *   不依赖调用方数组顺序（学生表顺序会随持久化 / 重载变化）。
 */

/** 软分权重：教师手工录入的规则优先于由「高个」标签派生的偏好 */
const WEIGHT_RULE = 3
const WEIGHT_TALL = 1
/** 「高个」标签（与座位图强调标记、检查器的前排提醒同源） */
const TALL_TAG = '高个'
/** 贪心放置的重启上限（每次换种子重试）；62 座规模下正常首次即成功 */
const MAX_ATTEMPTS = 200
/** 局部搜索迭代上限（随机交换 / 移入空位，只接受软分提升） */
const MAX_SEARCH_STEPS = 3000

export interface ArrangeInput {
  /** 全体活跃学生（求解器内部自行排序与投影） */
  students: Student[]
  /** 全部座位约束（内部只取 enabled 且学生仍存在的条目） */
  constraints: SeatConstraint[]
  config?: ClassroomConfig
  /** 排法种子（同种子同结果；页面「换一种排法」= 递增种子） */
  seed?: number
}

export type ArrangeResult =
  | {
      ok: true
      /** 完整网格（恒为 rows × cols 座，末排尾座为空位） */
      seats: Seat[]
      /** 超出教室容量、未安排的学生 id（按学号升序截断的尾部） */
      unplacedStudentIds: string[]
      /** 实际重启次数（1 = 首次贪心即成功；仅供参考） */
      attempts: number
    }
  | {
      ok: false
      /**
       * 未能满足的硬约束（面向用户的消息，已去重，供调用方逐条展示）。
       * 是「没找到排法」而非「数学上无解」——极稠密约束下贪心可能放弃确有解的情形。
       */
      conflicts: string[]
      attempts: number
    }

/** 座位分配状态：cells 与 position 互为反向索引，始终同步维护 */
interface Placement {
  /** 座位号（1 起）→ 学生 id；索引 = 座位号 - 1，空位为 undefined */
  cells: Array<string | undefined>
  /** 学生 id → 座位号 */
  position: Map<string, number>
}

/** xorshift32：确定性伪随机序列（不引依赖；同一种子可复现） */
function createRandom(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9
  return () => {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 0x100000000
  }
}

/** 原地洗牌（贪心候选位的同分随机化用，避免每次都得到同一种排法） */
function shuffle<T>(items: T[], random: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const swap = items[i]
    items[i] = items[j]
    items[j] = swap
  }
}

function emptyPlacement(totalSeats: number): Placement {
  return { cells: new Array<string | undefined>(totalSeats).fill(undefined), position: new Map() }
}

function placeAt(target: Placement, studentId: string, ordinal: number): void {
  target.cells[ordinal - 1] = studentId
  target.position.set(studentId, ordinal)
}

/** 交换两座内容（一方为空 = 移入空位），反向索引同步更新 */
function swapAt(target: Placement, a: number, b: number): void {
  const idA = target.cells[a - 1]
  const idB = target.cells[b - 1]
  target.cells[a - 1] = idB
  target.cells[b - 1] = idA
  if (idA) target.position.set(idA, b)
  if (idB) target.position.set(idB, a)
}

/* ========== 输入解析（求解与弹窗摘要共用，避免两处口径漂移） ========== */

/** 教室可排座位数：末排尾座固定留空（§2.4），容量以配置为准 */
function capacityOf(config: ClassroomConfig): number {
  return Math.max(1, Math.min(config.occupiedSeats, config.totalSeats - 1))
}

/** 参与求解的约束：启用 + 涉及学生仍存在（学生删除时 constraint store 已清理，此处为防御） */
function isActiveConstraint(
  constraint: SeatConstraint,
  hasStudent: (id: string) => boolean,
): boolean {
  if (!constraint.enabled || !hasStudent(constraint.studentA)) return false
  if (!isPairConstraintType(constraint.type)) return true
  return Boolean(
    constraint.studentB &&
    constraint.studentB !== constraint.studentA &&
    hasStudent(constraint.studentB),
  )
}

/** 由「高个」标签派生后排偏好的学生（已有坐后排 / 坐前排显式规则者除外，判定与检查器同源） */
function tallStudentIdsOf(students: Student[], soft: SeatConstraint[]): Set<string> {
  const explicit = explicitRowRuleStudentIds(soft)
  return new Set(
    students
      .filter((student) => student.tags?.includes(TALL_TAG) && !explicit.has(student.id))
      .map((student) => student.id),
  )
}

export function arrangeSeats(input: ArrangeInput): ArrangeResult {
  const config = input.config ?? DEFAULT_CLASSROOM_CONFIG
  /** 完整教室网格（索引 = 座位号 - 1）：行列 / 列块几何一律取自它 */
  const grid = buildSeatGrid(new Map(), config)

  const students = [...input.students].sort((a, b) => a.studentNo.localeCompare(b.studentNo))
  const byId = new Map(students.map((student) => [student.id, student]))

  /** 可用座位号 1..capacity：末排尾座固定留空（§2.4） */
  const capacity = capacityOf(config)
  const seated = students.slice(0, capacity)
  const unplacedStudentIds = students.slice(capacity).map((student) => student.id)

  const active = input.constraints.filter((constraint) =>
    isActiveConstraint(constraint, (id) => byId.has(id)),
  )
  const hard = active.filter((constraint) => HARD_CONSTRAINT_TYPES.includes(constraint.type))
  const soft = active.filter((constraint) => !HARD_CONSTRAINT_TYPES.includes(constraint.type))

  /** 学生的硬约束索引：贪心时只查与该生相关的约束 */
  const hardByStudent = new Map<string, SeatConstraint[]>()
  for (const constraint of hard) {
    for (const id of [constraint.studentA, constraint.studentB as string]) {
      const list = hardByStudent.get(id)
      if (list) list.push(constraint)
      else hardByStudent.set(id, [constraint])
    }
  }

  /** 「高个」标签派生偏好（显式坐后排 / 坐前排规则优先，见 tallStudentIdsOf / explicitRowRuleStudentIds） */
  const tallStudentIds = tallStudentIdsOf(students, soft)

  /** 行号归一化：第 1 排 = 0，最后一排 = 1（「越靠后分越高」的连续打分） */
  const rowNorm = (row: number) => (config.rows > 1 ? (row - 1) / (config.rows - 1) : 0)

  const nameOf = (studentId: string): string => {
    const student = byId.get(studentId)
    return student ? formatStudentShortName(student) : '已删除学生'
  }

  /** 把某生放到某座位是否与已放置学生冲突（只查该生的硬约束；position 为 O(1) 反向索引） */
  function canPlace(target: Placement, studentId: string, ordinal: number): boolean {
    const seat = grid[ordinal - 1]
    for (const constraint of hardByStudent.get(studentId) ?? []) {
      const otherId = constraint.studentA === studentId ? constraint.studentB : constraint.studentA
      const otherOrdinal = otherId ? target.position.get(otherId) : undefined
      if (!otherOrdinal) continue
      const otherSeat = grid[otherOrdinal - 1]
      if (constraint.type === 'no-deskmate' && areSeatsSameDesk(seat, otherSeat)) return false
      if (constraint.type === 'no-adjacent' && areSeatsAdjacent(seat, otherSeat)) return false
    }
    return true
  }

  /** 整表校验：全部硬约束是否都未违反（局部搜索接受交换前的把关） */
  function hardOk(target: Placement): boolean {
    for (const constraint of hard) {
      const ordinalA = target.position.get(constraint.studentA)
      const ordinalB = constraint.studentB ? target.position.get(constraint.studentB) : undefined
      if (!ordinalA || !ordinalB) continue
      const seatA = grid[ordinalA - 1]
      const seatB = grid[ordinalB - 1]
      if (constraint.type === 'no-deskmate' && areSeatsSameDesk(seatA, seatB)) return false
      if (constraint.type === 'no-adjacent' && areSeatsAdjacent(seatA, seatB)) return false
    }
    return true
  }

  /** 某生在某座位上的软分（贪心选位用；same-block 仅在对家已就座时计入） */
  function placementScore(target: Placement, studentId: string, ordinal: number): number {
    const seat = grid[ordinal - 1]
    let score = 0
    for (const constraint of soft) {
      if (constraint.type === 'same-block' && constraint.studentB) {
        const isSubject = constraint.studentA === studentId
        const isOther = constraint.studentB === studentId
        if (!isSubject && !isOther) continue
        const partnerId = isSubject ? constraint.studentB : constraint.studentA
        const partnerOrdinal = target.position.get(partnerId)
        if (partnerOrdinal && grid[partnerOrdinal - 1].block === seat.block) score += WEIGHT_RULE
        continue
      }
      if (constraint.studentA !== studentId) continue
      if (constraint.type === 'back-row') score += WEIGHT_RULE * rowNorm(seat.row)
      else if (constraint.type === 'front-row') score += WEIGHT_RULE * (1 - rowNorm(seat.row))
    }
    if (tallStudentIds.has(studentId)) score += WEIGHT_TALL * rowNorm(seat.row)
    return score
  }

  /** 整表软分（局部搜索的目标函数；same-block 按约束计一次，不因两名学生重复计分） */
  function scoreOf(target: Placement): number {
    let score = 0
    for (const constraint of soft) {
      const ordinalA = target.position.get(constraint.studentA)
      if (!ordinalA) continue
      const seatA = grid[ordinalA - 1]
      if (constraint.type === 'back-row') {
        score += WEIGHT_RULE * rowNorm(seatA.row)
      } else if (constraint.type === 'front-row') {
        score += WEIGHT_RULE * (1 - rowNorm(seatA.row))
      } else if (constraint.type === 'same-block' && constraint.studentB) {
        const ordinalB = target.position.get(constraint.studentB)
        if (ordinalB && grid[ordinalB - 1].block === seatA.block) score += WEIGHT_RULE
      }
    }
    for (const studentId of tallStudentIds) {
      const ordinal = target.position.get(studentId)
      if (ordinal) score += WEIGHT_TALL * rowNorm(grid[ordinal - 1].row)
    }
    return score
  }

  /** 学生排布顺序：硬约束多的先放（最可能冲突的先安置），同度按学号升序 */
  const degreeOf = (studentId: string) => (hardByStudent.get(studentId) ?? []).length
  const order = [...seated].sort((a, b) => {
    const diff = degreeOf(b.id) - degreeOf(a.id)
    return diff !== 0 ? diff : a.studentNo.localeCompare(b.studentNo)
  })

  const baseSeed = input.seed ?? 1
  let failedStudentId = ''
  let failedPlaced = -1

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // 每次重启用递推种子，保证「同输入 + 同种子」仍完全可复现
    const random = createRandom(baseSeed + attempt * 7919)
    const placement = emptyPlacement(config.totalSeats)
    let blocked = ''

    for (const student of order) {
      const candidates: number[] = []
      for (let ordinal = 1; ordinal <= capacity; ordinal++) {
        if (placement.cells[ordinal - 1] !== undefined) continue
        if (canPlace(placement, student.id, ordinal)) candidates.push(ordinal)
      }
      if (candidates.length === 0) {
        blocked = student.id
        break
      }
      // 同分随机：先洗牌，再取软分最高者（不同种子 → 不同排法）
      shuffle(candidates, random)
      let best = candidates[0]
      let bestScore = Number.NEGATIVE_INFINITY
      for (const ordinal of candidates) {
        const score = placementScore(placement, student.id, ordinal)
        if (score > bestScore) {
          bestScore = score
          best = ordinal
        }
      }
      placeAt(placement, student.id, best)
    }

    if (blocked) {
      if (placement.position.size > failedPlaced) {
        failedPlaced = placement.position.size
        failedStudentId = blocked
      }
      continue
    }

    // 局部搜索：随机交换（含移入空位），硬约束不破且软分提升才接受
    let current = placement
    let currentScore = scoreOf(current)
    for (let step = 0; step < MAX_SEARCH_STEPS; step++) {
      const a = 1 + Math.floor(random() * capacity)
      const b = 1 + Math.floor(random() * capacity)
      if (a === b) continue
      if (!current.cells[a - 1] && !current.cells[b - 1]) continue
      const next: Placement = { cells: [...current.cells], position: new Map(current.position) }
      swapAt(next, a, b)
      if (!hardOk(next)) continue
      const nextScore = scoreOf(next)
      if (nextScore > currentScore) {
        current = next
        currentScore = nextScore
      }
    }

    return {
      ok: true,
      seats: grid.map((seat, index) => {
        const studentId = current.cells[index]
        return studentId ? { ...seat, studentId } : { ...seat }
      }),
      unplacedStudentIds,
      attempts: attempt + 1,
    }
  }

  // 全部尝试都放不下同一名学生：报告与该生相关的硬约束作为冲突来源。
  // 注意措辞是「未找到」而非「无解」——贪心 + 重启在极稠密的硬约束下可能找不到
  // 确实存在的排法（见 §9.5 边界），此时教师换个种子重试仍可能成功。
  const conflicts = (hardByStudent.get(failedStudentId) ?? []).map((constraint) => {
    const label = CONSTRAINT_TYPE_LABELS[constraint.type]
    // 失败学生可能是约束的 B 方（hardByStudent 两侧都登记）→ 取另一方，避免「X 与 X」
    const otherId =
      constraint.studentA === failedStudentId ? constraint.studentB : constraint.studentA
    const nameOther = otherId ? ` 与 ${nameOf(otherId)}` : ''
    return `${label}：${nameOf(failedStudentId)}${nameOther}`
  })
  // 同一名学生可命中多条约束、两名学生互为对家时会产出同一条消息 → 去重
  const uniqueConflicts = [...new Set(conflicts)]
  return {
    ok: false,
    conflicts:
      uniqueConflicts.length > 0
        ? uniqueConflicts
        : ['未能在当前座位数下找到满足全部硬约束的排法（可能无解）'],
    attempts: MAX_ATTEMPTS,
  }
}

/** 自动排座输入摘要（弹窗展示用；判定与求解完全同源，两处口径不会漂移） */
export interface ArrangeInputSummary {
  /** 参与排座的学生数（全部活跃学生，含超出容量者） */
  studentCount: number
  /** 教室可排座位数（末排尾座固定留空） */
  capacity: number
  /** 硬约束条数（不能同桌 / 不能相邻） */
  hardCount: number
  /** 软规则条数（坐后排 / 坐前排 / 同区块） */
  softCount: number
  /** 由「高个」标签派生后排偏好的人数（按容量范围内的学生计） */
  tallCount: number
}

export function summarizeArrangeInput(input: ArrangeInput): ArrangeInputSummary {
  const config = input.config ?? DEFAULT_CLASSROOM_CONFIG
  const capacity = capacityOf(config)
  const ids = new Set(input.students.map((student) => student.id))
  const active = input.constraints.filter((constraint) =>
    isActiveConstraint(constraint, (id) => ids.has(id)),
  )
  const soft = active.filter((constraint) => !HARD_CONSTRAINT_TYPES.includes(constraint.type))
  // 与求解一致：按学号升序取容量范围内的学生做「高个」计数
  const seated = [...input.students]
    .sort((a, b) => a.studentNo.localeCompare(b.studentNo))
    .slice(0, capacity)
  return {
    studentCount: input.students.length,
    capacity,
    hardCount: active.length - soft.length,
    softCount: soft.length,
    tallCount: tallStudentIdsOf(seated, soft).size,
  }
}
