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
import { buildXlsxBook, downloadXlsxBuffer, xlsxFilename } from '@/utils/xlsxBook'

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
 * 生成 .xlsx 字节。
 *
 * v3.6.0 起实现搬去了 `utils/xlsxBook.ts`（班费账本要出**两个工作表**，单表接口装不下），
 * 这里只剩「单表 + 示例行」的这层包装，列宽 / 表头 / 工作表名规则不再有第二份。
 *
 * @returns 成功返回 ArrayBuffer；xlsx 模块加载失败（断网 / 首屏之后 chunk 没拉到）、
 *          表头为空或写文件抛错时返回 null——**调用方必须把 null 说出来，不能静默**
 */
export async function buildXlsxTemplate(options: XlsxTemplateOptions): Promise<ArrayBuffer | null> {
  const { sheetName = '导入模板', headers, sample = [] } = options
  return buildXlsxBook([{ sheetName, headers, rows: sample }])
}

/** 文件名补扩展名。教师看到的下载文件名必须一眼看出是什么格式 */
export function templateFilename(filename: string): string {
  return xlsxFilename(filename)
}

/**
 * 生成并下载一份 .xlsx 模板。
 *
 * @returns 成功 true；失败 false（原因见 `buildXlsxTemplate`），调用方据此提示
 */
export async function downloadXlsxTemplate(options: XlsxTemplateOptions): Promise<boolean> {
  const data = await buildXlsxTemplate(options)
  if (!data) return false
  return downloadXlsxBuffer(data, options.filename)
}
