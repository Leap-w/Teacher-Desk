/**
 * 通用 .xlsx 生成与下载（v3.6.0）。
 *
 * 两个消费方：
 * - `utils/xlsxTemplate.ts` 的导入模板（单表 + 示例行）——本文件从它里面把
 *   「建表 → 定列宽 → 触发下载」这三段抽出来，两处共用一份实现（§11.1）。
 * - `utils/fundExport.ts` 的班费账本（**两个工作表**：收支流水 + 收费批次），
 *   导入模板那份只支持单表，所以账本以前无处可去。
 *
 * **样式一律不管**：SheetJS 社区版写不出单元格样式与打印设置，这里只给「表头 + 数据行」
 * 的纯数据表。需要模板样式（座位图那种）走 `utils/seatTemplateXlsx.ts` 的 exceljs 路线。
 *
 * 懒加载 `xlsx`：它是几百 KB 的包，只在教师真的点「导出」时才拉。
 */

/** 一张工作表：表头 + 数据行（行内可以混字符串与数字，数字原样落进单元格） */
export interface XlsxSheetInput {
  /** 工作表名；非法字符会被替换、超长会被截断（见 `sheetNameOf`） */
  sheetName: string
  /** 表头（第一行） */
  headers: readonly string[]
  /** 数据行；每行按表头顺序对齐，缺的补空串 */
  rows: readonly (readonly (string | number)[])[]
}

/** 单元格值：`aoa_to_sheet` 认字符串与数字，其余一律按字符串写 */
type CellValue = string | number

/**
 * 列宽估算。**中日韩字符要按 2 个字宽算**：`wch` 的单位是「字符数」，
 * 一个汉字在 Excel 里占两格，按 `length` 算出来的列宽会让中文列窄得只看得见半个字。
 * 用码点判断而不是正则字面量：`\uXXXX` 转义在编辑/传输时容易被转成真字符，
 * 数字比较没有这个风险，读起来也更直白。
 */
export function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    const isWide =
      (code >= 0x3000 && code <= 0x303f) || // CJK 标点
      (code >= 0x4e00 && code <= 0x9fff) || // CJK 汉字
      (code >= 0xff00 && code <= 0xffef) // 全角符号
    width += isWide ? 2 : 1
  }
  return width
}

/** 工作表名：Excel 不许含 `: \ / ? * [ ]`，且不超过 31 字符 */
function sheetNameOf(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31)
}

/**
 * 生成 .xlsx 字节。
 *
 * @returns 成功返回 ArrayBuffer；一张表都没有、`xlsx` 模块加载失败（断网 / chunk 没拉到）、
 *          写文件抛错时返回 **null**——调用方必须把 null 说出来，不能静默出一个空文件
 */
export async function buildXlsxBook(
  sheets: readonly XlsxSheetInput[],
): Promise<ArrayBuffer | null> {
  if (sheets.length === 0) return null

  let XLSX: typeof import('xlsx')
  try {
    XLSX = await import('xlsx')
  } catch {
    return null
  }

  try {
    const workbook = XLSX.utils.book_new()
    for (const input of sheets) {
      if (input.headers.length === 0) return null
      // 第一行必须是表头（解析器认的就是第 0 行），所以任何说明只能往下排
      const rows: CellValue[][] = [input.headers.map((header) => String(header))]
      for (const row of input.rows) {
        rows.push(input.headers.map((_, index) => row[index] ?? ''))
      }

      const sheet = XLSX.utils.aoa_to_sheet(rows)
      sheet['!cols'] = input.headers.map((header, index) => {
        const widest = rows.reduce(
          (max, row) => Math.max(max, displayWidth(String(row[index] ?? ''))),
          0,
        )
        // 上下各留一点余量；上限 40 免得一个长备注把表撑出屏幕
        return { wch: Math.min(40, Math.max(8, displayWidth(header) + 2, widest + 2)) }
      })
      XLSX.utils.book_append_sheet(workbook, sheet, sheetNameOf(input.sheetName))
    }

    return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  } catch {
    return null
  }
}

/** 文件名补扩展名。教师看到的下载文件名必须一眼看出是什么格式 */
export function xlsxFilename(filename: string): string {
  return filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
}

/**
 * 触发浏览器下载（走 Blob 而不是 dataURL，避免大文件撑爆地址栏）。
 *
 * `revokeObjectURL` **延后一拍**：立刻收回有概率打断尚未开始的下载
 * （`utils/backup.ts` 的 downloadJson 踩过同一个坑，那里也是这么处理的）。
 *
 * @returns 成功 true；`Blob` / `URL` 不可用或点击抛错时 false——调用方必须把 false 说出来
 */
export function downloadXlsxBuffer(buffer: ArrayBuffer, filename: string): boolean {
  let url = ''
  try {
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = xlsxFilename(filename)
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
    return true
  } catch {
    if (url) URL.revokeObjectURL(url)
    return false
  }
}
