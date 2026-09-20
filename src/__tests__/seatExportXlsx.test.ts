/**
 * 座位图导出自检（v3.5.1）：**Excel 改模板驱动 + 导出菜单精简**。
 *
 * 需求方原话：「座位图导出时就按照这个模板（两个视角都有）导出即可，把具体的名字换一下」
 * ——v3.4.0 照这句话做的是「**照着模板重画**一张表」（手写 OOXML）。重画的东西与模板
 * 是两份各自演化的实现：需求方这次只往模板里加了一个日期合并区，生成器就不知道，
 * 导出的文件当场与模板分叉。v3.5.1 改成**打开模板 → 只改文字 → 存回去**。
 *
 * 于是本文件守四件事：
 *
 *  ① **导出的 .xlsx 必须真能被打开、姓名真落在该落的格子里**。这里让与写侧完全独立的
 *     `XLSX.read()`（SheetJS）当主角读回来——「文件打得开吗」是自动化测不出来、
 *     只能靠另一个解析器说话的那类事。
 *  ② **样式逐项等于模板**。字号 / 填充 / 边框 / 对齐 / 行高 / 列宽 / 合并区 / 打印设置
 *     全部与模板对拍。这一条是本次改动的**全部意义**：除了标题、日期、63 个姓名，
 *     产物与模板不允许有任何差别。
 *  ③ **两张表各按自己的几何填**。模板两张工作表互为镜像（讲台一头一尾、列号方向相反、
 *     排号走向相反、日期合并区不在同一列），姓名写进哪一格由**该表自己的表头**推出。
 *     写错位不会报错，只会出一张看着很正常、但第 3 排坐的是第 5 排的人的座位表。
 *  ④ **菜单只剩两项**（源码级钉子）。
 *
 * 旧的 ①② 两节（手写 OOXML 的字节断言、`s="3"` 样式号）随生成器一起作废；
 * 「PDF 一律横向 A4」「导出图无性别彩条」那几条源码级钉子与本改动无关，**原样保留**。
 */
import { readFileSync } from 'node:fs'

import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import { DEFAULT_CLASSROOM_CONFIG as CFG } from '@/types/classroom'
import { buildSeatGrid, seatOrdinal } from '@/utils/seat'
import { buildSeatWorkbookFromTemplate } from '@/utils/seatTemplateXlsx'
import type { Student } from '@/types'
import type { Cell, Worksheet } from 'exceljs'

const TEMPLATE_PATH = 'docs/座位图-9.3.xlsx'

/** 模板文件名 → ArrayBuffer（`readFileSync` 给的是 Buffer，得按实际区间切） */
function readTemplate(): ArrayBuffer {
  const buffer = readFileSync(TEMPLATE_PATH)
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer
}

function makeStudent(id: string, name: string, idCardSuffix = ''): Student {
  return { id, name, studentNo: '', gender: 'female', idCardSuffix }
}

/**
 * 名册刻意用**与模板样例不同的名字**：模板 `docs/座位图-9.3.xlsx` 里是真实班级的
 * 「旦增卓玛（0063）」等等。导出若把模板的格子原样抄回来（而不是换成本班名册），
 * 下面「模板样例名一个都不许出现」那条就会红。
 *
 * 两个「张伟」用来验重名消歧——导出的格子里必须和屏幕上一样带上身份证尾号。
 */
const ROSTER: Student[] = [
  makeStudent('s1', '王小明'),
  makeStudent('s2', '张伟', '3287'),
  makeStudent('s3', '张伟', '3288'),
  makeStudent('s4', '李思远'),
]
const STUDENTS = new Map(ROSTER.map((student) => [student.id, student]))

/**
 * 座位占用：(排, 列) → 学生 id。**四角 + 正中**，用来咬住「镜像」这件事——
 * 只测一格的话，行翻转或列翻转写反了都可能漏过。
 *
 * 第 7 排第 3 列**刻意留空**：模板里这一格本来就是空的（带样式的空格子），
 * 正好验「空座只清文字、样式不退化成没边框」。
 */
const OCCUPANTS: [number, number, string][] = [
  [1, 1, 's1'], // 第 1 排最左（学生视角 M6 / 老师视角 B12）
  [1, 9, 's2'], // 第 1 排最右（学生视角 C6 / 老师视角 L12）
  [2, 5, 's4'], // 第 2 排正中（镜像下原地不动）
  [7, 9, 's3'], // 第 7 排最右（学生视角 C12 / 老师视角 L6）
]

/** 导出日期固定，免得断言跟着跑测那天飘 */
const EXPORT_DATE = new Date(2026, 8, 21)

function buildWorkbook(overrides: { title?: string; date?: Date } = {}): Promise<ArrayBuffer> {
  const seats = buildSeatGrid(
    new Map(OCCUPANTS.map(([row, col, id]) => [seatOrdinal(row, col, CFG), id])),
    CFG,
  )
  return buildSeatWorkbookFromTemplate(readTemplate(), {
    title: overrides.title ?? `${CFG.name}座位图`,
    date: overrides.date ?? EXPORT_DATE,
    sheets: [
      { sheetName: '学生视角', seats, students: STUDENTS },
      { sheetName: '老师视角', seats, students: STUDENTS },
    ],
  })
}

/** 读一份 .xlsx 的字节为 exceljs 工作簿（对拍样式用） */
async function loadWithExcelJs(bytes: ArrayBuffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes)
  return workbook
}

/** 一格的全部样式。**只取这四样**：其余（numFmt / protection）我们根本没碰过 */
function styleOf(cell: Cell) {
  return {
    font: cell.font,
    fill: cell.fill,
    border: cell.border,
    alignment: cell.alignment,
  }
}

/**
 * 抽样对拍的座位格：两张表的**整条第 1 排 + 末排两端 + 那个空格子**。
 * 两张表的地址完全不同（互为镜像），所以各写一份——写错就说明镜像推导错了。
 */
const SEAT_CELLS: Record<string, string[]> = {
  // 第 1 排（座位 1→9 落在 M,L,K,I,H,G,E,D,C）+ 第 7 排两端（M12/C12）+ 空格（K12）
  学生视角: ['M6', 'L6', 'K6', 'I6', 'H6', 'G6', 'E6', 'D6', 'C6', 'M12', 'C12', 'K12'],
  // 第 1 排（座位 1→9 落在 B,C,D,F,G,H,J,K,L）+ 第 7 排两端（B6/L6）+ 空格（D6）
  老师视角: ['B12', 'C12', 'D12', 'F12', 'G12', 'H12', 'J12', 'K12', 'L12', 'B6', 'L6', 'D6'],
}

/* ==================== ① 独立解析器读回来：文件真能打开、名字真在格子里 ==================== */

describe('导出 .xlsx：拿独立的解析器读回来验', () => {
  it('是真 ZIP（PK 头），工作表名与顺序照模板：学生视角在前、老师视角在后', async () => {
    const bytes = new Uint8Array(await buildWorkbook())
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)

    const workbook = XLSX.read(bytes, { type: 'array' })
    expect(workbook.SheetNames).toEqual(['学生视角', '老师视角'])
  })

  it('标题与日期：A1 用班级名、日期格是点分格式（`-` 与 `/` 都是需求方点名禁用的）', async () => {
    const workbook = XLSX.read(new Uint8Array(await buildWorkbook()), { type: 'array' })
    for (const name of ['学生视角', '老师视角']) {
      const sheet = workbook.Sheets[name]!
      expect(sheet['A1']!.v).toBe('高一9班座位图')
      // 日期合并区两张表不在同一列：学生视角 G2:I2、老师视角 F2:H2
      const dateCell = name === '学生视角' ? sheet['G2'] : sheet['F2']
      expect(dateCell!.v).toBe('2026.09.21')
      expect(String(dateCell!.v)).not.toContain('-')
      expect(String(dateCell!.v)).not.toContain('/')
    }
  })

  it('两张表各按自己的几何落名：同一座位在两张表里是同一个学生', async () => {
    const workbook = XLSX.read(new Uint8Array(await buildWorkbook()), { type: 'array' })
    const student = workbook.Sheets['学生视角']!
    const teacher = workbook.Sheets['老师视角']!

    // 第 1 排最左（物理第 1 排第 1 列）：学生视角 M6、老师视角 B12
    expect(student['M6']!.v).toBe('王小明')
    expect(teacher['B12']!.v).toBe('王小明')
    // 第 1 排最右（物理第 1 排第 9 列）：学生视角 C6、老师视角 L12
    expect(student['C6']!.v).toBe('张伟（3287）')
    expect(teacher['L12']!.v).toBe('张伟（3287）')
    // 第 7 排最右（物理第 7 排第 9 列）：学生视角 C12、老师视角 L6
    expect(student['C12']!.v).toBe('张伟（3288）')
    expect(teacher['L6']!.v).toBe('张伟（3288）')
    // 第 2 排第 5 列（正中一列，镜像下物理列不动）：学生视角 H7、老师视角 G11
    expect(student['H7']!.v).toBe('李思远')
    expect(teacher['G11']!.v).toBe('李思远')
  })

  it('空座只清文字：第 7 排第 3 列（模板里本来就是空格）两张表都空着', async () => {
    const workbook = XLSX.read(new Uint8Array(await buildWorkbook()), { type: 'array' })
    // 学生视角 K12、老师视角 D6 —— 正是模板里那两个「带样式的空格子」
    expect(workbook.Sheets['学生视角']!['K12']).toBeFalsy()
    expect(workbook.Sheets['老师视角']!['D6']).toBeFalsy()
  })

  it('模板样例名一个都不许残留（换的是名册，不是抄模板的格子）', async () => {
    const workbook = XLSX.read(new Uint8Array(await buildWorkbook()), { type: 'array' })
    const all: string[] = []
    for (const name of ['学生视角', '老师视角']) {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name]!, {
        header: 1,
        raw: false,
        defval: '',
      })
      all.push(...rows.flat().map(String))
    }
    for (const sample of ['次仁巴珍', '旦增卓玛', '尼玛拉姆', '土登列珠', '洛桑益西']) {
      expect(all.join('|')).not.toContain(sample)
    }
  })

  it('讲台 / 窗 / 前后门 / 过道一个不动（模板的版面整块保留）', async () => {
    const workbook = XLSX.read(new Uint8Array(await buildWorkbook()), { type: 'array' })
    // 讲台：学生视角在上（G3:I3 合并）、老师视角在下（F14:H14 合并）
    expect(workbook.Sheets['学生视角']!['G3']!.v).toBe('讲    台')
    expect(workbook.Sheets['老师视角']!['F14']!.v).toBe('讲    台')
    // 窗：学生视角左墙（B5:B12）、老师视角右墙（M5:M12）
    expect(workbook.Sheets['学生视角']!['B5']!.v).toBe('窗')
    expect(workbook.Sheets['老师视角']!['M5']!.v).toBe('窗')
    // 过道与学生视角的 9→1 列号行（列号在模板里是**数值**格，不是文本）
    expect(workbook.Sheets['学生视角']!['F5']!.v).toBe('过道')
    expect(workbook.Sheets['学生视角']!['C5']!.v).toBe(9)
    expect(workbook.Sheets['学生视角']!['M5']!.v).toBe(1)
    expect(workbook.Sheets['老师视角']!['B5']!.v).toBe(1)
    expect(workbook.Sheets['老师视角']!['L5']!.v).toBe(9)
  })
})

/* ==================== ② 与模板逐项对拍：只允许文字变化 ==================== */

describe('导出 .xlsx：与模板对比，只有文字变了', () => {
  it('合并区域逐项相同（少一个合并，讲台就变成一格字）', async () => {
    const [template, produced] = await Promise.all([
      loadWithExcelJs(readTemplate()),
      buildWorkbook().then(loadWithExcelJs),
    ])
    for (let index = 0; index < template.worksheets.length; index += 1) {
      const before = template.worksheets[index]!
      const after = produced.worksheets[index]!
      expect(after.name).toBe(before.name)
      expect(new Set(after.model.merges)).toEqual(new Set(before.model.merges))
    }
  })

  it('行高与列宽逐项相同', async () => {
    const [template, produced] = await Promise.all([
      loadWithExcelJs(readTemplate()),
      buildWorkbook().then(loadWithExcelJs),
    ])
    for (let index = 0; index < template.worksheets.length; index += 1) {
      const before = template.worksheets[index]!
      const after = produced.worksheets[index]!
      const rowHeights = (sheet: Worksheet) =>
        [1, 2, 3, 5, 6, 9, 12, 14].map((row) => sheet.getRow(row).height)
      expect(rowHeights(after)).toEqual(rowHeights(before))
      const colWidths = (sheet: Worksheet) =>
        sheet.columns.slice(0, 13).map((column) => column.width)
      expect(colWidths(after)).toEqual(colWidths(before))
    }
  })

  it('座位格的字号 / 填充 / 边框 / 对齐逐格等于模板', async () => {
    const [template, produced] = await Promise.all([
      loadWithExcelJs(readTemplate()),
      buildWorkbook().then(loadWithExcelJs),
    ])
    for (const name of ['学生视角', '老师视角']) {
      const before = template.getWorksheet(name)!
      const after = produced.getWorksheet(name)!
      for (const address of SEAT_CELLS[name]!) {
        expect(styleOf(after.getCell(address)), `${name}!${address} 的样式被改动了`).toEqual(
          styleOf(before.getCell(address)),
        )
      }
      // 标题与日期格同理（只换文字，不换字号）
      for (const address of ['A1', name === '学生视角' ? 'G2' : 'F2']) {
        expect(styleOf(after.getCell(address))).toEqual(styleOf(before.getCell(address)))
      }
    }
  })

  /**
   * 验收标准的原话是「与模板相比**只有**日期和姓名变了」——上面几条都是抽样，
   * 这条把两张表 14×13 格全走一遍，差异集合多一格就失败。
   *
   * 期望集合从**模板自己**推（第 5 行存数字的列 = 座位列），不是抄模块里的地址表：
   * 抄一份的话，模块推导错了测试也跟着错，等于没测。
   *
   * **班级名与日期刻意不用默认值**：模板里写死的正是「高一9班座位图」+ 今天，
   * 而 `CFG.name` 也是高一9班——用默认值的话 A1 与日期格「和模板一模一样」，
   * 本来就该有的 2 处差异会消失（实测 128 → 124），断言就随「样例是否恰好撞上」
   * 而飘，反而漏掉「标题压根没写进去」这种错。换成别的班与别的日期，差异才是确定的。
   */
  it('差异集合恰好是「标题 + 日期 + 姓名格」：多一格都不许变', async () => {
    const TITLE = '高二3班座位图'
    const DATE = new Date(2026, 9, 1) // 2026.10.01，模板里是 2026.09.21
    const [template, produced] = await Promise.all([
      loadWithExcelJs(readTemplate()),
      buildWorkbook({ title: TITLE, date: DATE }).then(loadWithExcelJs),
    ])

    /** 键序无关的序列化——exceljs 两次解析出的样式对象键序不保证一致 */
    const stable = (value: unknown): string =>
      JSON.stringify(value, (_key, item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort())
          : item,
      )

    let diffTotal = 0
    for (const name of ['学生视角', '老师视角']) {
      const before = template.getWorksheet(name)!
      const after = produced.getWorksheet(name)!

      const seatCols = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].filter(
        (col) => typeof before.getCell(5, col).value === 'number',
      )
      expect(seatCols, `${name} 的列号行该读出 9 个数字格`).toHaveLength(9)

      const allowed = new Set<string>(['A1', name === '学生视角' ? 'G2' : 'F2'])
      for (let row = 6; row <= 12; row += 1) {
        for (const col of seatCols) allowed.add(before.getCell(row, col).address)
      }
      expect(allowed.size).toBe(65)

      const changed: string[] = []
      for (let row = 1; row <= 14; row += 1) {
        for (let col = 1; col <= 13; col += 1) {
          const after_ = after.getCell(row, col)
          const before_ = before.getCell(row, col)
          // 合并区只认首格（从格读到的是空壳，样式也不在它身上）
          if (after_.isMerged && after_.master.address !== after_.address) continue
          if (
            after_.value !== before_.value ||
            stable(styleOf(after_)) !== stable(styleOf(before_))
          ) {
            changed.push(after_.address)
          }
        }
      }

      // 标题与日期确实落进去了（万一模块漏写这两格，它们就不会出现在差异里）
      expect(after.getCell('A1').value).toBe(TITLE)
      expect(after.getCell(name === '学生视角' ? 'G2' : 'F2').value).toBe('2026.10.01')

      expect(
        changed.filter((address) => !allowed.has(address)),
        `${name} 里有不该动却动了的格子`,
      ).toEqual([])
      diffTotal += changed.length
    }

    // 每张表 64 = 标题 + 日期 + 62 个姓名格；第 63 格模板里本来就是空的，写 null 后原样
    expect(diffTotal).toBe(128)
  })

  it('打印设置原样保留：学生视角仍是横向 A4，老师视角仍是模板里那样（不带）', async () => {
    const [template, produced] = await Promise.all([
      loadWithExcelJs(readTemplate()),
      buildWorkbook().then(loadWithExcelJs),
    ])
    for (const name of ['学生视角', '老师视角']) {
      const before = template.getWorksheet(name)!.pageSetup
      const after = produced.getWorksheet(name)!.pageSetup
      expect(after.paperSize).toBe(before.paperSize)
      expect(after.orientation).toBe(before.orientation)
      expect(after.fitToWidth).toBe(before.fitToWidth)
      expect(after.fitToHeight).toBe(before.fitToHeight)
      expect(after.margins).toEqual(before.margins)
    }
    // 学生视角那一页必须是横向 A4（需求方要的「直接可以打印」）
    expect(produced.getWorksheet('学生视角')!.pageSetup).toMatchObject({
      paperSize: 9,
      orientation: 'landscape',
    })
    // 老师视角那一页在模板里就没有 pageSetup —— **本次不许自作主张补上**
    // （要补是改模板的事，不是导出时偷偷改；见计划里那条已定决策）
    expect(produced.getWorksheet('老师视角')!.pageSetup.orientation).toBe(
      template.getWorksheet('老师视角')!.pageSetup.orientation,
    )
  })
})

/* ==================== ③ 源码级钉子：菜单只剩两项 ==================== */

describe('导出菜单精简：只剩 PDF 双视角与 Excel 两个视角', () => {
  const read = (path: string) => readFileSync(path, 'utf8')

  /**
   * 只取 `const ITEMS = [...]` 那一段源码。
   *
   * **钉子该盯菜单项，不该盯注释**：本组件顶部恰好写着「撤掉了哪三项」「文案里去掉了什么」，
   * 整文件 grep 会把那些说明文字当成违规（第一版就误伤过）。菜单项本身才是要钉的东西。
   */
  const itemsBlock = () => {
    const source = read('src/views/Seats/components/SeatExportMenu.vue')
    const start = source.indexOf('const ITEMS')
    expect(start).toBeGreaterThan(-1)
    return source.slice(start, source.indexOf('\n]', start))
  }

  it('菜单项恰好两项，且是被撤掉那三项一个不剩', () => {
    const source = read('src/views/Seats/components/SeatExportMenu.vue')
    expect(source).toContain("'pdf-dual'")
    expect(source).toContain("'xlsx-dual'")
    // 撤掉的三个入口：kind 与文案都不许留下（留一个就是个点了没用的按钮）
    for (const gone of ['png-teacher', 'png-student', 'pdf-teacher', 'PNG ·', 'FileDown']) {
      expect(source, `${gone} 不该再出现在导出菜单里`).not.toContain(gone)
    }
  })

  it('文案只有「PDF · 双视角」，不再挂「（2 页横向 A4）」这类实现细节', () => {
    const items = itemsBlock()
    expect(items).toContain("label: 'PDF · 双视角'")
    expect(items).toContain("label: 'Excel · 两个视角'")
    // 两个数字是给实现看的，不是给老师看的——菜单项里不该再出现
    expect(items).not.toContain('横向 A4')
    expect(items).not.toContain('2 页')
    // `{ kind: '` 带引号——类型标注那行写的 `{ kind: SeatExportKind` 不算条目
    expect(items.split('\n').filter((line) => line.includes("{ kind: '"))).toHaveLength(2)
  })

  it('导出种类只剩两项，且下载 PNG 的入口已经撤掉', () => {
    const source = read('src/utils/seatExport.ts')
    expect(source).toContain("export type SeatExportKind = 'pdf-dual' | 'xlsx-dual'")
    expect(source).not.toContain('downloadPng')
  })

  it('Excel 走模板：从 docs/ 直接引，不复制第二份副本', () => {
    const source = read('src/utils/seatTemplateXlsx.ts')
    expect(source).toContain("from '../../docs/座位图-9.3.xlsx?url'")
    // 只许改值——出现任何一个样式 API 的**调用 / 赋值写法**就说明又在「重画」了。
    // 盯语法不盯词：模块顶部那段说明本来就写着「font / mergeCells 一个都不用」，
    // 纯字符串匹配会把那句自述当成违规（第一版就误伤过）。
    for (const forbidden of [
      'addWorksheet(',
      'mergeCells(',
      '.font =',
      '.border =',
      '.fill =',
      '.alignment =',
    ]) {
      expect(source, `模板驱动模块不该出现 ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('模板进了 PWA 预缓存，否则离线点导出会拉不到模板', () => {
    expect(read('vite.config.ts')).toContain('woff2,xlsx')
  })
})

/* ==================== ④ PDF 横向 / 导出图素格（v3.4.0 的钉子，原样保留） ==================== */

describe('导出改版：PDF 横向 A4，导出图不再有长得不一样的格子', () => {
  const read = (path: string) => readFileSync(path, 'utf8')

  it('PDF 一律横向 A4（页面尺寸常量与 jsPDF 的方向都得是横向）', () => {
    const source = read('src/utils/seatExport.ts')
    expect(source).toContain('export const A4_WIDTH_MM = 297')
    expect(source).toContain('export const A4_HEIGHT_MM = 210')
    expect(source).toContain("orientation: 'landscape'")
    // 竖版口径必须彻底清干净：留着任何一处，将来谁照着抄就又竖回去了
    expect(source).not.toContain("orientation: 'portrait'")
  })

  it('双视角 PDF 是「一个视角一整页」，不是一页对半分', () => {
    const source = read('src/views/Seats/index.vue')
    expect(source).toContain('pdf.addPage()')
    // 上下半页那套算法（把两张图压到同一页）必须消失
    expect(source).not.toContain('budget')
    expect(source).not.toContain('A4_HEIGHT_MM')
  })

  it('导出图撤掉彩条 / 头像 / 图例 / 空位虚线＋号，格子只剩边框与姓名', () => {
    const source = read('src/views/Seats/components/SeatExportGraphic.vue')
    // 班委 / 高个的顶条正是需求方说的「卡片形状和其他学生不一样」
    for (const gone of [
      'is-cadre',
      'is-tall',
      'is-tag',
      'seatAccentOf',
      'ex-avatar',
      'ex-legend',
      'ex-swatch',
      'ex-plus',
      'ex-ordinal',
      'seatOrdinal',
      'is-empty',
    ]) {
      expect(source, `${gone} 不该再出现在导出图里`).not.toContain(gone)
    }
    // 空座位与有人的座位走**同一个类**，样式上不可能再分出两种长相
    expect(source).toContain('class="ex-seat"')
  })

  it('导出图仍然与页面共用同一份视角真源（改样式不许把同源改掉）', () => {
    const source = read('src/views/Seats/components/SeatExportGraphic.vue')
    for (const shared of ['viewRoomItems', 'viewRowUnits', 'viewColUnits', 'doorSidesOf']) {
      expect(source).toContain(shared)
    }
  })

  /**
   * 性别标记的两侧约定（v3.3.2）：**屏幕上有、导出图没有**。
   * 这是需求方同一次交付里的两句话——「网站上显示时给女生的卡片加一个彩条做区分」
   * 与「导出的不要这个彩条」。两条都要有钉子，否则将来谁把 SeatCard 复用到导出图
   * （或反过来给导出图补上标记）都发现不了。
   */
  it('女生彩条只在屏幕上，导出图里连 gender 这个词都不该有', () => {
    // 屏幕一侧：座位卡上确实画了底条，且类是父级 seatClass 算出来的
    expect(read('src/views/Seats/components/SeatCard.vue')).toContain('seat-gender-bar')
    expect(read('src/views/Seats/components/SeatClassroom.vue')).toContain("'is-girl'")
    // 令牌必须真的存在——删掉它底条会变成透明，而「没有彩条」与「彩条没颜色」肉眼一样
    expect(read('src/styles/theme.css')).toContain('--color-gender-female')

    // 导出一侧：一个性别标记都不许有
    const graphic = read('src/views/Seats/components/SeatExportGraphic.vue')
    for (const gone of ['is-girl', 'seat-gender-bar', 'gender']) {
      expect(graphic, `导出图不该出现 ${gone}`).not.toContain(gone)
    }
  })
})

/* ==================== ⑤ v3.5.1 新增：双视角 PDF 的页序 ==================== */

describe('双视角 PDF 的页序：老师视角在前', () => {
  const read = (path: string) => readFileSync(path, 'utf8')

  /**
   * 只取 `kind === 'pdf-dual'` 那一段。
   *
   * **钉整文件会误伤方案对比 PDF**：`runExport` 的兄弟函数 `runCompare`
   * （对比三个方案，3 页）也调 `pdf.addPage()`，两处挨着同一个 `createPdf()`。
   * 第一版整文件数 `addPage()` 就被它顶成了 3 次（误报）。
   */
  const dualBlock = () => {
    const source = read('src/views/Seats/index.vue')
    const start = source.indexOf("kind === 'pdf-dual'")
    const end = source.indexOf('-双视角.pdf')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    return source.slice(start, end)
  }

  it('先截老师视角 → addPage() → 再截学生视角（v3.4.0 是反的）', () => {
    const block = dualBlock()
    const teacher = block.indexOf('captureNode(exportTeacherEl.value)')
    const student = block.indexOf('captureNode(exportStudentEl.value)')
    const pageBreak = block.indexOf('pdf.addPage()')

    // 三个都在，且顺序就是页面顺序：captureNode 的调用次序 = PDF 的页序
    expect(teacher).toBeGreaterThan(-1)
    expect(student).toBeGreaterThan(-1)
    expect(pageBreak).toBeGreaterThan(-1)
    expect(teacher).toBeLessThan(pageBreak)
    expect(pageBreak).toBeLessThan(student)
  })

  it('页序变了，版面没变：仍然是「一页一视角」', () => {
    // 对调页序不该顺手把 addPage() 删了（删了就成一张图上盖两张）
    expect(dualBlock().match(/pdf\.addPage\(\)/g)).toHaveLength(1)
  })
})
