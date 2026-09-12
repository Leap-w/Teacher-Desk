/**
 * 教室视角转换（V1.1.2 Phase 1）——双视角的**唯一实现**。
 *
 * 物理坐标恒定：`row` 1~7（第 1 排最靠近讲台）、`col` 1~9（左→右），与视角无关。
 * 两个视角是同一份数据的 **180° 旋转关系**：
 *
 *     学生视角坐标 = (rows + 1 - row, cols + 1 - col)
 *
 * 于是「老师视角第 1 排」在学生视角里是第 7 排，且**每一排左右完全翻转**
 * （老师 1 2 3 | 4 5 6 | 7 8 9 → 学生 9 8 7 | 6 5 4 | 3 2 1）。
 *
 * 该变换是**自逆的**（`transform(transform(p)) === p`），所以「物理坐标 → 显示槽位」
 * 与「显示槽位 → 物理坐标」是同一次运算，共用一个函数，不会写岔。
 *
 * **页面（SeatClassroom）与导出图（SeatExportGraphic）必须共用本模块**：视角逻辑写两份，
 * 迟早出现「导出的学生视角与页面学生视角不一致」——那正是本阶段要修的毛病。
 *
 * 数据本身不因切换视角而改变：本模块只产出**显示顺序与显示槽位**，
 * 既不复制 Seat 对象，也不重排方案里的 `seats` 数组。
 */
import { seatIdOf } from '@/utils/seat'
import { DEFAULT_CLASSROOM_CONFIG } from '@/types/classroom'
import type { ClassroomConfig } from '@/types/classroom'
import type { Seat, SeatView } from '@/types/seat'

/** 视角中文名（页面分段控件 / 导出副标题共用） */
export const VIEW_LABELS: Record<SeatView, string> = {
  teacher: '老师视角',
  student: '学生视角',
}

/** 视角一句话说明（页面提示条用，讲清两个视角到底是什么关系） */
export const VIEW_NOTES: Record<SeatView, string> = {
  teacher: '老师视角：讲台在上、第 1 排最靠近讲台，座位号从左到右递增',
  student: '学生视角：整间教室旋转 180°（前后翻转 + 左右翻转），讲台在下',
}

/** 教室的四面墙（仅左右两面与视角有关：讲台居中，不随视角移动） */
export type RoomSide = 'left' | 'right'

/** 房间显示单元（讲台 / 门签 / 一排座位）：渲染顺序即数组顺序 */
export type RoomItem =
  | { key: string; kind: 'row'; row: number }
  | { key: string; kind: 'podium' }
  | { key: string; kind: 'door-front' }
  | { key: string; kind: 'door-back' }

/** 一排内的显示单元：列块与过道交替（过道不是座位，绝不当普通座位渲染） */
export type RowUnit = { key: string; kind: 'block'; seats: Seat[] } | { key: string; kind: 'aisle' }

/** 坐标镜像（180° 旋转；自逆，可安全用于「取反」）：(1,1) ↔ (7,9)、(4,5) 原地不动 */
export function transformSeatPosition(
  row: number,
  col: number,
  config: ClassroomConfig = DEFAULT_CLASSROOM_CONFIG,
): { row: number; col: number } {
  return { row: config.rows + 1 - row, col: config.cols + 1 - col }
}

/** 物理坐标 → 指定视角下的显示槽位（老师视角 = 物理坐标本身） */
export function viewPositionOf(
  row: number,
  col: number,
  view: SeatView,
  config: ClassroomConfig = DEFAULT_CLASSROOM_CONFIG,
): { row: number; col: number } {
  return view === 'student' ? transformSeatPosition(row, col, config) : { row, col }
}

/** 显示槽位 → 物理坐标（与 viewPositionOf 互为逆运算） */
export function positionAtViewSlot(
  slotRow: number,
  slotCol: number,
  view: SeatView,
  config: ClassroomConfig = DEFAULT_CLASSROOM_CONFIG,
): { row: number; col: number } {
  return view === 'student'
    ? transformSeatPosition(slotRow, slotCol, config)
    : { row: slotRow, col: slotCol }
}

/** 某**显示排**（自上而下 1~rows）对应的物理排号：老师视角 1→1，学生视角 1→7 */
export function viewPhysicalRow(
  slotRow: number,
  view: SeatView,
  config: ClassroomConfig = DEFAULT_CLASSROOM_CONFIG,
): number {
  return view === 'student' ? config.rows + 1 - slotRow : slotRow
}

/** 显示列顺序（物理列号）：老师视角 1→9，学生视角 9→1 */
export function viewColOrder(
  view: SeatView,
  config: ClassroomConfig = DEFAULT_CLASSROOM_CONFIG,
): number[] {
  const cols: number[] = []
  for (let col = 1; col <= config.cols; col++) cols.push(col)
  return view === 'teacher' ? cols : cols.reverse()
}

/** 显示列块顺序（blocks 下标）：老师视角 左→中→右，学生视角 右→中→左 */
export function viewBlockIndexes(
  view: SeatView,
  config: ClassroomConfig = DEFAULT_CLASSROOM_CONFIG,
): number[] {
  const indexes = config.blocks.map((_, index) => index)
  return view === 'teacher' ? indexes : indexes.reverse()
}

/**
 * 房间显示单元顺序（讲台 / 门签 / 排）：
 * - 老师视角：讲台 → 前门 → 第 1 排 … 第 7 排 → 后门；
 * - 学生视角：后门 → 第 7 排 … 第 1 排 → 前门 → 讲台（上一行整体的 180° 旋转）。
 * 单元 key 按**物理排号**稳定（`row-3`），换视角时 TransitionGroup 靠它做 FLIP 平滑换位。
 */
export function viewRoomItems(
  view: SeatView,
  config: ClassroomConfig = DEFAULT_CLASSROOM_CONFIG,
): RoomItem[] {
  const rows: RoomItem[] = []
  for (let row = 1; row <= config.rows; row++) rows.push({ key: `row-${row}`, kind: 'row', row })
  const podium: RoomItem = { key: 'podium', kind: 'podium' }
  const doorFront: RoomItem = { key: 'door-front', kind: 'door-front' }
  const doorBack: RoomItem = { key: 'door-back', kind: 'door-back' }
  if (view === 'teacher') return [podium, doorFront, ...rows, doorBack]
  return [doorBack, ...rows.reverse(), doorFront, podium]
}

/**
 * 某一**显示排**的渲染布局：按视角给出列块与过道的显示顺序，座位按 `seatIdOf(物理排, 物理列)`
 * 从 `seatsById` 即时解析（复用同一批 Seat 引用，不重建数据、不复制对象）。
 */
export function viewRowUnits(
  slotRow: number,
  view: SeatView,
  config: ClassroomConfig,
  seatsById: ReadonlyMap<string, Seat>,
): RowUnit[] {
  const physicalRow = viewPhysicalRow(slotRow, view, config)
  // 显示顺序下的物理列号：老师视角 1→9；学生视角 9→1
  const colOrder = viewColOrder(view, config)
  // 显示顺序下的列块顺序：老师视角 左→中→右；学生视角 右→中→左
  const blockIndexes = viewBlockIndexes(view, config)
  // 列块的宽度也要按显示顺序取：先切显示列序，切出来的第 i 段正对应 blockIndexes[i]。
  // **不能**拿物理列块下标去索引「按显示顺序切好的段」——那是把左右反了两遍，
  // 结果看起来「也说得过去」，实际上每个区的学生都换了组。
  const displayWidths = view === 'teacher' ? [...config.blocks] : [...config.blocks].reverse()

  const groups: number[][] = []
  let offset = 0
  for (const width of displayWidths) {
    groups.push(colOrder.slice(offset, offset + width))
    offset += width
  }

  const units: RowUnit[] = []
  blockIndexes.forEach((blockIndex, position) => {
    const seats: Seat[] = []
    for (const col of groups[position] ?? []) {
      const seat = seatsById.get(seatIdOf(physicalRow, col))
      if (seat) seats.push(seat)
    }
    units.push({ key: `block-${blockIndex}`, kind: 'block', seats })
    // 过道夹在列块之间，且**只在**列块之间（首尾不加）
    if (position < blockIndexes.length - 1) units.push({ key: `aisle-${position}`, kind: 'aisle' })
  })
  return units
}

/** 配置里的方位串（`right-front` / `right-back` / `right`）→ 左右墙 */
function sideFrom(value: string): RoomSide {
  return value.startsWith('right') ? 'right' : 'left'
}

/** 侧向装饰挂哪面墙：老师视角 = 配置原值，学生视角 = 镜像（180° 旋转的必然结果） */
export function mirrorRoomSide(side: RoomSide, view: SeatView): RoomSide {
  if (view === 'teacher') return side
  return side === 'left' ? 'right' : 'left'
}

/** 前门 / 后门在指定视角下挂哪面墙（真实教室：两门同在配置所写的那面墙） */
export function doorSidesOf(
  view: SeatView,
  config: ClassroomConfig = DEFAULT_CLASSROOM_CONFIG,
): { front: RoomSide; back: RoomSide } {
  return {
    front: mirrorRoomSide(sideFrom(config.frontDoor), view),
    back: mirrorRoomSide(sideFrom(config.backDoor), view),
  }
}

/** 窗户在指定视角下挂哪面墙 */
export function windowSideOf(
  view: SeatView,
  config: ClassroomConfig = DEFAULT_CLASSROOM_CONFIG,
): RoomSide {
  return mirrorRoomSide(sideFrom(config.windows), view)
}
