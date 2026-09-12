import { createId } from '@/utils/id'
import { formatStudentShortName } from '@/utils/student'
import { DEFAULT_CLASSROOM_CONFIG } from '@/types/classroom'
import type { ClassroomConfig } from '@/types/classroom'
import type {
  AdjacentGroupForbiddenRule,
  SameDeskForbiddenRule,
  Seat,
  SeatBlock,
  SeatChangeLog,
  SeatPlan,
  SeatPlanConstraints,
} from '@/types/seat'
import type { Student } from '@/types'

/** 座位唯一标识：跨方案、跨视角稳定；未来换座日志的 from/to 也引用它 */
export function seatIdOf(row: number, col: number): string {
  return `r${row}c${col}`
}

/**
 * 座位的稳定坐标键（V1.1.2 Phase 1 起的对外说法）。
 * **与 `seatIdOf` 是同一个字符串**（`r{row}c{col}`）——刻意不再造第二种键格式：
 * 同一间教室的同一个格子出现两套写法，是所有「对不上」类问题的开端。
 * 座位身份由物理坐标决定，**绝不用学生姓名 / 数组下标当座位 ID**。
 */
export function getSeatKey(row: number, col: number): string {
  return seatIdOf(row, col)
}

/** 坐标是否落在真实教室网格内（row 1~rows、col 1~cols，且为整数） */
export function isValidSeatPosition(
  row: unknown,
  col: unknown,
  config: ClassroomConfig = DEFAULT_CLASSROOM_CONFIG,
): boolean {
  return (
    typeof row === 'number' &&
    Number.isInteger(row) &&
    row >= 1 &&
    row <= config.rows &&
    typeof col === 'number' &&
    Number.isInteger(col) &&
    col >= 1 &&
    col <= config.cols
  )
}

/* ==========================================================================
 * 座位关系（V1.1.2 Phase 2：**全项目唯一的事实来源**）
 *
 * 这一个小节是「同桌」「相邻」「前排 / 后排」三个概念的唯一定义处：
 * 全局座位约束（Phase 3C/3D）、方案级排座约束（Phase 1）、两个检查器、
 * 自动排座求解器、拖拽后的即时检查——全部调用这里的函数。
 * **任何地方都不得再写第二套判定**（`utils/constraint.ts` 曾有一份
 * 「同列块内左右紧邻」的同桌算法，Phase 2 已删除、调用点全部改为本节的实现）。
 * ========================================================================== */

/**
 * **同桌**：同一排、同一列块 = 同一张课桌。
 *
 * 真实教室里每排每个区域（1/2/3、4/5/6、7/8/9）共用一张长桌，所以**不能**用「左右相邻」
 * 代替同桌判定——那样会把「1 号与 3 号同桌」判成不是同桌，也会漏掉「1 号与 3 号同桌」这种真冲突。
 * 过道两侧（3 与 4、6 与 7）**不是同桌**：它们之间隔着一条过道。
 */
export function areSeatsSameDesk(a: Seat, b: Seat): boolean {
  return a.row === b.row && a.block === b.block
}

/** 同桌组标识（同排同列块）：约束检查按它把座位归堆 */
export function deskGroupKey(seat: Seat): string {
  return `${seat.row}-${seat.block}`
}

/**
 * **相邻**判定：只认四邻域（上 / 下 / 左 / 右），**不含对角**。
 *
 * 关键细节——**两条过道不算相邻**：
 * - 左右相邻必须**同排同列块**（`1 2 3 | 4 5 6 | 7 8 9` 里 `3 ↔ 4`、`6 ↔ 7` 隔着过道，
 *   在真实教室里不是挨着坐，因此既不是同桌也不是相邻）；
 * - 前后相邻是同列、相邻两排（同一列不会有过道问题，过道是纵向的）。
 *
 * 这是全项目唯一的邻接规则实现；若将来真实教室要改成「过道可视为相邻」，
 * 只改这一个函数，并在界面上说明规则已变。
 */
export function areSeatsAdjacent(a: Seat, b: Seat): boolean {
  if (a.row === b.row) return a.block === b.block && Math.abs(a.col - b.col) === 1
  return a.col === b.col && Math.abs(a.row - b.row) === 1
}

/* ---------------- 前排 / 后排（同一份阈值，两个检查器共用） ---------------- */

/**
 * 视为前排的排数（第 1~2 排靠近讲台）。
 * 自动排座的「坐前排」用的是连续排号打分，不引用该阈值（见 utils/seatArrange.ts）。
 */
export const FRONT_ROW_LIMIT = 2

/** 视为后排的起始排数（第 5 排及以后） */
export const BACK_ROW_MIN = 5

/** 该座位是否属于「前排」（第 1~FRONT_ROW_LIMIT 排） */
export function isFrontRowSeat(seat: Seat): boolean {
  return seat.row <= FRONT_ROW_LIMIT
}

/** 该座位是否属于「后排」（第 BACK_ROW_MIN 排及以后） */
export function isBackRowSeat(seat: Seat): boolean {
  return seat.row >= BACK_ROW_MIN
}

/* ---------------- 口径说明文案（界面上只说一套说法） ---------------- */

/**
 * 「同桌」的口径说明（两个约束弹窗共用一份）。
 * 界面文案与判定函数放在同一个模块，是为了让「改规则时漏改提示语」不可能发生——
 * 教师看到的说法与实际判定必须永远是同一句。
 */
export const SAME_DESK_RULE_NOTE =
  '同桌 = 同一排、同一列块（每桌 3 座：1/2/3、4/5/6、7/8/9）；过道两侧不算同桌'

/** 「相邻」的口径说明（同上） */
export const ADJACENT_RULE_NOTE = '相邻 = 左右或前后紧挨着（斜对角不算，隔着过道也不算）'

/** 座位号（1 起，行优先连续编号，共 rows × cols 个）；学生档案的 seatNumber 与之对应 */
export function seatOrdinal(
  row: number,
  col: number,
  config: ClassroomConfig = DEFAULT_CLASSROOM_CONFIG,
): number {
  // 注：config 参数一律显式标注 ClassroomConfig——默认值是不可变字面量，
  // 不标注会被推断成字面量类型，导致调用方无法传入其他 ClassroomConfig
  return (row - 1) * config.cols + col
}

const BLOCK_KEYS: readonly SeatBlock[] = ['left', 'center', 'right']

/** 列号 → 列块：按 config.blocks 的累计宽度自动切分（左 3｜中 3｜右 3） */
export function blockOfCol(
  col: number,
  config: ClassroomConfig = DEFAULT_CLASSROOM_CONFIG,
): SeatBlock {
  let offset = 0
  for (let i = 0; i < config.blocks.length && i < BLOCK_KEYS.length; i++) {
    offset += config.blocks[i]
    if (col <= offset) return BLOCK_KEYS[i]
  }
  return BLOCK_KEYS[BLOCK_KEYS.length - 1]
}

/** 建一个座位：id / 列块自动计算，调用方只需给出行列（与可选学生） */
export function createSeat(
  row: number,
  col: number,
  studentId?: string,
  config: ClassroomConfig = DEFAULT_CLASSROOM_CONFIG,
): Seat {
  return { id: seatIdOf(row, col), row, col, block: blockOfCol(col, config), studentId }
}

/** 位置文案（长，Toast 用）：如「第7排第9列」 */
export function seatPositionLong(row: number, col: number): string {
  return `第${row}排第${col}列`
}

/** 位置文案（短，日志用）：如「2排3列」（SeatChangeLog.from / to 的存储格式，渲染时拼为「2排3列 → 5排1列」） */
export function seatPositionShort(row: number, col: number): string {
  return `${row}排${col}列`
}

/**
 * 学生 → 座位号映射：按学生档案 seatNumber（1~occupiedSeats）对号入座。
 * 末位尾座（第 63 号）固定留空；同号冲突按学号升序先到先得；无 seatNumber 的学生不就座。
 */
export function buildOccupantMap(
  students: Array<Pick<Student, 'id' | 'studentNo' | 'seatNumber'>>,
  config: ClassroomConfig = DEFAULT_CLASSROOM_CONFIG,
): Map<number, string> {
  const occupants = new Map<number, string>()
  const valid = students
    .filter(
      (item) =>
        item.seatNumber !== undefined &&
        Number.isInteger(item.seatNumber) &&
        item.seatNumber >= 1 &&
        item.seatNumber <= config.occupiedSeats,
    )
    .sort((a, b) => a.studentNo.localeCompare(b.studentNo))
  for (const item of valid) {
    const seatNo = item.seatNumber as number
    if (!occupants.has(seatNo)) occupants.set(seatNo, item.id)
  }
  return occupants
}

/** 按教室配置生成完整座位网格（rows × cols）；occupants 以座位号为键 */
export function buildSeatGrid(
  occupants: Map<number, string> = new Map(),
  config: ClassroomConfig = DEFAULT_CLASSROOM_CONFIG,
): Seat[] {
  const seats: Seat[] = []
  for (let row = 1; row <= config.rows; row++) {
    for (let col = 1; col <= config.cols; col++) {
      seats.push(createSeat(row, col, occupants.get(seatOrdinal(row, col, config)), config))
    }
  }
  return seats
}

/** 新建座位方案：学生按 seatNumber 自动就座（前 62 号）；isCurrent 由 store 决定；约束为空 */
export function createSeatPlan(
  name: string,
  students: Array<Pick<Student, 'id' | 'studentNo' | 'seatNumber'>>,
  config: ClassroomConfig = DEFAULT_CLASSROOM_CONFIG,
): SeatPlan {
  const now = new Date().toISOString()
  return {
    id: createId(),
    name: name.trim(),
    createdAt: now,
    updatedAt: now,
    isCurrent: false,
    seats: buildSeatGrid(buildOccupantMap(students, config), config),
    changeLogs: [],
    constraints: createEmptySeatPlanConstraints(),
  }
}

/**
 * 旧数据升级（load 时逐条调用，风格同 normalizeStudent）：
 * - 缺失字段回安全默认；id / block 不信任存储值，一律按 row/col 重建；
 * - 只保留行列合法（1~rows / 1~cols）且 studentId 为字符串的就座记录；
 * - 整表始终重建为 rows × cols 个座位，保证与教室配置一致，缺座 / 越界不白屏；
 * - Phase 3B 起方案含 changeLogs：旧数据缺失回 []，逐条只信任字符串字段、
 *   planId 回填为本方案 id（历史数据无该字段，保证与 SeatPlan 关联不悬空）。
 * - **V1.1.2 Phase 1 起含 constraints**：旧数据缺失回空约束（**升级不丢方案**）；
 *   更早期只有「数组顺序」没有 row / col 的数据，按行优先序号做**一次性确定性迁移**：
 *   第 i 条（0 起）→ 第 i+1 号座位 → row = ⌊i / cols⌋ + 1、col = i % cols + 1。
 *   只对**坐标非法**的条目生效，绝不覆盖已有坐标，也绝不触碰学生档案。
 */
export function normalizeSeatPlan(
  raw: Partial<SeatPlan>,
  config: ClassroomConfig = DEFAULT_CLASSROOM_CONFIG,
): SeatPlan {
  const planId = typeof raw.id === 'string' && raw.id ? raw.id : createId()
  const preserved = new Map<number, string>()
  if (Array.isArray(raw.seats)) {
    raw.seats.forEach((item, index) => {
      if (!item || typeof item !== 'object') return
      const seat = item as Partial<Seat>
      const studentId = seat.studentId
      if (typeof studentId !== 'string' || !studentId) return
      if (isValidSeatPosition(seat.row, seat.col, config)) {
        preserved.set(seatOrdinal(seat.row as number, seat.col as number, config), studentId)
        return
      }
      // 没有物理坐标的旧数据（Phase 3A 之前只有数组顺序）→ 数组下标即座位号（行优先），
      // 确定性且可重放。**只在坐标整个缺失时兜底**：写了坐标却越界的那条是坏数据，
      // 按下标猜一个座位反而会把学生悄悄挪到别处，宁可不收。
      const hasCoords = typeof seat.row === 'number' || typeof seat.col === 'number'
      if (!hasCoords && index < config.totalSeats) preserved.set(index + 1, studentId)
    })
  }
  const changeLogs: SeatChangeLog[] = []
  if (Array.isArray(raw.changeLogs)) {
    for (const item of raw.changeLogs) {
      if (!item || typeof item !== 'object') continue
      const log = item as Partial<SeatChangeLog>
      if (
        typeof log.studentId !== 'string' ||
        !log.studentId ||
        typeof log.studentName !== 'string' ||
        !log.studentName ||
        typeof log.from !== 'string' ||
        !log.from ||
        typeof log.to !== 'string' ||
        !log.to
      ) {
        continue
      }
      changeLogs.push({
        id: typeof log.id === 'string' && log.id ? log.id : createId(),
        planId: typeof log.planId === 'string' && log.planId ? log.planId : planId,
        studentId: log.studentId,
        studentName: log.studentName,
        from: log.from,
        to: log.to,
        changedAt: typeof log.changedAt === 'string' ? log.changedAt : '',
      })
    }
  }
  return {
    id: planId,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : '座位方案',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    isCurrent: raw.isCurrent === true,
    seats: buildSeatGrid(preserved, config),
    changeLogs,
    constraints: normalizeSeatPlanConstraints(raw.constraints),
  }
}

/* ========== V1.1.2 Phase 1：排座约束（方案级） ========== */

/** 空约束（**每次返回全新数组**：常量对象被多方引用时，一处 push 会污染所有方案） */
export function createEmptySeatPlanConstraints(): SeatPlanConstraints {
  return {
    sameDeskForbidden: [],
    adjacentGroupForbidden: [],
    frontRowStudents: [],
    backRowStudents: [],
  }
}

/** 去掉空串与重复项（保序）：名单只存学生 id，不存姓名 */
function uniqueIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const ids: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !item) continue
    if (seen.has(item)) continue
    seen.add(item)
    ids.push(item)
  }
  return ids
}

/** 不能同桌：只认两名互异学生（自相约束无意义，直接丢弃） */
function normalizeSameDeskRules(value: unknown): SameDeskForbiddenRule[] {
  if (!Array.isArray(value)) return []
  const rules: SameDeskForbiddenRule[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const rule = item as Partial<SameDeskForbiddenRule>
    if (typeof rule.studentA !== 'string' || !rule.studentA) continue
    if (typeof rule.studentB !== 'string' || !rule.studentB) continue
    if (rule.studentA === rule.studentB) continue
    // 同一对学生（不计方向）只留一条，避免重复提示
    const pairKey = [rule.studentA, rule.studentB].sort().join('|')
    if (seen.has(pairKey)) continue
    seen.add(pairKey)
    rules.push({
      id: typeof rule.id === 'string' && rule.id ? rule.id : createId(),
      studentA: rule.studentA,
      studentB: rule.studentB,
    })
  }
  return rules
}

/** 三人不能相邻组：必须是互异的三名学生 */
function normalizeAdjacentGroups(value: unknown): AdjacentGroupForbiddenRule[] {
  if (!Array.isArray(value)) return []
  const groups: AdjacentGroupForbiddenRule[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const rule = item as Partial<AdjacentGroupForbiddenRule>
    const students = Array.isArray(rule.students) ? rule.students : []
    if (students.length !== 3) continue
    if (students.some((id) => typeof id !== 'string' || !id)) continue
    const unique = new Set(students as string[])
    if (unique.size !== 3) continue
    const groupKey = [...unique].sort().join('|')
    if (seen.has(groupKey)) continue
    seen.add(groupKey)
    groups.push({
      id: typeof rule.id === 'string' && rule.id ? rule.id : createId(),
      students: [students[0], students[1], students[2]] as [string, string, string],
    })
  }
  return groups
}

/**
 * 约束规范化（首屏加载 / 跨标签页同步 / 云端同步三条路径共用同一份实现）：
 * 只信合法字段，非法即丢弃；缺字段回空数组。同一名学生**不会同时**出现在前后排两份名单里。
 */
export function normalizeSeatPlanConstraints(raw: unknown): SeatPlanConstraints {
  if (!raw || typeof raw !== 'object') return createEmptySeatPlanConstraints()
  const value = raw as Partial<SeatPlanConstraints>
  const frontRowStudents = uniqueIds(value.frontRowStudents)
  const frontSet = new Set(frontRowStudents)
  return {
    sameDeskForbidden: normalizeSameDeskRules(value.sameDeskForbidden),
    adjacentGroupForbidden: normalizeAdjacentGroups(value.adjacentGroupForbidden),
    frontRowStudents,
    backRowStudents: uniqueIds(value.backRowStudents).filter((id) => !frontSet.has(id)),
  }
}

/* ========== Phase 3C：列块中文名 / 方案对比 ========== */

/** 列块中文名（对比结果 / 约束消息 / 统计展示共用）：left｜center｜right → 左区｜中区｜右区 */
export const SEAT_BLOCK_LABELS: Record<SeatBlock, string> = {
  left: '左区',
  center: '中区',
  right: '右区',
}

export function seatBlockLabel(block: SeatBlock): string {
  return SEAT_BLOCK_LABELS[block]
}

/** 方案对比单条结果：某学生在两份方案中的就座位置差异（只读快照，不引用两方案之外的数据） */
export interface SeatCompareEntry {
  studentId: string
  /** 姓名快照（姓名（学号后四位）），展示不再回头查学生表 */
  name: string
  /** 方案 A 中的座位；该学生未就座时为 undefined */
  fromSeat?: Seat
  /** 方案 B（对比基准，通常为当前方案）中的座位 */
  toSeat: Seat
}

export interface SeatCompareResult {
  /** 座位发生变化的学生数（共调整 N 人） */
  total: number
  entries: SeatCompareEntry[]
  /** 方案 B 中「发生变化的学生」id 集合（座位图 / 导出图高亮用；只含集合，不复制学生对象） */
  changedStudentIds: Set<string>
}

/** 位置文案：第2排第3列；未就座显示「未就座」 */
function positionText(seat: Seat | undefined): string {
  return seat ? seatPositionLong(seat.row, seat.col) : '未就座'
}

/**
 * 位置变化行：「第2排第3列 → 第4排第2列」（原先未就座显示「未就座 → …」）。
 * 页面内对比弹窗与对比 PDF（SeatExportSummary）**共用这一份**——两处各写一份就会漂移，
 * 教师会看到弹窗与打印出来的 PDF 对同一次换座说法不一致（§11.1 单一来源）。
 */
export function seatChangeMoveLine(entry: SeatCompareEntry): string {
  return `${positionText(entry.fromSeat)} → ${positionText(entry.toSeat)}`
}

/** 区块变化行（仅跨区时返回，同区 / 原先未就座返回 undefined）：左区 → 中区 */
export function seatChangeZoneLine(entry: SeatCompareEntry): string | undefined {
  const from = entry.fromSeat?.block
  const to = entry.toSeat?.block
  if (!from || !to || from === to) return undefined
  return `${seatBlockLabel(from)} → ${seatBlockLabel(to)}`
}

/**
 * 对比两份方案的座位差异：同一学生两方案座位不同（含只在一方就座）即计入。
 * 学生名以快照形式落入 entries；changedStudentIds 只存 id，不重复创建任何 Student。
 */
export function compareSeatPlans(
  planA: SeatPlan,
  planB: SeatPlan,
  students: ReadonlyMap<string, Student>,
): SeatCompareResult {
  const seatOfA = new Map<string, Seat>()
  for (const seat of planA.seats) {
    if (seat.studentId && !seatOfA.has(seat.studentId)) seatOfA.set(seat.studentId, seat)
  }
  const entries: SeatCompareEntry[] = []
  const changedStudentIds = new Set<string>()
  for (const seat of planB.seats) {
    if (!seat.studentId) continue
    const from = seatOfA.get(seat.studentId)
    if (from && from.id === seat.id) continue
    const student = students.get(seat.studentId)
    changedStudentIds.add(seat.studentId)
    entries.push({
      studentId: seat.studentId,
      name: student ? formatStudentShortName(student) : '已删除学生',
      fromSeat: from,
      toSeat: seat,
    })
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  return { total: entries.length, entries, changedStudentIds }
}
