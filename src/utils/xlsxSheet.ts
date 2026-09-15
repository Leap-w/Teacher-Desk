/**
 * 座位图 .xlsx 导出（v3.4.0）——**手写最小 OOXML**。
 *
 * **为什么不复用仓库已有的 `xlsx`（SheetJS ^0.18.5）**：社区版写不出来这次要的两样东西。
 *   - **单元格样式**：写盘时整段忽略——`xlsx.js` 的 `write_ws_xml_cell()` 里只有一句
 *     源码里只留了一句 `TODO: cell style` 注释，`cell.s` 从头到尾没被读过；`get_cell_style()` 把
 *     `fontId / fillId / borderId` 字面量写成 0，`styles.xml` 是写死的骨架
 *     （1 个字体 / 2 个填充 / 1 个空边框）。**带边框的格子写不出来。**
 *   - **打印设置**：`!pageSetup` 在写盘代码里只剩一行注释，`paperSize` / `orientation`
 *     一个都出不去。**横向 A4 写不出来。**（唯一能落地的是 `!margins` 页边距。）
 * 而需求方给的模板 `docs/座位图-9.3.xlsx` 恰恰就是这两样：
 * 带边框的格子 + `pageSetup paperSize="9" orientation="landscape"`。
 *
 * 于是自己写。xlsx 本质就是一个 ZIP 里放几个 XML，内容量很小，**压缩用 stored（不压缩）**——
 * 省掉一整个 deflate 实现，几十 KB 的座位图压不压都一样大。
 *
 * 与 `xlsxTemplate.ts` 一样切成两半：
 *   ① `buildSeatWorkbook()` —— 只做「数据 → 字节」，不碰 DOM，因此能在 node 自检里被直接调用，
 *      再把字节喂回仓库现成的 `xlsx` **读回来验一遍**（`seatExportXlsx.test.ts` 正是这么做的）。
 *      这是本模块唯一的正确性保障：手写的 ZIP / OOXML 只要有一处不合规，读回就会露馅。
 *   ② `downloadXlsx()` —— 只做「字节 → 触发浏览器下载」。
 * 合成一个函数就只能在浏览器里点着试，而「文件打得开吗」恰恰是点不出来的那种错。
 */
import { buildNameCounts, formatStudentShortName } from '@/utils/student'
import {
  doorSidesOf,
  viewColUnits,
  viewRoomItems,
  viewRowUnits,
  windowSideOf,
} from '@/utils/seatView'
import type { RoomSide } from '@/utils/seatView'
import type { ClassroomConfig } from '@/types/classroom'
import type { Seat, SeatView } from '@/types/seat'
import type { Student } from '@/types'

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

/**
 * 样式表里的 `cellXfs` 下标。**与 `STYLES_XML` 里的顺序一一对应**，
 * 改一个必须同时改另一个（所以两处挨着放，中间不夹别的东西）。
 */
const STYLE = {
  /** 无样式（空白格） */
  plain: 0,
  /** 大标题：加粗、居中 */
  title: 1,
  /** 副标题：小字、灰、居中 */
  subtitle: 2,
  /** 座位格：细边框 + 居中 + 折行——**有人的和空着的用同一条**（模板里空位就是空边框格） */
  seat: 3,
  /** 排号 / 列号：灰字、居中、无边框 */
  label: 4,
  /** 讲台：淡青底 + 边框 */
  podium: 5,
  /** 前后门 / 窗：浅底 + 边框 */
  marker: 6,
  /** 过道：浅底 + 边框（纸上要看得出一条通道） */
  aisle: 7,
} as const

/**
 * 样式表。**刻意不引 theme**：`<color>` 一律写 `rgb="FFxxxxxx"`，绝不写 `theme="1"`——
 * 我们生成的包里没有 `xl/theme/theme1.xml`，引 theme 就是引一个不存在的部件。
 */
const STYLES_XML = `${XML_HEADER}
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3">
<font><sz val="11"/><color rgb="FF1F2937"/><name val="等线"/></font>
<font><b/><sz val="18"/><color rgb="FF0F172A"/><name val="等线"/></font>
<font><sz val="10"/><color rgb="FF6B7280"/><name val="等线"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEAF2F3"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF6F9F9"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFB6C2C4"/></left><right style="thin"><color rgb="FFB6C2C4"/></right><top style="thin"><color rgb="FFB6C2C4"/></top><bottom style="thin"><color rgb="FFB6C2C4"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

/** 一张工作表要渲染的东西（两个视角各一份） */
export interface SeatSheetInput {
  /** 工作表名（照模板：`学生视角` / `老师视角`） */
  sheetName: string
  config: ClassroomConfig
  /** 该方案的 63 个座位 */
  seats: readonly Seat[]
  /** 学生查询表（id → Student）：只读引用，不创建副本 */
  students: ReadonlyMap<string, Student>
  view: SeatView
  /** 大标题，如「高一9班 座位表」 */
  title: string
  /** 副标题行，如「方案：开学初 · 2026年9月16日 · 老师视角」 */
  subtitle: string
}

/* ==================== 网格：从 seatView 的显示单元摊平成单元格 ==================== */

interface SheetCell {
  text: string
  style: number
}

interface SheetSpec {
  name: string
  rows: (SheetCell | undefined)[][]
  rowHeights: number[]
  columnWidths: number[]
  merges: string[]
}

/** 列号 → 字母（1 → A、27 → AA）。Excel 的列引用，写 XML 用 */
function colLetter(index: number): string {
  let letters = ''
  let n = index
  while (n > 0) {
    const remainder = (n - 1) % 26
    letters = String.fromCharCode(65 + remainder) + letters
    n = Math.floor((n - 1) / 26)
  }
  return letters
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 把一条视角摊成一张表格。网格固定为：
 *
 *     第 1 列 = 排号 ｜ 第 2 列 = 左墙 ｜ 中间 = 座位与过道区 ｜ 最后一列 = 右墙
 *
 * 行序**直接跟着 `viewRoomItems()` 走**——老师视角是「后门 → 列号 → 第 7 排…第 1 排 → 讲台 + 前门」，
 * 学生视角是「讲台 + 前门 → 列号 → 第 1 排…第 7 排 → 后门」，与需求方模板的两个工作表逐项对得上。
 * 排序列、列号方向（1→9 / 9→1）、过道位置、门窗挂哪面墙**全部来自 `seatView.ts`**，
 * 这里一个数字都不自己算——导出的 Excel 与屏幕上那张图必须永远同一间教室。
 */
function buildSeatSheet(input: SeatSheetInput): SheetSpec {
  const { config, view } = input
  const seatsById = new Map(input.seats.map((seat) => [seat.id, seat]))
  const nameCounts = buildNameCounts([...input.students.values()])
  const items = viewRoomItems(view, config)
  const colUnits = viewColUnits(view, config)
  const doorSides = doorSidesOf(view, config)
  const windowsSide = windowSideOf(view, config)

  // 座位区的宽度 = 所有座位列 + 每条过道占一列（3 + 1 + 3 + 1 + 3 = 11）
  const regionWidth = colUnits.reduce(
    (sum, unit) => sum + (unit.kind === 'aisle' ? 1 : unit.cols.length),
    0,
  )
  const labelCol = 1
  const leftWallCol = 2
  const regionStart = 3
  const regionEnd = regionStart + regionWidth - 1
  const rightWallCol = regionEnd + 1
  const totalCols = rightWallCol
  /** 门 / 窗挂在左墙还是右墙（留哪一列给它） */
  const wallColumnOf = (side: RoomSide) => (side === 'left' ? leftWallCol : rightWallCol)

  const rows: (SheetCell | undefined)[][] = []
  const rowHeights: number[] = []
  const merges: string[] = []
  const blankRow = () => new Array<SheetCell | undefined>(totalCols).fill(undefined)

  // 表头两行（照模板：标题在上、日期行在下，都跨满整张表居中）
  const titleRow = blankRow()
  titleRow[labelCol - 1] = { text: input.title, style: STYLE.title }
  rows.push(titleRow)
  rowHeights.push(30)
  merges.push(`A1:${colLetter(totalCols)}1`)

  const subtitleRow = blankRow()
  subtitleRow[labelCol - 1] = { text: input.subtitle, style: STYLE.subtitle }
  rows.push(subtitleRow)
  rowHeights.push(16)
  merges.push(`A2:${colLetter(totalCols)}2`)

  for (const item of items) {
    const cells = blankRow()
    const sheetRow = rows.length + 1

    if (item.kind === 'front-line') {
      // 讲台横跨整个座位区（与模板的合并格一致），前门挂在它那一侧的墙位
      for (let col = regionStart; col <= regionEnd; col += 1) {
        cells[col - 1] = { text: col === regionStart ? '讲台' : '', style: STYLE.podium }
      }
      merges.push(`${colLetter(regionStart)}${sheetRow}:${colLetter(regionEnd)}${sheetRow}`)
      cells[wallColumnOf(doorSides.front) - 1] = { text: '前门', style: STYLE.marker }
      rowHeights.push(24)
    } else if (item.kind === 'door-back') {
      cells[wallColumnOf(doorSides.back) - 1] = { text: '后门', style: STYLE.marker }
      rowHeights.push(18)
    } else if (item.kind === 'cols') {
      let col = regionStart
      for (const unit of colUnits) {
        if (unit.kind === 'aisle') {
          cells[col - 1] = { text: '', style: STYLE.aisle }
          col += 1
          continue
        }
        for (const value of unit.cols) {
          cells[col - 1] = { text: String(value), style: STYLE.label }
          col += 1
        }
      }
      cells[wallColumnOf(windowsSide) - 1] = { text: '窗', style: STYLE.marker }
      rowHeights.push(18)
    } else {
      cells[labelCol - 1] = { text: String(item.row), style: STYLE.label }
      let col = regionStart
      for (const unit of viewRowUnits(item.row, view, config, seatsById)) {
        if (unit.kind === 'aisle') {
          cells[col - 1] = { text: '', style: STYLE.aisle }
          col += 1
          continue
        }
        for (const seat of unit.seats) {
          const student = seat.studentId ? input.students.get(seat.studentId) : undefined
          // 空座位与有人的座位**同一条样式**（模板里空位就是一个空边框格）。
          // 重名带身份证尾号，与屏幕、与 PNG / PDF 导出图同一个口径。
          cells[col - 1] = {
            text: student ? formatStudentShortName(student, nameCounts) : '',
            style: STYLE.seat,
          }
          col += 1
        }
      }
      rowHeights.push(30)
    }

    rows.push(cells)
  }

  const columnWidths: number[] = []
  for (let col = 1; col <= totalCols; col += 1) {
    if (col === labelCol) columnWidths.push(4)
    else if (col === leftWallCol || col === rightWallCol) columnWidths.push(6)
    else columnWidths.push(10)
  }

  return { name: input.sheetName, rows, rowHeights, columnWidths, merges }
}

/* ==================== 部件 XML ==================== */

function sheetXml(spec: SheetSpec): string {
  const parts: string[] = [XML_HEADER]
  parts.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">')
  // ⚠️ 以下子元素顺序被 schema 强制，**不能调整**：
  // sheetPr → dimension → sheetViews → sheetFormatPr → cols → sheetData
  // → mergeCells → printOptions → pageMargins → pageSetup
  parts.push('<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>')
  parts.push(`<dimension ref="A1:${colLetter(spec.columnWidths.length)}${spec.rows.length}"/>`)
  // showGridLines="0"：纸上只留我们画的框线，不叠一层 Excel 自己的浅灰网格
  parts.push('<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>')
  parts.push('<sheetFormatPr defaultRowHeight="18"/>')
  parts.push('<cols>')
  spec.columnWidths.forEach((width, index) => {
    parts.push(`<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
  })
  parts.push('</cols>')
  parts.push('<sheetData>')
  spec.rows.forEach((cells, rowIndex) => {
    const rowNumber = rowIndex + 1
    const height = spec.rowHeights[rowIndex]
    parts.push(`<row r="${rowNumber}"${height ? ` ht="${height}" customHeight="1"` : ''}>`)
    cells.forEach((cell, colIndex) => {
      if (!cell) return
      const ref = `${colLetter(colIndex + 1)}${rowNumber}`
      // 空文本不留空字符串节点，直接给一个带样式的空格子
      parts.push(
        cell.text === ''
          ? `<c r="${ref}" s="${cell.style}"/>`
          : `<c r="${ref}" s="${cell.style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.text)}</t></is></c>`,
      )
    })
    parts.push('</row>')
  })
  parts.push('</sheetData>')
  if (spec.merges.length > 0) {
    parts.push(`<mergeCells count="${spec.merges.length}">`)
    for (const ref of spec.merges) parts.push(`<mergeCell ref="${ref}"/>`)
    parts.push('</mergeCells>')
  }
  // 打印口径：横向居中 + A4 横向 + 缩到一页宽一页高 = 「直接可以打印」
  parts.push('<printOptions horizontalCentered="1"/>')
  parts.push(
    '<pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/>',
  )
  parts.push('<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="1"/>')
  parts.push('</worksheet>')
  return parts.join('')
}

/** 工作表名不能含 `: \ / ? * [ ]`，且不超过 31 字符（与 `xlsxTemplate.ts` 同一口径） */
function safeSheetName(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31)
}

function contentTypesXml(sheetCount: number): string {
  const parts: string[] = [XML_HEADER]
  parts.push('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">')
  parts.push(
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
  )
  parts.push('<Default Extension="xml" ContentType="application/xml"/>')
  parts.push(
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
  )
  for (let index = 1; index <= sheetCount; index += 1) {
    parts.push(
      `<Override PartName="/xl/worksheets/sheet${index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
  }
  parts.push(
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
  )
  parts.push('</Types>')
  return parts.join('')
}

function rootRelsXml(): string {
  return `${XML_HEADER}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
}

function workbookXml(specs: readonly SheetSpec[]): string {
  const parts: string[] = [XML_HEADER]
  parts.push(
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
  )
  parts.push('<sheets>')
  specs.forEach((spec, index) => {
    parts.push(
      `<sheet name="${escapeXml(safeSheetName(spec.name))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
  })
  parts.push('</sheets>')
  parts.push('</workbook>')
  return parts.join('')
}

function workbookRelsXml(sheetCount: number): string {
  const parts: string[] = [XML_HEADER]
  parts.push('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">')
  for (let index = 1; index <= sheetCount; index += 1) {
    parts.push(
      `<Relationship Id="rId${index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index}.xml"/>`,
    )
  }
  parts.push(
    `<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
  )
  parts.push('</Relationships>')
  return parts.join('')
}

/* ==================== ZIP（stored，不压缩） ==================== */

interface ZipEntry {
  name: string
  data: Uint8Array
}

/** CRC-32（IEEE 802.3）查表。ZIP 的每个条目都要带它，校验不过 Excel 直接判文件损坏 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/**
 * 打包成 ZIP。**全部用 stored（method 0，不压缩）**，因此不需要 deflate——
 * 省掉一整个压缩实现，代价只是文件大一点（座位图这一张表本来就只有几十 KB）。
 * 文件名带中文，所以置了 `0x0800`（UTF-8 名）标志位。
 */
function zipStore(entries: readonly ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    const crc = crc32(entry.data)
    const size = entry.data.length

    const local = new Uint8Array(30 + nameBytes.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true) // 本地文件头签名
    localView.setUint16(4, 20, true) // 解压所需版本 2.0
    localView.setUint16(6, 0x0800, true) // 通用标志位：文件名为 UTF-8
    localView.setUint16(8, 0, true) // 压缩方法：stored
    localView.setUint16(10, 0, true) // 修改时间
    localView.setUint16(12, 0x21, true) // 修改日期 = 1980-01-01（DOS 日期不能为 0）
    localView.setUint32(14, crc, true)
    localView.setUint32(18, size, true) // 压缩后大小 = 原始大小
    localView.setUint32(22, size, true)
    localView.setUint16(26, nameBytes.length, true)
    localView.setUint16(28, 0, true) // 扩展字段长度
    local.set(nameBytes, 30)
    parts.push(local, entry.data)

    const central = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true) // 中央目录签名
    centralView.setUint16(4, 20, true) // 创建版本
    centralView.setUint16(6, 20, true) // 解压所需版本
    centralView.setUint16(8, 0x0800, true)
    centralView.setUint16(10, 0, true)
    centralView.setUint16(12, 0, true)
    centralView.setUint16(14, 0x21, true)
    centralView.setUint32(16, crc, true)
    centralView.setUint32(20, size, true)
    centralView.setUint32(24, size, true)
    centralView.setUint16(28, nameBytes.length, true)
    centralView.setUint16(30, 0, true) // 扩展字段
    centralView.setUint16(32, 0, true) // 注释
    centralView.setUint16(34, 0, true) // 起始磁盘号
    centralView.setUint16(36, 0, true) // 内部属性
    centralView.setUint32(38, 0, true) // 外部属性
    centralView.setUint32(42, offset, true) // 本地文件头偏移
    central.set(nameBytes, 46)
    centralParts.push(central)

    offset += local.length + size
  }

  const centralSize = centralParts.reduce((sum, chunk) => sum + chunk.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true) // 中央目录结束记录
  endView.setUint16(4, 0, true)
  endView.setUint16(6, 0, true)
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true)
  endView.setUint16(20, 0, true) // 注释长度

  return concatChunks([...parts, ...centralParts, end])
}

/* ==================== 对外入口 ==================== */

/**
 * 生成座位图 .xlsx 字节（两个视角 = 两个工作表）。
 *
 * @returns 返回的是 ArrayBuffer，可直接 `new Blob([buffer])` 或喂给 `XLSX.read`
 */
export function buildSeatWorkbook(sheets: readonly SeatSheetInput[]): ArrayBuffer {
  const specs = sheets.map(buildSeatSheet)
  const encoder = new TextEncoder()
  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: encoder.encode(contentTypesXml(specs.length)) },
    { name: '_rels/.rels', data: encoder.encode(rootRelsXml()) },
    { name: 'xl/workbook.xml', data: encoder.encode(workbookXml(specs)) },
    { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(workbookRelsXml(specs.length)) },
    { name: 'xl/styles.xml', data: encoder.encode(STYLES_XML) },
  ]
  specs.forEach((spec, index) => {
    entries.push({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: encoder.encode(sheetXml(spec)),
    })
  })

  // 复制一份再取 buffer：不去假设 Uint8Array 的底层缓冲恰好等于它的长度
  const bytes = zipStore(entries)
  const out = new Uint8Array(bytes.length)
  out.set(bytes)
  return out.buffer
}

/**
 * 触发浏览器下载（与 `downloadXlsxTemplate` 同一手法，走 Blob 而不是 dataURL）。
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
