/**
 * 座位图 .xlsx 导出（v3.5.1）——**模板驱动：复制模板 → 只改文字 → 导出**。
 *
 * ## 为什么把 v3.4.0 的手写 OOXML 生成器整个换掉
 *
 * v3.4.0 的 `utils/xlsxSheet.ts` 是**照着模板重画**一张表：自己写 `styles.xml`、
 * 自己拼 `<worksheet>`、自己挑行高列宽。它出的图当时看着是对的，但它与模板是
 * **两份各自演化的实现**——需求方这次只往模板里加了一个日期合并区（`G2:I2` / `F2:H2`），
 * 生成器就完全不知道，导出的文件立刻与模板分叉。座位图的版式是需求方定的，
 * 模板才是唯一真源；生成器再像也只是模仿，模板一改就过时。
 *
 * 所以这里改成：**打开模板 → 只改单元格的值 → 存回去**。样式（字体 / 字号 / 填充 /
 * 边框 / 对齐 / 行高 / 列宽 / 合并 / 打印设置 / 页边距）一个都不碰——因为根本没碰过，
 * 它们是从模板字节里原样读进来又原样写回去的。`窗`「门」「过道」「讲台」同理。
 *
 * ## 为什么是 exceljs
 *
 * 仓库现成的 `xlsx`（SheetJS 社区版）写不出单元格样式与打印设置（社区版写盘时整段忽略，
 * 见 v3.4.0 那条注释），这个结论没有变。exceljs 的**读 + 写**两侧都保留完整样式，
 * 对它做过往返实测：364 个单元格的字号 / 填充 / 边框 / 对齐零差异，合并区域、行高、
 * 列宽、横向 A4 打印设置、页边距全部保留。代价是它会重写整个包（`styles.xml` 去重重排、
 * 丢 `docProps/custom.xml` 这个非视觉元数据），**视觉产物与模板一致，但不是逐字节相同**。
 *
 * ## 单元格映射：从模板自己的表头推导，不硬编码地址
 *
 * 两张工作表（`学生视角` / `老师视角`）的几何互为镜像——一个的讲台在上、另一个在下，
 * 列号方向相反，排号自上而下的走向也相反。想把姓名写对，**不能**记一张地址表：
 * 模板一调列宽或挪一行，地址表就悄悄错了，而错位的姓名在图上看着仍然像一份正常座位表。
 *
 * 所以座位格由**该表自己的两个表头**当场推出来（见 `deriveSeatCells`）：
 *
 *     第 5 行（列号行）  数值 = 物理列号，列 = 座位所在列   →  C=9 D=8 E=7 … M=1
 *     A6:A12（排号列） 数值 = 物理排号，行 = 该排所在行   →  第 1 排 … 第 7 排
 *
 * 两张表共用同一段逻辑，没有 `if (view === 'student')` 这种分叉。推出的结果必须恰好
 * 覆盖 7 排 × 9 列共 63 个格子，否则**抛错**——宁可导不出，也不出一张错位的座位表。
 *
 * ## 切成两半（沿用 `xlsxTemplate.ts` / 旧 `xlsxSheet.ts` 的既有约定）
 *
 *   ① `buildSeatWorkbookFromTemplate()` —— 只做「字节 → 字节」，不碰 DOM，
 *      因此能在 node 自检里拿真实模板跑，再用 SheetJS 独立读回来验一遍。
 *   ② `loadSeatTemplate()` / `downloadXlsx()` —— 只做「取模板」与「触发下载」。
 * 合成一个函数就只能在浏览器里点着试，而「姓名写没写对格子」恰恰是点不出来的那种错。
 */
import type { Cell, Worksheet } from 'exceljs'

import templateUrl from '../../docs/座位图-9.3.xlsx?url'
import { exportDateDotted } from '@/utils/seatExport'
import { getSeatKey } from '@/utils/seat'
import { buildNameCounts, formatStudentShortName } from '@/utils/student'
import type { Seat } from '@/types/seat'
import type { Student } from '@/types'

/**
 * 模板里座位区的表头位置。**两张工作表一致**（模板实测）。
 *
 * 这三个数字是「去哪儿找表头」，不是「姓名写在哪」——写在哪由读到的表头内容决定。
 * 模板挪了表头位置就找不到表头，`deriveSeatCells` 会抛错，而不是把姓名写到空地上。
 */
const COL_HEADER_ROW = 5
const ROW_LABEL_COL = 1
const FIRST_LABEL_ROW = 6
const LAST_LABEL_ROW = 12

/** 教室规模（照 `DEFAULT_CLASSROOM_CONFIG`：7 排 × 9 列 = 63 座） */
const ROWS = 7
const COLS = 9

/** 一张工作表要填的东西 */
export interface SeatTemplateSheetInput {
  /** 工作表名，照模板：`学生视角` / `老师视角` */
  sheetName: string
  /** 该方案的 63 个座位（物理坐标，不重排序） */
  seats: readonly Seat[]
  /** 学生查询表（id → Student）：只读引用，不创建副本 */
  students: ReadonlyMap<string, Student>
}

/** 一次导出要填的全部内容 */
export interface SeatTemplateInput {
  /** 大标题，如「高一9班座位图」（模板 A1 是「高一9班座位图」，班级名动态） */
  title: string
  /** 导出日期 */
  date: Date
  /** 两张工作表各一份 */
  sheets: readonly SeatTemplateSheetInput[]
}

/* ==================== 模板定位：表头 → 座位格 → 单元格地址 ==================== */

/** 单元格取值并转成整数；不是整数的（空、文字、公式）一律当没读到 */
function cellInteger(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isInteger(value) ? value : undefined
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return /^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : undefined
  }
  return undefined
}

/**
 * 从工作表自己的表头推出「物理座位 → 单元格地址」。
 *
 * 覆盖第 1~7 排 × 第 1~9 列共 63 格；数量对不上直接抛错（模板被改坏了，
 * 或者拿错了文件）。**不做任何兜底猜测**：少一格就说明这张表不是我们认得的座位图。
 */
function deriveSeatCells(sheet: Worksheet): Map<string, string> {
  const columnOf = new Map<number, number>()
  for (let col = 2; col <= 13; col += 1) {
    const seat = cellInteger(sheet.getCell(COL_HEADER_ROW, col).value)
    if (seat !== undefined && seat >= 1 && seat <= COLS) columnOf.set(seat, col)
  }

  const rowOf = new Map<number, number>()
  for (let row = FIRST_LABEL_ROW; row <= LAST_LABEL_ROW; row += 1) {
    const seatRow = cellInteger(sheet.getCell(row, ROW_LABEL_COL).value)
    if (seatRow !== undefined && seatRow >= 1 && seatRow <= ROWS) rowOf.set(seatRow, row)
  }

  if (columnOf.size !== COLS || rowOf.size !== ROWS) {
    throw new Error(
      `模板工作表「${sheet.name}」的表头对不上：读到 ${rowOf.size} 排 × ${columnOf.size} 列，应当是 ${ROWS} × ${COLS}`,
    )
  }

  const cells = new Map<string, string>()
  for (const [row, sheetRow] of rowOf) {
    for (const [col, sheetCol] of columnOf) {
      cells.set(getSeatKey(row, col), sheet.getCell(sheetRow, sheetCol).address)
    }
  }
  return cells
}

/**
 * 某一行的合并区锚点（左上格）。
 *
 * 合并区只有左上格存得住值，写别的格子等于没写。标题在第 1 行、日期在第 2 行，
 * 两张表的日期合并区**不在同一列**（学生视角 `G2:I2`、老师视角 `F2:H2`），
 * 所以不写死列号——找该行第一个合并格，取它的锚点。
 */
function mergeAnchorOf(sheet: Worksheet, row: number): string {
  for (let col = 1; col <= 20; col += 1) {
    const cell = sheet.getCell(row, col)
    if (cell.isMerged) return (cell.master as Cell).address
  }
  throw new Error(`模板工作表「${sheet.name}」第 ${row} 行没有合并单元格，标题 / 日期无处可写`)
}

/* ==================== ① 字节 → 字节（不碰 DOM，可在 node 自检里直接跑） ==================== */

/**
 * 拿模板字节生成座位图 .xlsx。
 *
 * **只改 value，不碰任何样式 API**——`font` / `fill` / `border` / `alignment` /
 * `mergeCells` / `addWorksheet` 一个都不用。空座写成 `null`（只清文字，
 * 那一格的边框与填充留在原处：模板里的空位本来就是「带样式的空格子」）。
 *
 * @param templateBytes 模板文件字节（`docs/座位图-9.3.xlsx`）
 * @returns 可直接 `new Blob([buffer])` 的 ArrayBuffer
 */
export async function buildSeatWorkbookFromTemplate(
  templateBytes: ArrayBuffer,
  input: SeatTemplateInput,
): Promise<ArrayBuffer> {
  // exceljs 只在点导出时才下载（`browser` 字段指向自包含的 dist 包，约 950KB）
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(templateBytes)

  for (const sheetInput of input.sheets) {
    const sheet = workbook.getWorksheet(sheetInput.sheetName)
    if (!sheet) {
      throw new Error(`模板里没有工作表「${sheetInput.sheetName}」`)
    }

    sheet.getCell(mergeAnchorOf(sheet, 1)).value = input.title
    sheet.getCell(mergeAnchorOf(sheet, 2)).value = exportDateDotted(input.date)

    const cells = deriveSeatCells(sheet)
    const seatByKey = new Map(
      sheetInput.seats.map((seat) => [getSeatKey(seat.row, seat.col), seat]),
    )
    // 重名消歧与屏幕、与 PNG / PDF 导出图同一个口径（formatStudentShortName）
    const nameCounts = buildNameCounts([...sheetInput.students.values()])

    for (const [key, address] of cells) {
      const studentId = seatByKey.get(key)?.studentId
      const student = studentId ? sheetInput.students.get(studentId) : undefined
      sheet.getCell(address).value = student ? formatStudentShortName(student, nameCounts) : null
    }
  }

  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer
}

/* ==================== ② 取模板 / 触发下载（碰 DOM 的那一半） ==================== */

let templatePromise: Promise<ArrayBuffer> | undefined

/**
 * 取模板字节（模块级 memo：一次会话只拉一遍）。
 *
 * @throws 网络失败或响应非 2xx——**调用方必须把失败说出来**，不能静默出一张空表
 */
export function loadSeatTemplate(): Promise<ArrayBuffer> {
  templatePromise ??= fetch(templateUrl).then((response) => {
    if (!response.ok) {
      throw new Error(`模板加载失败：HTTP ${response.status}`)
    }
    return response.arrayBuffer()
  })
  return templatePromise
}

/**
 * 触发浏览器下载（走 Blob 而不是 dataURL，避免大文件撑爆地址栏）。
 *
 * @returns 成功 true；`Blob` / `URL` 不可用或点击抛错时 false——**调用方必须把 false 说出来**
 */
export function downloadXlsx(buffer: ArrayBuffer, filename: string): boolean {
  try {
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
    anchor.click()
    URL.revokeObjectURL(url)
    return true
  } catch {
    return false
  }
}
