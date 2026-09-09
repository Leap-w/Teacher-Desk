import { createId } from '@/utils/id'
import { DEFAULT_CLASSROOM_CONFIG } from '@/types/classroom'
import type { ClassroomConfig } from '@/types/classroom'
import type { Seat, SeatBlock, SeatChangeLog, SeatPlan } from '@/types/seat'
import type { Student } from '@/types'

/** 座位唯一标识：跨方案、跨视角稳定；未来换座日志的 from/to 也引用它 */
export function seatIdOf(row: number, col: number): string {
  return `r${row}c${col}`
}

/** 座位号（1 起，行优先连续编号，共 rows × cols 个）；学生档案的 seatNumber 与之对应 */
export function seatOrdinal(
  row: number,
  col: number,
  config: ClassroomConfig = DEFAULT_CLASSROOM_CONFIG,
): number {
  return (row - 1) * config.cols + col
}

const BLOCK_KEYS: readonly SeatBlock[] = ['left', 'center', 'right']

/** 列号 → 列块：按 config.blocks 的累计宽度自动切分（左 3｜中 3｜右 3） */
export function blockOfCol(col: number, config = DEFAULT_CLASSROOM_CONFIG): SeatBlock {
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
  config = DEFAULT_CLASSROOM_CONFIG,
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
  config = DEFAULT_CLASSROOM_CONFIG,
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
  config = DEFAULT_CLASSROOM_CONFIG,
): Seat[] {
  const seats: Seat[] = []
  for (let row = 1; row <= config.rows; row++) {
    for (let col = 1; col <= config.cols; col++) {
      seats.push(createSeat(row, col, occupants.get(seatOrdinal(row, col, config)), config))
    }
  }
  return seats
}

/** 新建座位方案：学生按 seatNumber 自动就座（前 62 号）；isCurrent 由 store 决定 */
export function createSeatPlan(
  name: string,
  students: Array<Pick<Student, 'id' | 'studentNo' | 'seatNumber'>>,
  config = DEFAULT_CLASSROOM_CONFIG,
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
  }
}

/**
 * 旧数据升级（load 时逐条调用，风格同 normalizeStudent）：
 * - 缺失字段回安全默认；id / block 不信任存储值，一律按 row/col 重建；
 * - 只保留行列合法（1~rows / 1~cols）且 studentId 为字符串的就座记录；
 * - 整表始终重建为 rows × cols 个座位，保证与教室配置一致，缺座 / 越界不白屏；
 * - Phase 3B 起方案含 changeLogs：旧数据缺失回 []，逐条只信任字符串字段、
 *   planId 回填为本方案 id（历史数据无该字段，保证与 SeatPlan 关联不悬空）。
 */
export function normalizeSeatPlan(
  raw: Partial<SeatPlan>,
  config = DEFAULT_CLASSROOM_CONFIG,
): SeatPlan {
  const planId = typeof raw.id === 'string' && raw.id ? raw.id : createId()
  const preserved = new Map<number, string>()
  if (Array.isArray(raw.seats)) {
    for (const item of raw.seats) {
      if (!item || typeof item !== 'object') continue
      const seat = item as Partial<Seat>
      const row = seat.row
      const col = seat.col
      const studentId = seat.studentId
      if (
        typeof row === 'number' &&
        Number.isInteger(row) &&
        row >= 1 &&
        row <= config.rows &&
        typeof col === 'number' &&
        Number.isInteger(col) &&
        col >= 1 &&
        col <= config.cols &&
        typeof studentId === 'string' &&
        studentId
      ) {
        preserved.set(seatOrdinal(row, col, config), studentId)
      }
    }
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
  }
}
