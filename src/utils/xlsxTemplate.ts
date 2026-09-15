/**
 * Excel 导入模板下载（v3.3.1）。
 *
 * **为什么生成 .xlsx 而不是 CSV**：导入侧 `readSheetRows()` 是按**文件头**认格式的——
 * .xlsx 是 ZIP（`PK`）、.xls 是 OLE2（`D0 CF 11 E0`），两者都不是就拒收。
 * 一份 CSV（哪怕带 BOM）永远过不了这一关，教师下载模板 → 填好 → 导入被拒，
 * 还得自己回 Excel「另存为 .xlsx」再导一次。
 * 模板的全部意义就是「下下来填完能直接用」，所以这里直接生成真正的 .xlsx，
 * **与导入器认的是同一种格式**（v3.3.1 之前课程表 / 工作清单 / 值日发的是 CSV，已一并改掉）。
 *
 * 刻意切成两半：
 *   ① `buildXlsxTemplate()` —— 只做「选项 → .xlsx 字节」，不碰 DOM，因此能在 node 自检里
 *      被直接调用，再把字节喂回 `readSheetRows()` 验一遍（`importTemplate.test.ts` 正是这么做的）。
 *   ② `downloadXlsxTemplate()` —— 只做「字节 → 触发浏览器下载」。
 * 合成一个函数就只能在浏览器里点着试，而「模板自己导不进自家系统」恰恰是点不出来的那种错。
 */

export interface XlsxTemplateOptions {
  /** 文件名，可以不带扩展名（不带时补 `.xlsx`） */
  filename: string
  /** 工作表名 */
  sheetName?: string
  /** 表头（第一行） */
  headers: readonly string[]
  /** 示例行——帮助教师看清「节次写什么」「标签怎么分隔」这类格式问题 */
  sample?: readonly (readonly string[])[]
}

/**
 * 列宽估算。**中日韩字符要按 2 个字宽算**：`wch` 的单位是「字符数」，
 * 一个汉字在 Excel 里占两格，按 `length` 算出来的列宽会让中文列窄得只看得见半个字。
 * 用码点判断而不是正则字面量：`\uXXXX` 转义在编辑/传输时容易被转成真字符，
 * 数字比较没有这个风险，读起来也更直白。
 */
function displayWidth(text: string): number {
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

/**
 * 生成 .xlsx 字节。
 *
 * @returns 成功返回 ArrayBuffer；xlsx 模块加载失败（断网 / 首屏之后 chunk 没拉到）、
 *          表头为空或写文件抛错时返回 null——**调用方必须把 null 说出来，不能静默**
 */
export async function buildXlsxTemplate(options: XlsxTemplateOptions): Promise<ArrayBuffer | null> {
  const { sheetName = '导入模板', headers, sample = [] } = options
  if (headers.length === 0) return null

  let XLSX: typeof import('xlsx')
  try {
    XLSX = await import('xlsx')
  } catch {
    return null
  }

  try {
    // 第一行必须是表头（解析器认的就是第 0 行），所以示例只能往下排，前面不加任何说明行
    const rows: string[][] = [headers.map((header) => String(header))]
    for (const row of sample) {
      rows.push(headers.map((_, index) => String(row[index] ?? '')))
    }

    const sheet = XLSX.utils.aoa_to_sheet(rows)
    sheet['!cols'] = headers.map((header, index) => {
      const widest = rows.reduce((max, row) => Math.max(max, displayWidth(row[index] ?? '')), 0)
      // 上下各留一点余量；上限 40 免得一个长住址把表撑出屏幕
      return { wch: Math.min(40, Math.max(8, displayWidth(header) + 2, widest + 2)) }
    })

    const workbook = XLSX.utils.book_new()
    // 工作表名不能含 : \ / ? * [ ]，且不超过 31 字符
    XLSX.utils.book_append_sheet(
      workbook,
      sheet,
      sheetName.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31),
    )

    return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  } catch {
    return null
  }
}

/** 文件名补扩展名。教师看到的下载文件名必须一眼看出是什么格式 */
export function templateFilename(filename: string): string {
  return filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
}

/**
 * 生成并下载一份 .xlsx 模板。
 *
 * @returns 成功 true；失败 false（原因见 `buildXlsxTemplate`），调用方据此提示
 */
export async function downloadXlsxTemplate(options: XlsxTemplateOptions): Promise<boolean> {
  const data = await buildXlsxTemplate(options)
  if (!data) return false

  try {
    const blob = new Blob([data], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = templateFilename(options.filename)
    anchor.click()
    URL.revokeObjectURL(url)
    return true
  } catch {
    return false
  }
}
