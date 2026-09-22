/**
 * 班费导出（v3.6.0，规格第十节）。
 *
 * 切成两半（沿用 `xlsxTemplate.ts` / `seatTemplateXlsx.ts` 的既有约定）：
 *   ① 本文件：纯函数——「流水 → 表格行」「批次 → 学生×批次矩阵」「分页」。不碰 DOM，
 *      因此能在 node 自检里直接跑（`fundExportXlsx.test.ts` 正是这么做的）。
 *   ② 页面那一半：把 DOM 节点交给 `renderExportNode` 拍成画布、把字节交给
 *      `downloadXlsxBuffer` 触发下载。合成一个函数就只能在浏览器里点着试，
 *      而「哪一行落进哪个单元格」恰恰是点不出来的那种错。
 *
 * PDF 走「离屏 DOM → 画布 → jsPDF 贴图」（`utils/seatExport.ts`），
 * 中文与 `✓` / `○` 由浏览器渲染进画布，不存在字体缺字的问题。
 */
import { formatAmount } from '@/utils/fund'
import type { XlsxSheetInput } from '@/utils/xlsxBook'
import type { FundFlowEntry, FundRosterRow } from '@/types/fund'

/** 导出种类：账本 PDF / 账本 Excel 两个入口 */
export type FundExportKind = 'pdf-ledger' | 'xlsx-ledger'

/**
 * 账页每页印几条流水。
 *
 * 15 是照着纸面倒推出来的：A4 横向 794px，减掉页头 66 / 合计条 58 / 表头 34 /
 * 页脚 22 / 上下留白 68 ≈ 546px 可用，一行 30px，15 行 = 450px（余量留给行高抖动）。
 * 改这个数要同时改 `FundExportSheet` 的纸面尺寸，否则最后一行会被裁掉。
 */
export const FUND_ROWS_PER_PAGE = 15

/** 名单页每页印几个批次（两块 + 抬头约占 600px，纸面可用约 602px） */
export const FUND_BATCHES_PER_PAGE = 2

/** 等分成每页一组；空数组返回空数组（不返回 `[[]]`——那会导出一张空页） */
export function paginate<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) return items.length ? [[...items]] : []
  const pages: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    pages.push(items.slice(index, index + size))
  }
  return pages
}

/* ==================== 导出的表头文案（PDF 与 Excel 共用一份） ==================== */

export const FUND_FLOW_HEADERS = ['日期', '类型', '分类', '标题', '金额（元）', '备注'] as const

/**
 * 文件名。沿用座位导出的既有形状（**中文名 + `-` 日期**）：
 * `高一9班班费账本-2026-09-23.pdf` / `高一9班班费账本_2026-09-23.xlsx`。
 * 班级名为空时不拼一个假的班级名，直接叫「班费账本」。
 */
export function fundExportFilename(
  className: string,
  kind: FundExportKind,
  dateStamp: string,
): string {
  const name = className.trim()
  const base = name ? `${name}班费账本` : '班费账本'
  return kind === 'pdf-ledger' ? `${base}-${dateStamp}.pdf` : `${base}_${dateStamp}.xlsx`
}

/** 导出标题（PDF 纸面大标题 / Excel 里的说明都用它） */
export function fundExportTitle(className: string): string {
  const name = className.trim()
  return name ? `${name} 班费账本` : '班费账本'
}

/* ==================== Excel ==================== */

/**
 * 工作表 1：收支流水（规格第十节：日期 | 类型 | 分类 | 标题 | 金额 | 备注）。
 *
 * **金额写带符号的数字**（收入正、支出负），不是 `+¥3,100` 这样的字符串：
 * 这一列要能被 Excel 直接求和，而且**和正好等于余额**——一本账导出来之后
 * 加起来对不上余额，是最说不清的一种错。方向另有「类型」列写着，不必靠符号猜。
 *
 * 日期写 `2026-09-03` 键（可排序）；分类只写名字（不写 emoji，见 ledger 组件说明）。
 */
export function buildFundFlowSheet(entries: readonly FundFlowEntry[]): XlsxSheetInput {
  return {
    sheetName: '收支流水',
    headers: [...FUND_FLOW_HEADERS],
    rows: entries.map((entry) => {
      const amount = entry.type === 'income' ? entry.amount : -entry.amount
      return [
        entry.date,
        entry.type === 'income' ? '收入' : '支出',
        entry.category,
        entry.title,
        amount,
        entry.note ?? '',
      ]
    }),
  }
}

/**
 * 工作表 2：收费批次（规格第十节：`学生 | 第一次 | 第二次`）。
 *
 * 是一张**学生 × 批次**的矩阵：第一列学生，之后每个批次一列，格子里写已交 / 未交。
 * 三种格子值是有意的：
 * - `已交` / `未交`：该学生在这个批次的名单里；
 * - **空**：他根本不在这个批次的名单里（比如中途转来，赶不上第一批）——
 *   写成「未交」会凭空给他记一笔欠费。
 */
export function buildFundCollectionSheet(
  batches: readonly { title: string; rows: readonly FundRosterRow[] }[],
): XlsxSheetInput | null {
  if (batches.length === 0) return null

  /** 学生并集，按**首次出现**顺序（各批次名单内部已按学号排序，并集因此也是有序的） */
  const order: string[] = []
  const names = new Map<string, string>()
  const paidByBatch = batches.map((batch) => {
    const map = new Map<string, boolean>()
    for (const row of batch.rows) {
      if (!names.has(row.studentId)) {
        names.set(row.studentId, row.name)
        order.push(row.studentId)
      }
      map.set(row.studentId, row.paid)
    }
    return map
  })

  return {
    sheetName: '收费批次',
    headers: ['学生', ...batches.map((batch) => batch.title)],
    rows: order.map((studentId) => [
      names.get(studentId) ?? '',
      ...paidByBatch.map((map) => {
        const paid = map.get(studentId)
        return paid === undefined ? '' : paid ? '已交' : '未交'
      }),
    ]),
  }
}

/* ==================== PDF ==================== */

/**
 * 流水 → PDF 表格里的金额文案（`+3,100` / `-86`）。
 * 与界面上的 `formatFlowAmount` 是同一个口径，只是不带 `¥`——
 * 表头已经写了「金额（元）」，每格再加一个币种符号是噪音。
 */
export function signedAmountText(entry: Pick<FundFlowEntry, 'type' | 'amount'>): string {
  return `${entry.type === 'income' ? '+' : '-'}${formatAmount(entry.amount)}`
}
