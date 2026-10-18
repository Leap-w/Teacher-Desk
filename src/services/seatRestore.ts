/**
 * 座位图导出文件 → 整表恢复（v3.7.6）。
 *
 * ## 两条导入路径，一条现有入口
 *
 * 现有的行列列表导入（`services/seatImport.ts`）是**逐条应用**：只动表格里列出的
 * 座位，表没提到的座位保持原样。导出文件不同——它描述的是**一整张座位表**，
 * 包括哪些座位空着；恢复时必须整表替换，否则「导出时是空座、现在有人」的座位
 * 会悄悄留下来，恢复结果与导出文件对不上。
 *
 * 所以本文件单独规划「整表恢复」，但入口仍是座位页现有的「导入」弹窗：
 *   ① 隐藏数据表存在 → 优先读结构化数据（版本 / 布局 / 63 个座位 / 约束）；
 *   ② 没有隐藏表、但有两张可视化工作表 → 按版面识别（兼容 v3.7.5 及更早导出的文件）；
 *   ③ 两者都不是 → 交回行列列表导入，旧文件行为不变。
 *
 * ## 隐藏数据不是「唯一且不可校验的信任来源」
 *
 * 导入端不会照单全收隐藏表，至少做四道校验：
 *   - **版本与格式**：格式标识 / 数据版本不认识就明确报错，不猜着读；
 *   - **布局**：排数 / 列数 / 列块 / 固定空位 / 座位数必须与当前教室一致；
 *   - **身份**：每个座位都回到**当前学生名单**里重新匹配（学号优先，重名必须能唯一消歧），
 *     不信任导出文件里的学生 id；
 *   - **版面交叉校验**：隐藏表里每个座位的「显示名」必须与 `学生视角` / `老师视角`
 *     对应格子逐格一致；对不上就整份拦下，提示文件可能被修改过。
 *
 * 旧版文件按版面识别时，显示名里的重名消歧后缀（如「张伟（3287）」）参与唯一匹配；
 * 没有后缀的重名仍然拦下——**不凭姓名猜身份**。
 *
 * 本文件前半段是纯解析 / 规划（不碰 xlsx、不碰 DOM、不碰 store），可在 node 自检里
 * 直接喂数组跑；落库只经 `seatStore.applySeatRestore()`。
 */
import { cellText, normalizeHeader } from '@/services/sheetCell'
import { buildStudentIndex } from '@/services/seatImport'
import type { SeatImportAssignment, SeatImportChange } from '@/services/seatImport'
import type { ReadWorkbookResult } from '@/services/studentImport'
import {
  createEmptySeatPlanConstraints,
  isFixedEmptySeat,
  isValidSeatPosition,
  normalizeSeatPlanConstraints,
  seatPositionShort,
} from '@/utils/seat'
import {
  parseBlocksText,
  SEAT_DATA_CONSTRAINT_KINDS,
  SEAT_EXPORT_FORMAT,
  SEAT_EXPORT_SHEET,
  SEAT_EXPORT_VERSION,
  SEAT_VISUAL_SHEETS,
} from '@/utils/seatExportFormat'
import { buildNameCounts, formatStudentShortName } from '@/utils/student'
import { createId } from '@/utils/id'
import { DEFAULT_CLASSROOM_CONFIG } from '@/types/classroom'
import type { ClassroomConfig } from '@/types/classroom'
import type { SeatPlanConstraints } from '@/types/seat'
import type { Student } from '@/types'

/* ==================== 解析结果的数据形状 ==================== */

/** 导出文件记录的教室布局（隐藏数据表里的布局元数据） */
export interface SeatRestoreLayout {
  rows: number
  cols: number
  blocks: number[]
  totalSeats: number
  occupiedSeats: number
  fixedEmptySeat: { row: number; col: number }
}

/** 隐藏数据表 / 可视化版面里的一个座位 */
export interface SeatRestoreSeatInput {
  /** Excel 里的实际行号（预览里「第几行」按它显示） */
  rowNumber: number
  row: number
  col: number
  studentNo: string
  name: string
  /** 导出时的显示名（重名时含身份证尾号）——用于与可视化座位图逐格核对 */
  displayName: string
  /** 该格是否安排了学生 */
  occupied: boolean
}

/** 约束里的学生引用：只认学号与姓名，不认本机学生 id */
export interface RawSeatRestoreStudentRef {
  studentNo: string
  name: string
}

export interface RawSeatRestoreConstraints {
  sameDeskForbidden: Array<[RawSeatRestoreStudentRef, RawSeatRestoreStudentRef]>
  adjacentGroupForbidden: Array<
    [RawSeatRestoreStudentRef, RawSeatRestoreStudentRef, RawSeatRestoreStudentRef]
  >
  frontRowStudents: RawSeatRestoreStudentRef[]
  backRowStudents: RawSeatRestoreStudentRef[]
}

/** 一份已识别为「座位图导出文件」的解析结果 */
export interface ParsedSeatRestore {
  source: 'metadata' | 'visual'
  sourceSheet: string
  formatVersion?: number
  appVersion?: string
  exportedAt?: string
  planName?: string
  planCreatedAt?: string
  planUpdatedAt?: string
  layout: SeatRestoreLayout
  seats: SeatRestoreSeatInput[]
  /** 可视化版面文件（旧版导出）没有约束数据 → undefined = 保持当前约束不变 */
  constraints?: RawSeatRestoreConstraints
  /** 是否真的与可视化工作表做过逐格核对 */
  visualChecked: boolean
  warnings: string[]
}

/* ==================== 隐藏数据表解析 ==================== */

/** 严格整数：只接受 `7` / `第 7 排` 这类写法里的数字，不把 `7.5` 读成 7 */
function parseIndex(value: unknown): number | undefined {
  const text = cellText(value).replace(/^第/, '')
  if (!/^\d+$/.test(text)) return undefined
  const parsed = Number.parseInt(text, 10)
  return Number.isInteger(parsed) ? parsed : undefined
}

function isBlankRow(row: unknown[] | undefined): boolean {
  if (!row) return true
  return row.every((cell) => cellText(cell) === '')
}

/** 表头行 → 列名 → 下标（`normalizeHeader` 与其它导入同一口径） */
function headerMap(row: unknown[]): Map<string, number> {
  const map = new Map<string, number>()
  row.forEach((cell, index) => {
    const text = normalizeHeader(cell)
    if (text && !map.has(text)) map.set(text, index)
  })
  return map
}

function findSeatHeader(rows: readonly unknown[][]): number {
  return rows.findIndex((row) => {
    if (!Array.isArray(row)) return false
    const map = headerMap(row)
    return map.has('排') && map.has('列') && map.has('学号') && map.has('姓名')
  })
}

function findConstraintHeader(rows: readonly unknown[][], from: number): number {
  for (let index = from; index < rows.length; index += 1) {
    const row = rows[index]
    if (Array.isArray(row) && normalizeHeader(row[0]) === '约束类型') return index
  }
  return -1
}

function layoutErrorOf(layout: SeatRestoreLayout, config: ClassroomConfig): string | undefined {
  const describe = (value: {
    rows: number
    cols: number
    blocks: readonly number[]
    fixedEmptySeat: { row: number; col: number }
  }) =>
    `${value.rows} 排 × ${value.cols} 列（${value.blocks.join('-')}），固定空位第 ${value.fixedEmptySeat.row} 排第 ${value.fixedEmptySeat.col} 列`

  const problems: string[] = []
  if (layout.rows !== config.rows || layout.cols !== config.cols) problems.push('行列数')
  if (layout.blocks.length !== config.blocks.length) {
    problems.push('列块')
  } else if (layout.blocks.some((block, index) => block !== config.blocks[index])) {
    problems.push('列块')
  }
  if (
    layout.fixedEmptySeat.row !== config.fixedEmptySeat.row ||
    layout.fixedEmptySeat.col !== config.fixedEmptySeat.col
  ) {
    problems.push('固定空位')
  }
  if (layout.totalSeats !== config.totalSeats) problems.push('座位总数')
  if (layout.occupiedSeats !== config.occupiedSeats) problems.push('可坐座位数')
  if (problems.length === 0) return undefined

  return `这份座位图按 ${describe(layout)} 导出，与当前教室（${describe(config)}）的${problems.join('、')}不一致，无法恢复。`
}

/**
 * 隐藏数据表 → 解析结果。
 *
 * 所有「缺字段 / 版本不认识 / 行数不完整 / 坐标非法 / 重复座位 / 固定空位有人」
 * 都在这一层变成**可照做的错误文案**，不进入预览、不写任何数据。
 */
export function parseSeatDataSheet(
  rows: readonly unknown[][],
): { ok: true; parsed: ParsedSeatRestore } | { ok: false; error: string } {
  const seatHeader = findSeatHeader(rows)
  if (seatHeader < 0) {
    return {
      ok: false,
      error: `隐藏工作表「${SEAT_EXPORT_SHEET}」里没有座位区表头（应有「排 / 列 / 学号 / 姓名」），文件可能已损坏。`,
    }
  }
  const seatColumns = headerMap(rows[seatHeader]!)
  for (const required of ['排', '列', '学号', '姓名', '显示名']) {
    if (!seatColumns.has(required)) {
      return {
        ok: false,
        error: `隐藏工作表「${SEAT_EXPORT_SHEET}」缺少「${required}」列，文件可能已损坏。`,
      }
    }
  }

  /** 表头之前的键值区：A 列键、B 列值 */
  const meta = new Map<string, string>()
  for (let index = 0; index < seatHeader; index += 1) {
    const row = rows[index]
    if (!Array.isArray(row)) continue
    const key = normalizeHeader(row[0])
    if (!key) continue
    meta.set(key, cellText(row[1]))
  }

  if (meta.get('格式') !== SEAT_EXPORT_FORMAT) {
    return {
      ok: false,
      error: `隐藏工作表「${SEAT_EXPORT_SHEET}」的格式标识不是 TeacherDesk 座位数据，无法按结构化数据导入。`,
    }
  }

  const versionText = meta.get('数据版本') ?? ''
  if (!/^\d+$/.test(versionText)) {
    return { ok: false, error: `座位数据版本「${versionText || '空'}」无法识别，文件可能已损坏。` }
  }
  const formatVersion = Number.parseInt(versionText, 10)
  if (formatVersion > SEAT_EXPORT_VERSION) {
    return {
      ok: false,
      error: `这份座位图的数据版本是 ${formatVersion}，当前版本只支持 ${SEAT_EXPORT_VERSION}，请升级 TeacherDesk 后再导入。`,
    }
  }
  if (formatVersion !== SEAT_EXPORT_VERSION) {
    return {
      ok: false,
      error: `这份座位图的数据版本 ${formatVersion} 已不再支持（当前支持 ${SEAT_EXPORT_VERSION}），请用当前版本重新导出。`,
    }
  }

  const requiredLayoutKeys = [
    '排数',
    '列数',
    '列块',
    '固定空位排',
    '固定空位列',
    '座位总数',
    '可坐座位数',
  ]
  const missingLayout = requiredLayoutKeys.filter((key) => !meta.has(key))
  if (missingLayout.length > 0) {
    return {
      ok: false,
      error: `座位数据缺少布局信息：${missingLayout.join('、')}。文件可能已损坏。`,
    }
  }

  const rowsCount = parseIndex(meta.get('排数'))
  const colsCount = parseIndex(meta.get('列数'))
  const fixedRow = parseIndex(meta.get('固定空位排'))
  const fixedCol = parseIndex(meta.get('固定空位列'))
  const totalSeats = parseIndex(meta.get('座位总数'))
  const occupiedSeats = parseIndex(meta.get('可坐座位数'))
  const blocks = parseBlocksText(meta.get('列块') ?? '')

  if (
    rowsCount === undefined ||
    colsCount === undefined ||
    fixedRow === undefined ||
    fixedCol === undefined ||
    totalSeats === undefined ||
    occupiedSeats === undefined ||
    !blocks ||
    blocks.length === 0
  ) {
    return { ok: false, error: '座位数据里的布局信息不是有效的整数，文件可能已损坏。' }
  }
  if (blocks.reduce((sum, block) => sum + block, 0) !== colsCount) {
    return { ok: false, error: '座位数据里的「列块」与列数对不上，文件可能已损坏。' }
  }
  if (
    fixedRow < 1 ||
    fixedRow > rowsCount ||
    fixedCol < 1 ||
    fixedCol > colsCount ||
    totalSeats !== rowsCount * colsCount ||
    occupiedSeats < 0 ||
    occupiedSeats > totalSeats
  ) {
    return { ok: false, error: '座位数据里的布局数值自相矛盾，文件可能已损坏。' }
  }

  const layout: SeatRestoreLayout = {
    rows: rowsCount,
    cols: colsCount,
    blocks,
    totalSeats,
    occupiedSeats,
    fixedEmptySeat: { row: fixedRow, col: fixedCol },
  }

  const seatRows: SeatRestoreSeatInput[] = []
  const seenSeats = new Map<string, number>()
  let occupiedCount = 0

  for (let index = seatHeader + 1; index < rows.length; index += 1) {
    const rawRow = rows[index]
    if (isBlankRow(rawRow)) break
    if (!Array.isArray(rawRow)) {
      return { ok: false, error: `座位数据第 ${index + 1} 行是空的，文件可能已损坏。` }
    }
    const row = rawRow
    const rowNumber = index + 1
    const seatRow = parseIndex(row[seatColumns.get('排')!])
    const seatCol = parseIndex(row[seatColumns.get('列')!])
    if (seatRow === undefined || seatCol === undefined) {
      return { ok: false, error: `座位数据第 ${rowNumber} 行的排 / 列不是有效数字。` }
    }
    if (seatRow < 1 || seatRow > rowsCount || seatCol < 1 || seatCol > colsCount) {
      return {
        ok: false,
        error: `座位数据第 ${rowNumber} 行的位置（第 ${seatRow} 排第 ${seatCol} 列）超出布局范围。`,
      }
    }
    const key = `${seatRow}-${seatCol}`
    const firstRow = seenSeats.get(key)
    if (firstRow !== undefined) {
      return {
        ok: false,
        error: `座位数据第 ${rowNumber} 行与第 ${firstRow} 行重复记录了第 ${seatRow} 排第 ${seatCol} 列。`,
      }
    }
    seenSeats.set(key, rowNumber)

    const studentNo = cellText(row[seatColumns.get('学号')!])
    const name = cellText(row[seatColumns.get('姓名')!])
    const displayName = cellText(row[seatColumns.get('显示名')!])
    const occupied = Boolean(studentNo || name || displayName)

    if (occupied && !studentNo && !name) {
      return {
        ok: false,
        error: `座位数据第 ${rowNumber} 行只有显示名、没有学号与姓名，无法核对身份。`,
      }
    }
    if (occupied && !displayName) {
      return {
        ok: false,
        error: `座位数据第 ${rowNumber} 行缺少显示名，无法与可视化座位图核对。`,
      }
    }
    if (occupied) occupiedCount += 1

    seatRows.push({
      rowNumber,
      row: seatRow,
      col: seatCol,
      studentNo,
      name,
      displayName,
      occupied,
    })
  }

  if (seatRows.length !== totalSeats) {
    return {
      ok: false,
      error: `座位数据有 ${seatRows.length} 行，按布局应为 ${totalSeats} 行（含空座），文件可能已损坏。`,
    }
  }
  for (let row = 1; row <= rowsCount; row += 1) {
    for (let col = 1; col <= colsCount; col += 1) {
      if (!seenSeats.has(`${row}-${col}`)) {
        return {
          ok: false,
          error: `座位数据缺少第 ${row} 排第 ${col} 列，文件可能已损坏。`,
        }
      }
    }
  }

  const declaredOccupied = meta.get('已就座数')
  if (declaredOccupied !== undefined && declaredOccupied !== '') {
    const declared = parseIndex(declaredOccupied)
    if (declared === undefined || declared !== occupiedCount) {
      return { ok: false, error: '座位数据里的「已就座数」与实际座位不一致，文件可能已损坏。' }
    }
  }

  const constraintHeader = findConstraintHeader(rows, seatHeader + 1)
  if (constraintHeader < 0) {
    return {
      ok: false,
      error: `隐藏工作表「${SEAT_EXPORT_SHEET}」缺少座位约束区表头，文件可能已损坏。`,
    }
  }
  const constraintColumns = headerMap(rows[constraintHeader]!)
  const constraintParse = parseConstraintRows(rows, constraintHeader, constraintColumns)
  if (!constraintParse.ok) {
    return { ok: false, error: constraintParse.error }
  }

  return {
    ok: true,
    parsed: {
      source: 'metadata',
      sourceSheet: SEAT_EXPORT_SHEET,
      formatVersion,
      appVersion: meta.get('应用版本') || undefined,
      exportedAt: meta.get('导出时间') || undefined,
      planName: meta.get('方案名称') || undefined,
      planCreatedAt: meta.get('方案创建时间') || undefined,
      planUpdatedAt: meta.get('方案更新时间') || undefined,
      layout,
      seats: seatRows,
      constraints: constraintParse.constraints,
      visualChecked: false,
      warnings: [],
    },
  }
}

/** 约束区逐行解析：类型已知、引用人数正确、每名学生至少有学号或姓名 */
function parseConstraintRows(
  rows: readonly unknown[][],
  headerIndex: number,
  columns: Map<string, number>,
): { ok: true; constraints: RawSeatRestoreConstraints } | { ok: false; error: string } {
  const constraints: RawSeatRestoreConstraints = {
    sameDeskForbidden: [],
    adjacentGroupForbidden: [],
    frontRowStudents: [],
    backRowStudents: [],
  }

  const readRef = (row: unknown[], slot: number): RawSeatRestoreStudentRef => ({
    studentNo: cellText(row[columns.get(`学生${slot}学号`) ?? -1]),
    name: cellText(row[columns.get(`学生${slot}姓名`) ?? -1]),
  })

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index]
    if (isBlankRow(row)) continue
    if (!Array.isArray(row)) {
      return { ok: false, error: `座位约束第 ${index + 1} 行是空的，文件可能已损坏。` }
    }
    const rowNumber = index + 1
    const kind = normalizeHeader(row[0])
    if (!kind) continue

    const refs = [1, 2, 3]
      .map((slot) => readRef(row, slot))
      .filter((ref) => ref.studentNo || ref.name)

    if (kind === SEAT_DATA_CONSTRAINT_KINDS.sameDesk) {
      if (refs.length !== 2) {
        return { ok: false, error: `座位约束第 ${rowNumber} 行「不能同桌」必须恰好两名学生。` }
      }
      constraints.sameDeskForbidden.push([refs[0]!, refs[1]!])
    } else if (kind === SEAT_DATA_CONSTRAINT_KINDS.adjacent) {
      if (refs.length !== 3) {
        return { ok: false, error: `座位约束第 ${rowNumber} 行「三人不能相邻」必须恰好三名学生。` }
      }
      constraints.adjacentGroupForbidden.push([refs[0]!, refs[1]!, refs[2]!])
    } else if (kind === SEAT_DATA_CONSTRAINT_KINDS.front) {
      if (refs.length !== 1) {
        return { ok: false, error: `座位约束第 ${rowNumber} 行「前排学生」必须恰好一名学生。` }
      }
      constraints.frontRowStudents.push(refs[0]!)
    } else if (kind === SEAT_DATA_CONSTRAINT_KINDS.back) {
      if (refs.length !== 1) {
        return { ok: false, error: `座位约束第 ${rowNumber} 行「后排学生」必须恰好一名学生。` }
      }
      constraints.backRowStudents.push(refs[0]!)
    } else {
      return { ok: false, error: `座位约束第 ${rowNumber} 行的类型「${kind}」无法识别。` }
    }
  }

  return { ok: true, constraints }
}

/* ==================== 可视化版面解析（旧版导出兼容） ==================== */

interface VisualSeatCell {
  text: string
  /** Excel 行号（1 起） */
  rowNumber: number
}

/**
 * 从一张可视化工作表推出「物理座位 → 格子文本」。
 *
 * 与 `utils/seatTemplateXlsx.ts` 的 `deriveSeatCells` 同一套几何口径：
 * 第 5 行是列号（数值 1~9），A6:A12 是排号（数值 1~7）。
 * **这里不复制地址表**——两张视图互为镜像，地址写死一张，另一张就错。
 *
 * 读不全 7 排 × 9 列时返回 undefined：这张表不是我们认得的座位图，交给调用方报错。
 */
export function deriveVisualSeatMap(
  rows: readonly unknown[][],
): Map<string, VisualSeatCell> | undefined {
  if (rows.length < 12) return undefined

  const columnOf = new Map<number, number>()
  const headerRow = rows[4]
  if (!Array.isArray(headerRow)) return undefined
  for (let col = 1; col <= 12; col += 1) {
    const seat = parseIndex(headerRow[col])
    if (seat === undefined || seat < 1 || seat > 9) continue
    if (columnOf.has(seat)) return undefined
    columnOf.set(seat, col)
  }

  const rowOf = new Map<number, number>()
  for (let row = 5; row <= 11; row += 1) {
    const label = rows[row]
    if (!Array.isArray(label)) return undefined
    const seatRow = parseIndex(label[0])
    if (seatRow === undefined || seatRow < 1 || seatRow > 7) continue
    if (rowOf.has(seatRow)) return undefined
    rowOf.set(seatRow, row)
  }

  if (columnOf.size !== 9 || rowOf.size !== 7) return undefined

  const cells = new Map<string, VisualSeatCell>()
  for (const [row, rowIndex] of rowOf) {
    for (const [col, colIndex] of columnOf) {
      cells.set(`${row}-${col}`, {
        text: cellText(rows[rowIndex]![colIndex]),
        rowNumber: rowIndex + 1,
      })
    }
  }
  return cells
}

/** 可视化工作表 → 解析结果；版面认不出时返回 undefined */
export function parseVisualSeatSheet(
  rows: readonly unknown[][],
  sheetName: string,
  config: ClassroomConfig = DEFAULT_CLASSROOM_CONFIG,
): ParsedSeatRestore | undefined {
  const cells = deriveVisualSeatMap(rows)
  if (!cells) return undefined

  const seats: SeatRestoreSeatInput[] = []
  for (let row = 1; row <= config.rows; row += 1) {
    for (let col = 1; col <= config.cols; col += 1) {
      const cell = cells.get(`${row}-${col}`)
      const text = cell?.text ?? ''
      seats.push({
        rowNumber: cell?.rowNumber ?? row + 5,
        row,
        col,
        studentNo: '',
        name: '',
        displayName: text,
        occupied: Boolean(text),
      })
    }
  }

  return {
    source: 'visual',
    sourceSheet: sheetName,
    layout: {
      rows: config.rows,
      cols: config.cols,
      blocks: [...config.blocks],
      totalSeats: config.totalSeats,
      occupiedSeats: config.occupiedSeats,
      fixedEmptySeat: { ...config.fixedEmptySeat },
    },
    seats,
    constraints: undefined,
    visualChecked: true,
    warnings: [],
  }
}

/* ==================== 工作簿识别 ==================== */

export type SeatRestoreDetection =
  | { kind: 'none' }
  | { kind: 'error'; error: string }
  | { kind: 'restore'; parsed: ParsedSeatRestore }

/**
 * 隐藏数据表与可视化工作表逐格核对。
 *
 * 只核对两边都存在的座位；任何一格「数据表有 / 座位图空」或反过来都算不一致。
 * 这是「隐藏数据不能是唯一信任来源」的落地：教师如果手改了可视化座位图
 * （或文件在传输中损坏），导入端不会闭眼按隐藏表恢复。
 */
function crossCheckVisual(
  workbook: ReadWorkbookResult,
  parsed: ParsedSeatRestore,
): { error?: string; checked: boolean; warnings: string[] } {
  const warnings: string[] = []
  let checked = false

  for (const sheetName of SEAT_VISUAL_SHEETS) {
    if (!workbook.sheetNames.includes(sheetName)) continue
    const rows = workbook.sheets.get(sheetName) ?? []
    const cells = deriveVisualSeatMap(rows)
    if (!cells) {
      warnings.push(`工作表「${sheetName}」的座位版面无法识别，未参与交叉校验。`)
      continue
    }
    checked = true

    for (const seat of parsed.seats) {
      const cell = cells.get(`${seat.row}-${seat.col}`)
      if (!cell) {
        return {
          error: `工作表「${sheetName}」缺少第 ${seat.row} 排第 ${seat.col} 列，无法与结构化数据核对。`,
          checked,
          warnings,
        }
      }
      const expected = seat.occupied ? seat.displayName : ''
      if (cell.text !== expected) {
        return {
          error: `结构化数据与可视化座位图「${sheetName}」不一致（第 ${seat.row} 排第 ${seat.col} 列：数据为「${expected || '空'}」，座位图为「${cell.text || '空'}」）。文件可能被修改过，请重新导出。`,
          checked,
          warnings,
        }
      }
    }
  }

  if (!checked) warnings.push('没有可核对的可视化座位图工作表，已仅按结构化数据恢复。')
  return { checked, warnings }
}

/**
 * 判断一份工作簿属于哪种导入：
 *   - 有隐藏数据表 → 结构化恢复（格式 / 版本 / 版面交叉校验不通过则报错）；
 *   - 有可视化座位图 → 旧版导出的版面识别；
 *   - 都没有 → `none`，弹窗继续走行列列表导入。
 */
export function detectSeatRestoreWorkbook(
  workbook: ReadWorkbookResult,
  config: ClassroomConfig = DEFAULT_CLASSROOM_CONFIG,
): SeatRestoreDetection {
  if (workbook.sheetNames.includes(SEAT_EXPORT_SHEET)) {
    const parsed = parseSeatDataSheet(workbook.sheets.get(SEAT_EXPORT_SHEET) ?? [])
    if (!parsed.ok) return { kind: 'error', error: parsed.error }

    const layoutError = layoutErrorOf(parsed.parsed.layout, config)
    if (layoutError) return { kind: 'error', error: layoutError }

    const checked = crossCheckVisual(workbook, parsed.parsed)
    if (checked.error) return { kind: 'error', error: checked.error }
    parsed.parsed.visualChecked = checked.checked
    parsed.parsed.warnings.push(...checked.warnings)
    return { kind: 'restore', parsed: parsed.parsed }
  }

  const hasVisualSheet = SEAT_VISUAL_SHEETS.some((name) => workbook.sheetNames.includes(name))
  if (!hasVisualSheet) return { kind: 'none' }

  for (const sheetName of SEAT_VISUAL_SHEETS) {
    if (!workbook.sheetNames.includes(sheetName)) continue
    const parsed = parseVisualSeatSheet(workbook.sheets.get(sheetName) ?? [], sheetName, config)
    if (parsed) return { kind: 'restore', parsed }
  }

  return {
    kind: 'error',
    error:
      '看起来是座位图导出文件，但「学生视角 / 老师视角」的版面无法识别，文件可能已损坏或不是这个模板导出的。',
  }
}

/* ==================== 整表恢复规划（纯函数） ==================== */

export interface SeatRestorePreviewRow {
  rowNumber: number
  row: number
  col: number
  seatLabel: string
  studentNo: string
  /** 学生名（匹配成功后优先用当前名单里的姓名） */
  name: string
  studentLabel?: string
  studentId?: string
  action: 'restore' | 'blocked'
  change?: SeatImportChange
  errors: string[]
  warnings: string[]
}

export interface SeatRestorePlan {
  ok: boolean
  source: 'metadata' | 'visual'
  sourceSheet: string
  planName?: string
  appVersion?: string
  exportedAt?: string
  layout: SeatRestoreLayout
  layoutLabel: string
  totalSeats: number
  occupiedSeats: number
  emptySeats: number
  assignable: number
  changed: number
  unchanged: number
  /** 当前方案里会因这次整表恢复而腾空的座位数（含换座学生让出的原座位） */
  clearedSeats: number
  blocked: number
  errorCount: number
  rows: SeatRestorePreviewRow[]
  assignments: SeatImportAssignment[]
  /** 有值 = 恢复这份导出里的约束（空对象 = 清空约束）；undefined = 保持当前约束不变 */
  constraints?: SeatPlanConstraints
  errors: string[]
  warnings: string[]
}

/** 学生索引：现有学号 / 姓名索引 + 显示名索引（重名消歧用） */
interface RestoreIndex {
  byStudentNo: Map<string, Student>
  byName: Map<string, Student[]>
  byDisplay: Map<string, Student[]>
}

function buildRestoreIndex(students: readonly Student[]): RestoreIndex {
  const active = students.filter((student) => !student.deletedAt)
  const base = buildStudentIndex(active)
  const nameCounts = buildNameCounts(active)
  const byDisplay = new Map<string, Student[]>()
  for (const student of active) {
    const display = formatStudentShortName(student, nameCounts)
    const list = byDisplay.get(display) ?? []
    list.push(student)
    byDisplay.set(display, list)
  }
  return { byStudentNo: base.byStudentNo, byName: base.byName, byDisplay }
}

/** 显示名唯一命中；`ambiguous` 表示同名同后缀（无法确认） */
function resolveByDisplay(
  index: RestoreIndex,
  displayName: string,
): { student?: Student; ambiguous?: boolean } {
  const text = displayName.trim()
  if (!text) return {}

  const exact = index.byDisplay.get(text) ?? []
  if (exact.length === 1) return { student: exact[0] }
  if (exact.length > 1) return { ambiguous: true }

  /*
   * 当前名册的重名人数可能已经变了（导出时两个「张伟」，导入时只剩一个），
   * 此时按导出显示名里的「姓名（身份证尾号）」再找一次。尾号是教师自己填的
   * 身份字段，不是猜姓名——找不到或仍有多人时一律拦下。
   */
  const match = /^(.+?)（(.+?)）$/.exec(text)
  if (!match) return {}
  const baseName = match[1]!
  const suffix = match[2]!
  const candidates = (index.byName.get(baseName) ?? []).filter(
    (student) => (student.idCardSuffix ?? '').trim() === suffix,
  )
  if (candidates.length === 1) return { student: candidates[0] }
  if (candidates.length > 1) return { ambiguous: true }
  return {}
}

interface StudentResolution {
  student?: Student
  warning?: string
  error?: string
}

/** 座位上的学生 → 当前名单里的学生（学号优先；重名必须能唯一消歧） */
function resolveSeatStudent(seat: SeatRestoreSeatInput, index: RestoreIndex): StudentResolution {
  if (seat.studentNo) {
    const candidate = index.byStudentNo.get(seat.studentNo)
    if (!candidate) return { error: `学号 ${seat.studentNo} 不在学生名单中` }
    if (seat.name && seat.name !== candidate.name) {
      return { error: `姓名与学号不匹配：学号 ${seat.studentNo} 是「${candidate.name}」` }
    }
    return { student: candidate }
  }

  if (seat.name) {
    const candidates = index.byName.get(seat.name) ?? []
    if (candidates.length === 1) {
      return { student: candidates[0]!, warning: '未填学号，本次按姓名匹配' }
    }
    if (candidates.length > 1) {
      const byDisplay = resolveByDisplay(index, seat.displayName)
      if (byDisplay.student) {
        return { student: byDisplay.student, warning: '按导出时的重名消歧标识匹配' }
      }
      return { error: '存在重名学生，请使用学号确认。' }
    }
  }

  const byDisplay = resolveByDisplay(index, seat.displayName)
  if (byDisplay.student) {
    return { student: byDisplay.student, warning: '按导出时的显示名匹配' }
  }
  if (byDisplay.ambiguous) return { error: '存在重名学生，请使用学号确认。' }
  return {
    error: seat.displayName
      ? `学生名单中找不到「${seat.displayName}」`
      : '未填写学号与姓名，无法确定学生',
  }
}

/** 约束引用 → 当前学生 id（学号优先；重名且没学号 → 拦下） */
function resolveConstraintStudent(
  ref: RawSeatRestoreStudentRef,
  index: RestoreIndex,
): { studentId?: string; error?: string } {
  if (ref.studentNo) {
    const candidate = index.byStudentNo.get(ref.studentNo)
    if (!candidate) return { error: `学号 ${ref.studentNo} 不在学生名单中` }
    if (ref.name && ref.name !== candidate.name) {
      return { error: `姓名与学号不匹配（学号 ${ref.studentNo} 是「${candidate.name}」）` }
    }
    return { studentId: candidate.id }
  }
  if (!ref.name) return { error: '缺少学号与姓名' }
  const candidates = index.byName.get(ref.name) ?? []
  if (candidates.length === 0) return { error: `学生名单中找不到「${ref.name}」` }
  if (candidates.length > 1) return { error: '存在重名学生，请使用学号确认。' }
  return { studentId: candidates[0]!.id }
}

function resolveConstraints(
  raw: RawSeatRestoreConstraints,
  index: RestoreIndex,
): { constraints?: SeatPlanConstraints; errors: string[] } {
  const errors: string[] = []
  const resolvePair = (
    label: string,
    refs: [RawSeatRestoreStudentRef, RawSeatRestoreStudentRef],
  ): [string, string] | undefined => {
    const a = resolveConstraintStudent(refs[0], index)
    const b = resolveConstraintStudent(refs[1], index)
    if (!a.studentId) errors.push(`${label}：${a.error ?? '学生无法确认'}`)
    if (!b.studentId) errors.push(`${label}：${b.error ?? '学生无法确认'}`)
    if (!a.studentId || !b.studentId) return undefined
    if (a.studentId === b.studentId) {
      errors.push(`${label}：同一名学生不能和自己组成约束`)
      return undefined
    }
    return [a.studentId, b.studentId]
  }

  const constraints = createEmptySeatPlanConstraints()
  for (const refs of raw.sameDeskForbidden) {
    const pair = resolvePair(SEAT_DATA_CONSTRAINT_KINDS.sameDesk, refs)
    if (pair) {
      constraints.sameDeskForbidden.push({
        id: createId(),
        studentA: pair[0],
        studentB: pair[1],
      })
    }
  }

  for (const refs of raw.adjacentGroupForbidden) {
    const ids = refs.map((ref) => resolveConstraintStudent(ref, index))
    ids.forEach((item) => {
      if (!item.studentId) {
        errors.push(`${SEAT_DATA_CONSTRAINT_KINDS.adjacent}：${item.error ?? '学生无法确认'}`)
      }
    })
    const studentIds = ids.map((item) => item.studentId)
    if (studentIds.some((id) => !id)) continue
    if (new Set(studentIds).size !== 3) {
      errors.push(`${SEAT_DATA_CONSTRAINT_KINDS.adjacent}：必须由三名不同的学生组成`)
      continue
    }
    constraints.adjacentGroupForbidden.push({
      id: createId(),
      students: [studentIds[0]!, studentIds[1]!, studentIds[2]!],
    })
  }

  const resolveList = (label: string, refs: readonly RawSeatRestoreStudentRef[]): string[] => {
    const ids: string[] = []
    for (const ref of refs) {
      const resolved = resolveConstraintStudent(ref, index)
      if (!resolved.studentId) {
        errors.push(`${label}：${resolved.error ?? '学生无法确认'}`)
        continue
      }
      ids.push(resolved.studentId)
    }
    return ids
  }
  constraints.frontRowStudents = resolveList(SEAT_DATA_CONSTRAINT_KINDS.front, raw.frontRowStudents)
  constraints.backRowStudents = resolveList(SEAT_DATA_CONSTRAINT_KINDS.back, raw.backRowStudents)

  if (errors.length > 0) return { errors }
  return { constraints: normalizeSeatPlanConstraints(constraints), errors }
}

function emptyPlan(
  parsed: ParsedSeatRestore,
  errors: string[],
  warnings: string[],
): SeatRestorePlan {
  return {
    ok: false,
    source: parsed.source,
    sourceSheet: parsed.sourceSheet,
    planName: parsed.planName,
    appVersion: parsed.appVersion,
    exportedAt: parsed.exportedAt,
    layout: parsed.layout,
    layoutLabel: layoutLabelOf(parsed.layout),
    totalSeats: parsed.layout.totalSeats,
    occupiedSeats: 0,
    emptySeats: parsed.layout.totalSeats,
    assignable: 0,
    changed: 0,
    unchanged: 0,
    clearedSeats: 0,
    blocked: 0,
    errorCount: errors.length,
    rows: [],
    assignments: [],
    constraints: undefined,
    errors,
    warnings,
  }
}

function layoutLabelOf(layout: SeatRestoreLayout): string {
  return `${layout.rows} 排 × ${layout.cols} 列（${layout.blocks.join('-')}）· 固定空位第 ${layout.fixedEmptySeat.row} 排第 ${layout.fixedEmptySeat.col} 列`
}

/**
 * 解析结果 + 当前学生名单 / 当前座位 → 可确认的整表恢复计划（纯函数，无副作用）。
 *
 * `assignments` 只含**无错误**的已就座座位；只要有任何全局错误或被拦行，
 * `ok` 就是 false，页面禁用确认按钮、`applySeatRestore` 也不会被调用。
 */
export function planSeatRestore(
  parsed: ParsedSeatRestore,
  students: readonly Student[],
  currentSeats: ReadonlyArray<{ row: number; col: number; studentId?: string }>,
  config: ClassroomConfig = DEFAULT_CLASSROOM_CONFIG,
): SeatRestorePlan {
  const globalErrors: string[] = []
  const globalWarnings = [...parsed.warnings]

  const layoutError = layoutErrorOf(parsed.layout, config)
  if (layoutError) return emptyPlan(parsed, [layoutError], globalWarnings)

  const expectedSeats = parsed.layout.rows * parsed.layout.cols
  if (parsed.seats.length !== expectedSeats) {
    globalErrors.push(
      `座位文件只包含 ${parsed.seats.length} 个座位，按布局应为 ${expectedSeats} 个，文件可能已损坏。`,
    )
  }

  const index = buildRestoreIndex(students)
  const nameCounts = buildNameCounts(students.filter((student) => !student.deletedAt))
  const seatByKey = new Map<string, SeatRestoreSeatInput>()
  for (const seat of parsed.seats) {
    const key = `${seat.row}-${seat.col}`
    if (seatByKey.has(key)) {
      globalErrors.push(`座位文件重复记录了第 ${seat.row} 排第 ${seat.col} 列。`)
      continue
    }
    seatByKey.set(key, seat)
  }

  const currentStudentAtSeat = new Map<string, string>()
  const currentSeatOfStudent = new Map<string, string>()
  for (const seat of currentSeats) {
    if (!seat.studentId) continue
    const key = `${seat.row}-${seat.col}`
    currentStudentAtSeat.set(key, seat.studentId)
    if (!currentSeatOfStudent.has(seat.studentId)) {
      currentSeatOfStudent.set(seat.studentId, key)
    }
  }

  const rows: SeatRestorePreviewRow[] = []
  const assignments: SeatImportAssignment[] = []
  const assignedStudentRow = new Map<string, number>()
  let occupiedSeats = 0
  let changed = 0
  let unchanged = 0
  let blocked = 0
  let rowErrorCount = 0

  for (const seat of parsed.seats) {
    if (!seat.occupied) continue
    occupiedSeats += 1

    const errors: string[] = []
    const warnings: string[] = []
    const seatLabel = seatPositionShort(seat.row, seat.col)
    const fixedEmpty = isFixedEmptySeat(seat.row, seat.col, config)
    if (fixedEmpty) {
      errors.push(
        `第 ${seat.row} 排第 ${seat.col} 列是固定空位，不能安排学生（该位置在教室里永久留空）`,
      )
    }

    if (!isValidSeatPosition(seat.row, seat.col, config)) {
      errors.push(`座位位置（第 ${seat.row} 排第 ${seat.col} 列）超出当前教室范围`)
    }

    const resolved = fixedEmpty ? {} : resolveSeatStudent(seat, index)
    if (resolved.error) errors.push(`第 ${seat.row} 排第 ${seat.col} 列：${resolved.error}`)
    if (resolved.warning) warnings.push(resolved.warning)

    let studentId = resolved.student?.id
    if (studentId) {
      const firstRow = assignedStudentRow.get(studentId)
      if (firstRow !== undefined) {
        errors.push(`该学生已在第 ${firstRow} 行安排座位`)
        studentId = undefined
      } else if (errors.length === 0) {
        assignedStudentRow.set(studentId, seat.rowNumber)
      }
    }

    if (studentId && resolved.student && errors.length === 0) {
      assignments.push({ row: seat.row, col: seat.col, studentId })
      const key = `${seat.row}-${seat.col}`
      const here = currentStudentAtSeat.get(key)
      const elsewhere = currentSeatOfStudent.get(studentId)
      const change: SeatImportChange = here === studentId ? 'same' : elsewhere ? 'move' : 'new'
      if (change === 'same') unchanged += 1
      else changed += 1
      rows.push({
        rowNumber: seat.rowNumber,
        row: seat.row,
        col: seat.col,
        seatLabel,
        studentNo: seat.studentNo || resolved.student.studentNo?.trim() || '',
        name: resolved.student.name,
        studentLabel: formatStudentShortName(resolved.student, nameCounts),
        studentId,
        action: 'restore',
        change,
        errors,
        warnings,
      })
    } else {
      blocked += 1
      rowErrorCount += errors.length
      rows.push({
        rowNumber: seat.rowNumber,
        row: seat.row,
        col: seat.col,
        seatLabel,
        studentNo: seat.studentNo,
        name: seat.name || seat.displayName,
        action: 'blocked',
        errors,
        warnings,
      })
    }
  }

  let constraints: SeatPlanConstraints | undefined
  if (parsed.constraints) {
    const resolvedConstraints = resolveConstraints(parsed.constraints, index)
    if (resolvedConstraints.errors.length > 0) {
      globalErrors.push(...resolvedConstraints.errors)
    } else {
      constraints = resolvedConstraints.constraints
    }
  } else {
    globalWarnings.push('旧版导出文件不含排座约束，导入后当前方案的排座约束保持不变。')
  }

  /*
   * 「会腾空的座位」= 现在有人、恢复后同一格没人。换座学生让出的旧座位如果没有被
   * 别人接手，也计入——这正是整表恢复与逐条导入的差别：文件里没写的座位会被清空。
   */
  const targetSeatKeys = new Set(assignments.map((item) => `${item.row}-${item.col}`))
  const clearedSeats = currentSeats.filter(
    (seat) => seat.studentId && !targetSeatKeys.has(`${seat.row}-${seat.col}`),
  ).length
  const errorCount = globalErrors.length + rowErrorCount

  return {
    ok: globalErrors.length === 0 && blocked === 0,
    source: parsed.source,
    sourceSheet: parsed.sourceSheet,
    planName: parsed.planName,
    appVersion: parsed.appVersion,
    exportedAt: parsed.exportedAt,
    layout: parsed.layout,
    layoutLabel: layoutLabelOf(parsed.layout),
    totalSeats: parsed.layout.totalSeats,
    occupiedSeats,
    emptySeats: parsed.layout.totalSeats - occupiedSeats,
    assignable: assignments.length,
    changed,
    unchanged,
    clearedSeats,
    blocked,
    errorCount,
    rows,
    assignments,
    constraints,
    errors: globalErrors,
    warnings: globalWarnings,
  }
}
