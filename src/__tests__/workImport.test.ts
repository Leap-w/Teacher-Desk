/**
 * 工作清单（V1.1.3）自检。
 *
 * 覆盖：
 * ① 日期 / 时间解析：YYYY-MM-DD、2026/9/4、2026年9月4日、18:00、9:5；
 * ② 排序 / 筛选 / 分组（今日 / 本周剩余 / 逾期）；
 * ③ 校验：空名称、非法日期、非法时间；
 * ④ 导入：同日同名 → 跳过；空行 → 跳过；非法行 → 拦下；
 * ⑤ 真实今日 = 工作清单的「今天」（共享 `isoDateOf`）。
 */
import { describe, expect, it } from 'vitest'

import { parseDateText, parseTimeText, isValidIsoDate, isValidClockTime } from '@/utils/work'
import {
  filterWorks,
  isoDateOf,
  isSameWork,
  isWorkForToday,
  isWorkOverdue,
  sortWorks,
  todayWorks,
  weekWorks,
  workSummary,
} from '@/utils/work'
import { parseWorkRows, planWorkImport } from '@/services/workImport'
import type { WorkItem } from '@/types/work'

/* ========== 日期 / 时间 ========== */

describe('日期 / 时间解析', () => {
  it('parseDateText：YYYY-MM-DD / 2026/9/4 / 2026年9月4日 都接受', () => {
    expect(parseDateText('2026-09-14')).toBe('2026-09-14')
    expect(parseDateText('2026/9/4')).toBe('2026-09-04')
    expect(parseDateText('2026年9月4日')).toBe('2026-09-04')
  })

  it('parseDateText：拒绝 2 月 30 日（**真实存在的日期校验**）', () => {
    expect(parseDateText('2026-02-30')).toBeUndefined()
    expect(parseDateText('2026-13-01')).toBeUndefined()
  })

  it('parseDateText：拒绝缺年份的「9/4」（避免臆造）', () => {
    expect(parseDateText('9/4')).toBeUndefined()
  })

  it('parseTimeText：HH:mm / 18:00:00 / 9:5 都归一', () => {
    expect(parseTimeText('18:00')).toBe('18:00')
    expect(parseTimeText('18:00:00')).toBe('18:00')
    expect(parseTimeText('9:5')).toBe('09:05')
  })

  it('parseTimeText：拒绝 25 点 / 61 分', () => {
    expect(parseTimeText('25:00')).toBeUndefined()
    expect(parseTimeText('18:61')).toBeUndefined()
  })

  it('isValidIsoDate：合法日期才认', () => {
    expect(isValidIsoDate('2026-09-14')).toBe(true)
    expect(isValidIsoDate('2026-02-30')).toBe(false)
    expect(isValidIsoDate('20260914')).toBe(false)
  })

  it('isValidClockTime：HH:mm 严格', () => {
    expect(isValidClockTime('09:30')).toBe(true)
    expect(isValidClockTime('23:59')).toBe(true)
    expect(isValidClockTime('24:00')).toBe(false)
    expect(isValidClockTime('9:30')).toBe(false)
  })
})

/* ========== 排序 / 筛选 / 分组 ========== */

describe('sortWorks / filterWorks / todayWorks / weekWorks / isWorkForToday / isWorkOverdue', () => {
  const today = '2026-09-14'
  const items: WorkItem[] = [
    mk({ id: 'a', title: '今天1', date: today, priority: 'normal', status: 'todo' }),
    mk({ id: 'b', title: '今天2', date: today, priority: 'urgent', status: 'todo' }),
    mk({ id: 'c', title: '明天', date: '2026-09-15', priority: 'important', status: 'todo' }),
    mk({ id: 'd', title: '上周逾期', date: '2026-09-10', priority: 'normal', status: 'todo' }),
    mk({ id: 'e', title: '今天已完成', date: today, priority: 'normal', status: 'done' }),
    mk({ id: 'f', title: '下周', date: '2026-09-22', priority: 'normal', status: 'todo' }),
  ]

  it('todayWorks：含今天未完成 + 逾期未完成（含当天已完成「今日状态反馈」）', () => {
    const list = todayWorks(items, today).map((work) => work.id)
    expect(list).toContain('a')
    expect(list).toContain('b')
    expect(list).toContain('d') // 逾期
    expect(list).toContain('e') // 当天已完成（当作今日状态反馈留在这里）
    expect(list).not.toContain('c') // 明天
    expect(list).not.toContain('f') // 下周
  })

  it('weekWorks：明天起、本周日止（含 / 不含逾期）', () => {
    const weekEnd = '2026-09-20' // 周日
    void weekEnd
    const list = weekWorks(items, today).map((work) => work.id)
    expect(list).toContain('c') // 明天
    expect(list).not.toContain('d') // 逾期不算本周剩余
    expect(list).not.toContain('f') // 下周
  })

  it('sortWorks：未完成在前、同日按优先级降序', () => {
    const list = sortWorks(items)
    const ids = list.map((work) => work.id)
    // 已完成 e 应该最后
    expect(ids[ids.length - 1]).toBe('e')
    // 今天的 a / b，b 紧急 → 在前
    expect(ids.indexOf('b')).toBeLessThan(ids.indexOf('a'))
  })

  it('filterWorks：按状态过滤', () => {
    expect(filterWorks(items, 'all')).toHaveLength(items.length)
    expect(filterWorks(items, 'todo').map((work) => work.status)).toEqual([
      'todo',
      'todo',
      'todo',
      'todo',
      'todo',
    ])
    expect(filterWorks(items, 'done')).toHaveLength(1)
  })

  it('isWorkOverdue / isWorkForToday：一致口径', () => {
    expect(isWorkOverdue(items[3]!, today)).toBe(true) // d
    expect(isWorkForToday(items[3]!, today)).toBe(true) // d
    expect(isWorkForToday(items[5]!, today)).toBe(false) // f
    expect(isWorkOverdue(items[5]!, today)).toBe(false) // f
  })

  it('workSummary：概览数字与列表口径一致', () => {
    const summary = workSummary(items, today)
    expect(summary.todayOpen).toBe(3) // a, b, d
    expect(summary.todayDone).toBe(1) // e
    expect(summary.overdue).toBe(1) // d
  })

  it('isSameWork：同日同名即视为同一任务（导入去重的依据）', () => {
    expect(
      isSameWork(
        { title: '收请假条', date: '2026-09-14' },
        { title: '  收请假条  ', date: '2026-09-14' },
      ),
    ).toBe(true)
    expect(
      isSameWork(
        { title: '收请假条', date: '2026-09-14' },
        { title: '收请假条', date: '2026-09-15' },
      ),
    ).toBe(false)
  })
})

/* ========== 导入 ========== */

describe('工作清单 Excel 导入', () => {
  const today = '2026-09-14'

  it('正常导入：3 行合法 → 可导入 3', () => {
    const rows: unknown[][] = [
      ['工作名称', '日期', '截止时间', '优先级', '分类', '描述'],
      ['收请假条', '2026-09-14', '18:00', '重要', '班主任', ''],
      ['批改作业', '2026-09-14', '22:00', '普通', '教学', ''],
      ['联系家长', '2026-09-15', '', '紧急', '班主任', '月考沟通'],
    ]
    const parsed = parseWorkRows(rows, today)
    if (!parsed.ok) throw new Error(parsed.error)
    const plan = planWorkImport(parsed.rows, [], today)
    expect(plan.errorCount).toBe(0)
    expect(plan.added).toBe(3)
    // 所有 plan 都默认 todo
    expect(plan.plan.works.every((work) => work.status === 'todo')).toBe(true)
  })

  it('空行跳过；非法行（工作名称空 / 日期非法 / 截止时间非法）被拦下', () => {
    const rows: unknown[][] = [
      ['工作名称', '日期', '截止时间', '优先级', '分类', '描述'],
      ['收请假条', '2026-09-14', '18:00', '重要', '班主任', ''],
      ['', '2026-09-14', '18:00', '重要', '班主任', ''],
      ['合法', '不是日期', '18:00', '重要', '班主任', ''],
      ['合法', '2026-09-14', '25:00', '重要', '班主任', ''],
      [],
    ]
    const parsed = parseWorkRows(rows, today)
    if (!parsed.ok) throw new Error(parsed.error)
    const plan = planWorkImport(parsed.rows, [], today)
    expect(plan.added).toBe(1)
    expect(plan.blocked).toBe(3)
    expect(plan.errorCount).toBeGreaterThan(0)
  })

  it('同日同名 → 跳过（不重复创建）', () => {
    const rows: unknown[][] = [
      ['工作名称', '日期', '截止时间', '优先级', '分类', '描述'],
      ['收请假条', '2026-09-14', '18:00', '重要', '班主任', ''],
      ['批改作业', '2026-09-14', '22:00', '普通', '教学', ''],
    ]
    const parsed = parseWorkRows(rows, today)
    if (!parsed.ok) throw new Error(parsed.error)
    const existing: WorkItem[] = [mk({ title: '收请假条', date: today, status: 'todo' })]
    const plan = planWorkImport(parsed.rows, existing, today)
    expect(plan.added).toBe(1)
    expect(plan.skipped).toBe(1)
  })

  it('分类 / 优先级不合法 → 归默认值（不拦下，warn 提示）', () => {
    const rows: unknown[][] = [
      ['工作名称', '日期', '截止时间', '优先级', '分类', '描述'],
      ['合法', '2026-09-14', '', '很随便', '其他类', ''],
    ]
    const parsed = parseWorkRows(rows, today)
    if (!parsed.ok) throw new Error(parsed.error)
    const plan = planWorkImport(parsed.rows, [], today)
    expect(plan.added).toBe(1)
    expect(plan.plan.works[0]?.priority).toBe('normal')
    expect(plan.plan.works[0]?.category).toBe('其他')
  })

  it('逾期行只警告，不阻断', () => {
    const rows: unknown[][] = [
      ['工作名称', '日期', '截止时间', '优先级', '分类', '描述'],
      ['昨天补做', '2026-09-10', '', '普通', '其他', ''],
    ]
    const parsed = parseWorkRows(rows, today)
    if (!parsed.ok) throw new Error(parsed.error)
    const plan = planWorkImport(parsed.rows, [], today)
    expect(plan.overdue).toBe(1)
    expect(plan.added).toBe(1)
  })
})

/* ========== helpers ========== */

function mk(overrides: Partial<WorkItem>): WorkItem {
  return {
    id: 'x',
    title: '默认',
    date: '2026-09-14',
    priority: 'normal',
    category: '其他',
    status: 'todo',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

void isoDateOf
