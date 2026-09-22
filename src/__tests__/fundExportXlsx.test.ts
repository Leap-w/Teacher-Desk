/**
 * 班费导出自检（v3.6.0，规格第十节）：**Excel 两个工作表 + 分页 + 金额列可求和**。
 *
 * 让与写侧完全独立的 `XLSX.read()`（SheetJS）当主角把字节读回来——「文件打得开吗、
 * 哪一行落进了哪个单元格」是自动化测不出来、只能靠另一个解析器说话的那类事。
 *
 * 五条最要紧的：
 *
 *  ① **金额列必须能被 Excel 直接求和，且和正好等于余额**。写字符串 `+¥3,100` 的话
 *     这一列在 Excel 里是死的；而一本账导出来加起来对不上余额，是最说不清的一种错。
 *     方向另有「类型」列写着，不靠符号猜。
 *  ② **表格里不许出现 emoji**。界面上的 🧹 打出来是一个灰块（黑白打印更是分不清），
 *     分类在纸面与表格里只写名字。
 *  ③ **名单矩阵里的空格 ≠ 未交**。学生根本不在那个批次的名单里（比如中途转来，
 *     赶不上第一批）时写空——写成「未交」是凭空给他记一笔欠费。
 *  ④ **分页不会漏行也不会重复**：15 行一页，页数够装下全部流水。
 *  ⑤ 文件名沿用座位导出的形状（中文名 + 日期），班级名为空时不编一个假班级名。
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import {
  FUND_FLOW_HEADERS,
  FUND_ROWS_PER_PAGE,
  buildFundCollectionSheet,
  buildFundFlowSheet,
  fundExportFilename,
  fundExportTitle,
  paginate,
  signedAmountText,
} from '@/utils/fundExport'
import { buildFundFlowEntries, totalsOf } from '@/utils/fund'
import { buildXlsxBook } from '@/utils/xlsxBook'
import type { FundCollection, FundRecord, FundRosterRow } from '@/types/fund'
import type { Student } from '@/types'

/* ==================== 造数据 ==================== */

function student(id: string, name: string, studentNo: string): Student {
  return { id, name, studentNo, gender: 'female' }
}

function record(partial: Partial<FundRecord>): FundRecord {
  return {
    id: 'r1',
    type: 'expense',
    title: '买东西',
    amount: 1,
    date: '2026-09-05',
    category: '其他支出',
    createdAt: '2026-09-05T00:00:00.000Z',
    ...partial,
  }
}

/** 一个「真实感」的账本：一批班费 + 两笔支出 + 一笔补缴 */
const ROSTER = Array.from({ length: 62 }, (_, index) =>
  student(`s${index + 1}`, `学生${index + 1}`, String(index + 1).padStart(2, '0')),
)
const COLLECTION: FundCollection = {
  id: 'c1',
  title: '第一次班费',
  amountPerStudent: 50,
  date: '2026-09-01',
  // 61 人已交、1 人未交 → 3050 元
  records: ROSTER.slice(0, 61).map((item) => ({ studentId: item.id, paid: true })),
  createdAt: '2026-09-01T00:00:00.000Z',
}
const RECORDS: FundRecord[] = [
  record({
    id: 'r2',
    type: 'income',
    title: '李明补缴',
    amount: 300,
    date: '2026-09-10',
    category: '补缴',
  }),
  record({
    id: 'r3',
    title: '买扫把',
    amount: 86.5,
    date: '2026-09-12',
    category: '卫生用品',
    note: '三把',
  }),
  record({
    id: 'r4',
    title: '打印复习资料',
    amount: 13.5,
    date: '2026-09-15',
    category: '打印复印',
  }),
]

const ENTRIES = buildFundFlowEntries(RECORDS, [COLLECTION], ROSTER)
const TOTALS = totalsOf(ENTRIES)

/**
 * 纸面上不许出现的字：**图形化 emoji**（U+1F300–U+1FAFF 那一大片，含 🧹💰📚…）
 * 与那几个「emoji 版的对勾叉」（✅ ❌ ✔ ✖），外加变体选择符 U+FE0F。
 *
 * **`✓`（U+2713）与 `○`（U+25CB）不在其中**：它们是普通文字字形，任何字体里都有、
 * 黑白打印分得清——名单页要的正是它们。按 Unicode 区块一刀切（`☀-➿`）
 * 会把 ✓ 和 ✅ 一起拦下：那个范围里本来就混着文字符号与 emoji 两回事。
 *
 * U+FE0F 单独判（`includes`）而不是并进字符类：它是**变体选择符**（组合用字符），
 * 放进字符类会被 eslint 的 `no-misleading-character-class` 拦下——那条规则说得对，
 * 组合字符与普通字符混在一个类里，匹配行为不是读代码的人以为的那样。
 */
const PRINT_EMOJI = /[\u{1F300}-\u{1FAFF}✅❌✔✖]/u
/** 变体选择符 U+FE0F：写成转义而不是字面量——它在编辑器里是个零宽字符，看不见 */
const VARIATION_SELECTOR = '\uFE0F'

function hasPrintEmoji(text: string): boolean {
  return PRINT_EMOJI.test(text) || text.includes(VARIATION_SELECTOR)
}

/* ==================== 分页 ==================== */

describe('分页：不漏行、不重复', () => {
  it('15 行一页，装得下全部流水（页数 × 每页行数 ≥ 总数）', () => {
    const pages = paginate(ENTRIES, FUND_ROWS_PER_PAGE)
    expect(FUND_ROWS_PER_PAGE).toBe(15)
    expect(pages.length).toBe(Math.ceil(ENTRIES.length / FUND_ROWS_PER_PAGE))
    expect(pages.flat()).toEqual(ENTRIES)
  })

  it('恰好整除时不产生一张空页（空页会印成一整页空白）', () => {
    const pages = paginate(
      Array.from({ length: 30 }, (_, index) => index),
      15,
    )
    expect(pages).toHaveLength(2)
    expect(pages[1]).toEqual([15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29])
  })

  it('空数组返回空数组（不是 `[[]]`——那会导出一张空页）', () => {
    expect(paginate([], 15)).toEqual([])
  })
})

/* ==================== 收支流水表 ==================== */

describe('工作表 1：收支流水', () => {
  it('表头逐字照规格第十节（日期 | 类型 | 分类 | 标题 | 金额 | 备注）', () => {
    expect(buildFundFlowSheet(ENTRIES).headers).toEqual([
      '日期',
      '类型',
      '分类',
      '标题',
      '金额（元）',
      '备注',
    ])
    expect([...FUND_FLOW_HEADERS]).toEqual(buildFundFlowSheet(ENTRIES).headers)
  })

  it('金额是**带符号的数字**（收入正、支出负），不是 `+¥3,100` 这样的字符串', () => {
    const sheet = buildFundFlowSheet(ENTRIES)
    for (const row of sheet.rows) {
      expect(typeof row[4], `「${row[3]}」的金额该是数字`).toBe('number')
    }
  })

  it('**金额列加起来正好等于余额**（差一分钱教师就会怀疑整本账）', () => {
    const sheet = buildFundFlowSheet(ENTRIES)
    const sum = sheet.rows.reduce((total, row) => total + (row[4] as number), 0)
    // 用整数分比对：两个浮点数直接相等是碰运气
    expect(Math.round(sum * 100)).toBe(Math.round(TOTALS.balance * 100))
    // 这本账：3050 + 300 − 86.5 − 13.5 = 3250
    expect(TOTALS.balance).toBe(3250)
  })

  it('类型列写「收入 / 支出」，日期写可排序的日期键', () => {
    const sheet = buildFundFlowSheet(ENTRIES)
    const income = sheet.rows.find((row) => row[3] === '李明补缴')
    expect(income?.[1]).toBe('收入')
    expect(income?.[0]).toBe('2026-09-10')
    expect(income?.[4]).toBe(300)
  })

  it('批次行也是一个「收入」行，备注里带着已交人数', () => {
    const sheet = buildFundFlowSheet(ENTRIES)
    const batch = sheet.rows.find((row) => row[3] === '第一次班费')
    expect(batch?.[1]).toBe('收入')
    expect(batch?.[4]).toBe(3050)
    expect(String(batch?.[5])).toContain('已交 61/62')
  })

  it('没有备注的那几行写空串，不写 undefined', () => {
    const sheet = buildFundFlowSheet(ENTRIES)
    for (const row of sheet.rows) {
      expect(row[5]).not.toBeUndefined()
    }
  })

  it('signedAmountText 与界面口径一致，只是不带币种符号（表头已经写了「元」）', () => {
    expect(signedAmountText({ type: 'income', amount: 3100 })).toBe('+3,100')
    expect(signedAmountText({ type: 'expense', amount: 86 })).toBe('-86')
  })
})

/* ==================== 收费批次表 ==================== */

describe('工作表 2：收费批次（学生 × 批次矩阵）', () => {
  const rows = (paidStudentIds: string[], studentIds: string[]): FundRosterRow[] =>
    studentIds.map((studentId) => ({
      studentId,
      name: studentId,
      paid: paidStudentIds.includes(studentId),
      active: true,
    }))

  it('第一列学生，之后每个批次一列', () => {
    const sheet = buildFundCollectionSheet([
      { title: '第一次班费', rows: rows(['s1'], ['s1', 's2']) },
      { title: '第二次班费', rows: rows(['s2'], ['s1', 's2']) },
    ])
    expect(sheet?.headers).toEqual(['学生', '第一次班费', '第二次班费'])
    expect(sheet?.rows).toEqual([
      ['s1', '已交', '未交'],
      ['s2', '未交', '已交'],
    ])
  })

  it('**不在这个批次名单里的学生写空**（不是「未交」——那会凭空记一笔欠费）', () => {
    // s3 是第二批才转来的：第一批的名单里没有他
    const sheet = buildFundCollectionSheet([
      { title: '第一次班费', rows: rows([], ['s1']) },
      { title: '第二次班费', rows: rows([], ['s1', 's3']) },
    ])
    const s3 = sheet?.rows.find((row) => row[0] === 's3')
    expect(s3?.[1]).toBe('')
    expect(s3?.[2]).toBe('未交')
  })

  it('学生列表取各批次的并集，按首次出现顺序', () => {
    const sheet = buildFundCollectionSheet([
      { title: '第一批', rows: rows([], ['s2', 's1']) },
      { title: '第二批', rows: rows([], ['s3', 's1']) },
    ])
    expect(sheet?.rows.map((row) => row[0])).toEqual(['s2', 's1', 's3'])
  })

  it('一个批次都没有时返回 null（调用方据此不加第二个工作表）', () => {
    expect(buildFundCollectionSheet([])).toBeNull()
  })
})

/* ==================== 写出的字节 ==================== */

describe('写出的 .xlsx：能被独立解析器打开', () => {
  /** 一个批次的名单表（只有一名学生，用来验工作表与格子） */
  function oneBatchSheet(paid: boolean) {
    return buildFundCollectionSheet([
      { title: '第一次班费', rows: [{ studentId: 's1', name: '张三', paid, active: true }] },
    ])
  }

  /** 建一本两表的工作簿并读回来；`buildFundCollectionSheet` 返回 null 时当场失败 */
  async function readBook(collectionSheet: ReturnType<typeof oneBatchSheet>) {
    if (!collectionSheet) throw new Error('名单表不该是 null')
    const buffer = await buildXlsxBook([buildFundFlowSheet(ENTRIES), collectionSheet])
    if (!buffer) throw new Error('工作簿生成失败')
    return XLSX.read(buffer, { type: 'array' })
  }

  it('两个工作表都在，名字与内容逐格对得上', async () => {
    const workbook = await readBook(oneBatchSheet(true))
    expect(workbook.SheetNames).toEqual(['收支流水', '收费批次'])

    const flow = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets['收支流水'] as XLSX.WorkSheet, {
      header: 1,
    })
    expect(flow[0]).toEqual(['日期', '类型', '分类', '标题', '金额（元）', '备注'])
    // 表头 1 行 + 4 笔流水
    expect(flow).toHaveLength(1 + ENTRIES.length)

    const roster = XLSX.utils.sheet_to_json<string[]>(
      workbook.Sheets['收费批次'] as XLSX.WorkSheet,
      { header: 1 },
    )
    expect(roster[0]).toEqual(['学生', '第一次班费'])
    expect(roster[1]).toEqual(['张三', '已交'])
  })

  it('**表格里不出现 emoji**（打出来是一个灰块，黑白打印更分不清）', async () => {
    const workbook = await readBook(oneBatchSheet(false))
    for (const name of workbook.SheetNames) {
      const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name] as XLSX.WorkSheet, {
        header: 1,
      })
      for (const row of grid) {
        for (const cell of row) {
          expect(hasPrintEmoji(String(cell)), `「${name}」里出现了 emoji：${String(cell)}`).toBe(
            false,
          )
        }
      }
    }
  })

  it('分类写的是名字，不是带图标的文案', () => {
    const sheet = buildFundFlowSheet(ENTRIES)
    const categories = sheet.rows.map((row) => row[2])
    expect(categories).toContain('卫生用品')
    expect(categories).not.toContain('🧹卫生用品')
  })

  it('工作表一张都没有时返回 null（调用方必须把 null 说出来）', async () => {
    expect(await buildXlsxBook([])).toBeNull()
  })
})

/* ==================== 文件名 ==================== */

describe('文件名与标题', () => {
  it('沿用座位导出的形状：中文名 + 日期；PDF 用 `-`、Excel 用 `_`', () => {
    expect(fundExportFilename('高一9班', 'pdf-ledger', '2026-09-23')).toBe(
      '高一9班班费账本-2026-09-23.pdf',
    )
    expect(fundExportFilename('高一9班', 'xlsx-ledger', '2026-09-23')).toBe(
      '高一9班班费账本_2026-09-23.xlsx',
    )
  })

  it('班级名为空时不编一个假班级名', () => {
    expect(fundExportFilename('  ', 'pdf-ledger', '2026-09-23')).toBe('班费账本-2026-09-23.pdf')
    expect(fundExportTitle('')).toBe('班费账本')
    expect(fundExportTitle('高一9班')).toBe('高一9班 班费账本')
  })
})

/* ==================== 源码级钉子 ==================== */

describe('源码级钉子：纸面口径', () => {
  /** 去掉注释后的实现源码（注释里正好会讨论 emoji，别被自己绊倒） */
  function codeOf(path: string): string {
    return readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
  }

  it('账页组件里没有图形化 emoji——图标由列表页负责，纸面认文字', () => {
    for (const file of ['FundExportLedgerSheet', 'FundExportRosterSheet', 'FundExportSheet']) {
      const code = codeOf(`src/views/Fund/components/${file}.vue`)
      expect(hasPrintEmoji(code), `${file} 里出现了 emoji`).toBe(false)
    }
  })

  it('名单页用 ✓ / ○ 而不是 ✅ / ❌（后者打出来是两个灰块）', () => {
    const code = codeOf('src/views/Fund/components/FundExportRosterSheet.vue')
    expect(code).toContain('✓')
    expect(code).toContain('○')
  })

  it('导出的合计恒为「全部」口径，不跟着页面上的统计范围切换走', () => {
    // 同一份文件在不同的切换状态下导出来是两个数的话，这份账本就没法交给别人
    const page = readFileSync('src/views/Fund/index.vue', 'utf8')
    const ledger = page.slice(page.indexOf('class="export-stage"'))
    expect(ledger).toContain(':totals="fundStore.totals"')
    expect(ledger).not.toContain('rangeTotals')
  })
})
