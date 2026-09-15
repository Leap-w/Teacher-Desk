/**
 * 教室视角转换（V1.1.2 Phase 1；**v3.2.0 按参考图定死纵向朝向；v3.3.0 改为「只镜像列」**）
 * ——双视角的**唯一实现**。
 *
 * 物理坐标恒定：`row` 1~7（第 1 排最靠近讲台）、`col` 1~9，与视角无关。
 *
 * **v3.3.0 修正（本次改动的全部内容）**：两个视角之间**只镜像列，不镜像行**：
 *
 *     学生视角坐标 = (row, cols + 1 - col)      ← 行保持不变，列左右翻转
 *
 * v3.2.0 曾把它写成 180° 旋转（行、列同时翻转），那是错的：切一次视角，
 * 老师视角的「第 1 排」会变成学生视角的「第 7 排」，**排号当场就变了**——
 * 教师说「第三排靠窗那个」时，两个视角指的不是同一排。现在第一排永远是第一排。
 *
 *     物理座位          老师视角显示      学生视角显示
 *     Row7 Col1    →    Row7 Col1    →    Row7 Col9
 *     Row7 Col2    →    Row7 Col2    →    Row7 Col8
 *     Row4 Col5    →    Row4 Col5    →    Row4 Col5   （正中列镜像后原地不动）
 *     Row1 Col9    →    Row1 Col9    →    Row1 Col1
 *
 * 该变换是**自逆的**（`mirror(mirror(p)) === p`），所以「物理坐标 → 显示槽位」与
 * 「显示槽位 → 物理坐标」是同一次运算，共用一个函数，不会写岔。
 *
 * **两个视角各自画成什么样子**：
 *
 * - **老师视角**（默认）：讲台画在**页面底部**——教师站在讲台后面看教室，
 *   讲台在近端、第 1 排紧挨讲台、第 7 排最远（页面顶部）。列号 1→9 从左到右，
 *   窗在右墙，两个门在左墙（后门在上、前门在下）。
 * - **学生视角**：讲台画在**页面顶部**——学生坐在座位上朝讲台看。讲台 / 前门 / 后门 /
 *   窗**跟着换到另一侧**（讲台在上、前门右上、后门右下、窗到左墙），列号反过来
 *   9→1 从左到右，**但排号与排的上下位置完全不变**（第 1 排仍在最下一行、第 7 排仍在最上）。
 *
 * **不是把画布 `rotate(180deg)`**：那样文字会倒过来，而且座位号会跟着转。
 * 这里只重排**显示顺序**，每个座位块本身永远正着渲染。
 *
 * **页面（SeatClassroom）与导出图（SeatExportGraphic）必须共用本模块**：视角逻辑写两份，
 * 迟早出现「导出的学生视角与页面学生视角不一致」——那正是 V1.1.2 Phase 1 修的毛病。
 *
 * 数据本身不因切换视角而改变：本模块只产出**显示顺序与显示槽位**，
 * 既不复制 Seat 对象，也不重排方案里的 `seats` 数组。
 */
import { seatIdOf } from '@/utils/seat'
import { DEFAULT_CLASSROOM_CONFIG } from '@/types/classroom'
import type { ClassroomConfig } from '@/types/classroom'
import type { Seat, SeatView } from '@/types/seat'
/** 视角一句话说明（页面提示条用，讲清两个视角到底是什么关系） */
export const VIEW_NOTES: Record<SeatView, string> = {
  teacher: '老师视角：讲台在下、第 1 排最靠近讲台，座位号从左到右递增',
  student: '学生视角：讲台在上、左右镜像，排号与座位数据不变（座位号从右到左递增）',
}

/** 教室的四面墙（仅左右两面与视角有关：讲台居中，不随视角移动） */
export type RoomSide = 'left' | 'right'

/** 房间显示单元（讲台 / 门签 / 列号行 / 一排座位）：渲染顺序即数组顺序 */
export type RoomItem =
  | { key: string; kind: 'row'; row: number }
  | { key: string; kind: 'podium' }
  | { key: string; kind: 'door-front' }
  | { key: string; kind: 'door-back' }
  /** 顶部列号行（v3.2.0）：永远紧跟在教室顶部那一块之后 */
  | { key: string; kind: 'cols' }

/** 一排内的显示单元：列块与过道交替（过道不是座位，绝不当普通座位渲染） */
export type RowUnit = { key: string; kind: 'block'; seats: Seat[] } | { key: string; kind: 'aisle' }

/** 顶部列号行的显示单元（v3.2.0）：与座位行**逐列对齐**，过道位置同样留空 */
export type ColUnit =
  { key: string; kind: 'colblock'; cols: number[] } | { key: string; kind: 'aisle' }

/**
 * 坐标镜像（v3.3.0：**只镜像列，行原样返回**）。
 *
 * 自逆，可安全用于「取反」：Col1 ↔ Col9、Col5 原地不动；**Row 永不改变**。
 */
export function mirrorSeatPosition(
  row: number,
  col: number,
  config: ClassroomConfig = DEFAULT_CLASSROOM_CONFIG,
): { row: number; col: number } {
  return { row, col: config.cols + 1 - col }
}

/** 物理坐标 → 指定视角下的显示槽位（老师视角 = 物理坐标本身） */
export function viewPositionOf(
  row: number,
  col: number,
  view: SeatView,
  config: ClassroomConfig = DEFAULT_CLASSROOM_CONFIG,
): { row: number; col: number } {
  return view === 'student' ? mirrorSeatPosition(row, col, config) : { row, col }
}

/** 显示槽位 → 物理坐标（与 viewPositionOf 互为逆运算） */
export function positionAtViewSlot(
  slotRow: number,
  slotCol: number,
  view: SeatView,
  config: ClassroomConfig = DEFAULT_CLASSROOM_CONFIG,
): { row: number; col: number } {
  return view === 'student'
    ? mirrorSeatPosition(slotRow, slotCol, config)
    : { row: slotRow, col: slotCol }
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
 * - 老师视角：后门 → 第 7 排 … 第 1 排 → 前门 → 讲台（讲台在下、第 1 排紧挨讲台）；
 * - 学生视角：讲台 → 前门 → 第 7 排 … 第 1 排 → 后门。
 *
 * **v3.3.0**：两个视角的**排序列完全一致**（都是第 7 排在上、第 1 排在下）——
 * 只有讲台 / 前后门换到另一端。v3.2.0 曾把排序列也倒过来，那会让「第 1 排」在切换视角后
 * 跑到最上一行，教师与学生说的「第几排」当场对不上。
 *
 * 单元 key 按**物理排号**稳定（`row-3`），换视角时 TransitionGroup 靠它做 FLIP 平滑换位；
 * 排序列既然不变，FLIP 实际只在讲台 / 两个门签之间发生。
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
  const cols: RoomItem = { key: 'cols', kind: 'cols' }
  // 列号行贴着教室顶部那一条（老师视角 = 后门；学生视角 = 讲台 + 前门）
  if (view === 'teacher') return [doorBack, cols, ...rows.reverse(), doorFront, podium]
  return [podium, doorFront, cols, ...rows.reverse(), doorBack]
}

/**
 * 显示顺序下的列块切分（**viewRowUnits 与 viewColUnits 的唯一来源**）。
 *
 * 列块宽度必须按**显示顺序**取：先切显示列序，切出来的第 i 段正对应 `blockIndexes[i]`。
 * **不能**拿物理列块下标去索引「按显示顺序切好的段」——那是把左右反了两遍，
 * 结果看起来「也说得过去」，实际上每个区的学生都换了组。
 *
 * v3.3.0 后仍然需要它：行不镜像了，**列照旧镜像**，所以列块顺序与宽度都还得反过来。
 */
function displayColumnGroups(
  view: SeatView,
  config: ClassroomConfig,
): { blockIndexes: number[]; groups: number[][] } {
  const colOrder = viewColOrder(view, config)
  const blockIndexes = viewBlockIndexes(view, config)
  const displayWidths = view === 'teacher' ? [...config.blocks] : [...config.blocks].reverse()

  const groups: number[][] = []
  let offset = 0
  for (const width of displayWidths) {
    groups.push(colOrder.slice(offset, offset + width))
    offset += width
  }
  return { blockIndexes, groups }
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
  // v3.3.0：显示排号**就是**物理排号（行不参与镜像），两个视角取同一排的座位。
  // 这里刻意不抽成 `viewPhysicalRow(row, view)` 之类的函数——那个函数在新规则下恒等，
  // 留着只会让后来人以为「行还可能被换掉」。
  const physicalRow = slotRow
  const { blockIndexes, groups } = displayColumnGroups(view, config)

  const units: RowUnit[] = []
  groups.forEach((cols, position) => {
    const seats: Seat[] = []
    for (const col of cols) {
      const seat = seatsById.get(seatIdOf(physicalRow, col))
      if (seat) seats.push(seat)
    }
    units.push({ key: `block-${blockIndexes[position]}`, kind: 'block', seats })
    // 过道夹在列块之间，且**只在**列块之间（首尾不加）
    if (position < groups.length - 1) units.push({ key: `aisle-${position}`, kind: 'aisle' })
  })
  return units
}

/**
 * 顶部**列号行**的渲染布局（v3.2.0）：老师视角 `1 2 3 | 4 5 6 | 7 8 9`、
 * 学生视角 `9 8 7 | 6 5 4 | 3 2 1`，过道位置与座位行逐列对齐。
 *
 * 与 `viewRowUnits` 共用同一次列块切分，因此列号**永远**压在它所标的座位正上方——
 * 两处各切一遍迟早错位（差一格就是「3 号下面坐着 4 号」这种最伤信任的 bug）。
 */
export function viewColUnits(
  view: SeatView,
  config: ClassroomConfig = DEFAULT_CLASSROOM_CONFIG,
): ColUnit[] {
  const { blockIndexes, groups } = displayColumnGroups(view, config)

  const units: ColUnit[] = []
  groups.forEach((cols, position) => {
    units.push({ key: `colblock-${blockIndexes[position]}`, kind: 'colblock', cols })
    if (position < groups.length - 1) units.push({ key: `col-aisle-${position}`, kind: 'aisle' })
  })
  return units
}

/** 配置里的方位串（`right-front` / `right-back` / `right`）→ 左右墙 */
function sideFrom(value: string): RoomSide {
  return value.startsWith('right') ? 'right' : 'left'
}

/**
 * 侧向装饰挂哪面墙：老师视角 = 配置原值，学生视角 = 换到另一面墙。
 *
 * v3.3.0 后行不镜像了，但**墙面照旧左右对调**——学生转过身来面对讲台，
 * 左手边变成原本的右手边，本来就该换。这与「排号不变」并不矛盾：
 * 换的是教室的朝向，不是座位表本身。
 */
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
