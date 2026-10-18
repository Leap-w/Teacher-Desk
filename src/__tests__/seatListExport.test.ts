/**
 * 「Excel · 行列列表」导出自检。
 *
 * 这份导出的唯一用途是**能被现有「导入座位」原样读回**，所以测试不只看列名对不对，
 * 还要走一遍真正的往返：
 *
 *   ① 纯函数层：63 行（7 排 × 9 列）、排优先顺序、空座 / 固定空位 / 悬空 id 都留空；
 *   ② 纯数据往返：`buildSeatListRows → parseSeatRows → planSeatImport`，
 *      空座行自动跳过、可导入数与座位完全对得上；
 *   ③ 真实 .xlsx 往返：`buildXlsxBook → readSheetRows → parseSeatRows`。
 *      手写数组测不出写文件时的数字 / 字符串差异，这一条必须让真实实现说话。
 */
import { describe, expect, it } from 'vitest'

import { parseSeatRows, planSeatImport } from '@/services/seatImport'
import { readSheetRows } from '@/services/studentImport'
import { buildSeatListRows, SEAT_LIST_HEADERS } from '@/utils/seatList'
import { buildSeatGrid, seatOrdinal } from '@/utils/seat'
import { buildXlsxBook } from '@/utils/xlsxBook'
import { DEFAULT_CLASSROOM_CONFIG as CFG } from '@/types/classroom'
import type { Student } from '@/types'

function makeStudent(id: string, name: string, studentNo = ''): Student {
  return { id, name, studentNo, gender: 'female' }
}

const S1 = makeStudent('s1', '王小明', '0101')
const S2 = makeStudent('s2', '张伟', '0102')
const S3 = makeStudent('s3', '张伟', '0103')
const S4 = makeStudent('s4', '旦增卓玛', '')

const STUDENTS = [S1, S2, S3, S4]

/** s1 坐 (1,1)、s2 坐 (2,2)、s3 坐 (7,9)；s4 没座位 */
function seats() {
  return buildSeatGrid(
    new Map([
      [seatOrdinal(1, 1, CFG), 's1'],
      [seatOrdinal(2, 2, CFG), 's2'],
      [seatOrdinal(7, 9, CFG), 's3'],
    ]),
    CFG,
  )
}

describe('buildSeatListRows：63 行全量列表', () => {
  it('表头就是导入端认的四列', () => {
    expect(SEAT_LIST_HEADERS).toEqual(['行', '列', '学号', '姓名'])
  })

  it('7 排 × 9 列 = 63 行，按排优先顺序排', () => {
    const rows = buildSeatListRows(seats(), STUDENTS)
    expect(rows).toHaveLength(CFG.rows * CFG.cols)
    expect(rows[0]).toEqual([1, 1, '0101', '王小明'])
    expect(rows[1]).toEqual([1, 2, '', ''])
    expect(rows[8]).toEqual([1, 9, '', ''])
    expect(rows[9]).toEqual([2, 1, '', ''])
    expect(rows[10]).toEqual([2, 2, '0102', '张伟'])
    expect(rows.at(-1)).toEqual([7, 9, '0103', '张伟'])
  })

  it('空座、固定空位、悬空 studentId 的学生两列都留空', () => {
    const grid = seats()
    // 固定空位被人手工占了也要照实导出（不能静默丢数据）
    grid.find((seat) => seat.id === 'r1c9')!.studentId = 's4'
    // 学生已被删除 / 数据不同步：座位还挂着 id，但名单里没有
    grid.find((seat) => seat.id === 'r3c3')!.studentId = 'ghost'
    const rows = buildSeatListRows(grid, STUDENTS)

    expect(rows.find(([row, col]) => row === 1 && col === 9)).toEqual([1, 9, '', '旦增卓玛'])
    expect(rows.find(([row, col]) => row === 3 && col === 3)).toEqual([3, 3, '', ''])
  })

  it('学号去掉首尾空格；重名导出原始姓名（不带显示名后缀）', () => {
    const students = [makeStudent('s1', '王小明', ' 0101 '), S2, S3]
    const grid = buildSeatGrid(
      new Map([
        [seatOrdinal(1, 1, CFG), 's1'],
        [seatOrdinal(1, 2, CFG), 's2'],
        [seatOrdinal(1, 3, CFG), 's3'],
      ]),
      CFG,
    )
    const rows = buildSeatListRows(grid, students)
    expect(rows[0]).toEqual([1, 1, '0101', '王小明'])
    // 两名「张伟」都写原始姓名：导入端靠学号区分，显示名后缀只用于座位图识别
    expect(rows[1]!.slice(2)).toEqual(['0102', '张伟'])
    expect(rows[2]!.slice(2)).toEqual(['0103', '张伟'])
  })
})

describe('往返：导出的列表能原样导入', () => {
  function parseListRows(rows: ReturnType<typeof buildSeatListRows>) {
    return parseSeatRows([[...SEAT_LIST_HEADERS], ...rows], CFG)
  }

  it('纯数据往返：63 行里只有已就座的 3 行被导入，其余全是跳过的空座', () => {
    const rows = buildSeatListRows(seats(), STUDENTS)
    const parsed = parseListRows(rows)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.rows).toHaveLength(3)
    expect(parsed.emptySeatRows).toBe(CFG.totalSeats - 3)
    expect(parsed.blankRows).toBe(0)

    const plan = planSeatImport(
      parsed.rows,
      STUDENTS,
      buildSeatGrid(),
      parsed.blankRows,
      parsed.emptySeatRows,
    )
    expect(plan.total).toBe(CFG.totalSeats)
    expect(plan.emptySeatRows).toBe(CFG.totalSeats - 3)
    expect(plan.validSeats).toBe(CFG.totalSeats)
    expect(plan.assignable).toBe(3)
    expect(plan.blocked).toBe(0)
    expect(plan.errorCount).toBe(0)
    expect(plan.plan.assignments).toEqual([
      { row: 1, col: 1, studentId: 's1' },
      { row: 2, col: 2, studentId: 's2' },
      { row: 7, col: 9, studentId: 's3' },
    ])
  })

  it('真实 .xlsx 往返：写文件再读回来，行列与中文都还在', async () => {
    const rows = buildSeatListRows(seats(), STUDENTS)
    const buffer = await buildXlsxBook([{ sheetName: '座位表', headers: SEAT_LIST_HEADERS, rows }])
    expect(buffer).not.toBeNull()

    const read = await readSheetRows(buffer!)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.rows).toHaveLength(CFG.totalSeats + 1)
    expect(read.rows[0]).toEqual([...SEAT_LIST_HEADERS])
    // `readSheetRows` 用 `raw: false` 读回格式化文本——行列是「1」而不是数字 1，
    // 导入端本来就按文本解析，这里如实钉住读回来的样子。
    expect(read.rows[1]).toEqual(['1', '1', '0101', '王小明'])

    const parsed = parseSeatRows(read.rows, CFG)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.emptySeatRows).toBe(CFG.totalSeats - 3)
    expect(parsed.rows.map((row) => [row.row, row.col, row.studentNo])).toEqual([
      [1, 1, '0101'],
      [2, 2, '0102'],
      [7, 9, '0103'],
    ])
  })
})
