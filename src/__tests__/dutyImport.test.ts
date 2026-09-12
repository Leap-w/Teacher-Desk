/**
 * 值日 Excel 批量导入（V1.1.5）自检：分组 + 安排两条管道。
 *
 * 分组：学号匹配 / 姓名匹配 / 重名拦截 / 学号不存在 / 姓名不匹配 / 表内学生重复 /
 *       错误行不进 plan / 未涉及的组保持不变 / 新建组追加队尾。
 * 安排：正常导入（换算成起点 + 组顺序）/ 无效组别 / 无效日期 / 日期不连续 /
 *       重复校验 / 星期列与日期不符。
 */
import { describe, expect, it } from 'vitest'

import {
  dutyGroupNameKey,
  parseDutyArrangeRows,
  parseDutyGroupRows,
  planDutyArrangeImport,
  planDutyGroupImport,
} from '@/services/dutyImport'
import type { DutyGroup } from '@/types/duty'
import type { Student } from '@/types'

/* ========== 组名归一 ========== */

describe('dutyGroupNameKey：组名归一（第1组 / 1 / 1组 同属一组）', () => {
  it('带数字的组名按数字归一', () => {
    expect(dutyGroupNameKey('第1组')).toBe(dutyGroupNameKey('1'))
    expect(dutyGroupNameKey('第 2 组')).toBe(dutyGroupNameKey('2'))
    expect(dutyGroupNameKey('第12组')).toBe(dutyGroupNameKey('12'))
    expect(dutyGroupNameKey('第1组')).not.toBe(dutyGroupNameKey('第2组'))
  })

  it('提不出数字的组名按原文匹配', () => {
    expect(dutyGroupNameKey('A组')).toBe(dutyGroupNameKey('A组'))
    expect(dutyGroupNameKey('A组')).not.toBe(dutyGroupNameKey('B组'))
  })
})

/* ========== 分组导入 ========== */

const students: Student[] = [
  mkStudent('s1', '张三', '20250101'),
  mkStudent('s2', '李四', '20250102'),
  mkStudent('s3', '王五', '20250103'),
  mkStudent('s4', '赵六', '20250104'),
  mkStudent('s5', '旦增卓玛', '20250105'),
  mkStudent('s6', '旦增卓玛', '20250106'), // 重名
]

const existingGroups: DutyGroup[] = [
  { id: 'g1', kind: 'group', name: '第 1 组', studentIds: ['s1'] },
  { id: 'g2', kind: 'group', name: '第 2 组', studentIds: [] },
]

function parseGroups(data: unknown[][]) {
  const rows = [['组别', '学号', '姓名'], ...data]
  const parsed = parseDutyGroupRows(rows)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.rows
}

describe('分组导入：正常路径', () => {
  it('学号匹配 → 组员进 plan；未涉及的组保持不变', () => {
    const rows = parseGroups([
      ['1', '20250101', '张三'],
      ['1', '20250102', '李四'],
      ['2', '20250103', '王五'],
    ])
    const plan = planDutyGroupImport(rows, students, existingGroups)
    expect(plan.errorCount).toBe(0)
    expect(plan.plan.updates).toHaveLength(2)
    expect(plan.plan.updates[0]).toMatchObject({ id: 'g1', studentIds: ['s1', 's2'] })
    expect(plan.plan.updates[1]).toMatchObject({ id: 'g2', studentIds: ['s3'] })
    expect(plan.plan.creates).toHaveLength(0)
  })

  it('组别写法宽容（1 / 第1组 / 第 1 组 指向同一个组）', () => {
    const rows = parseGroups([
      ['1', '20250101', '张三'],
      ['第1组', '20250102', '李四'],
      ['第 2 组', '20250103', '王五'],
    ])
    const plan = planDutyGroupImport(rows, students, existingGroups)
    expect(plan.errorCount).toBe(0)
    expect(plan.groupsTouched).toBe(2)
    expect(plan.plan.creates).toHaveLength(0)
  })

  it('没填学号时按姓名匹配（唯一）并给出提示；新组追加到 creates', () => {
    const rows = parseGroups([['第3组', '', '赵六']])
    const plan = planDutyGroupImport(rows, students, existingGroups)
    expect(plan.errorCount).toBe(0)
    expect(plan.plan.creates).toHaveLength(1)
    expect(plan.plan.creates[0]).toMatchObject({ name: '第3组', studentIds: ['s4'] })
    expect(plan.rows[0]?.warnings.some((warning) => warning.includes('姓名'))).toBe(true)
  })

  it('重名且无学号 → 拦下并提示「存在重名学生，请使用学号确认。」', () => {
    const rows = parseGroups([['1', '', '旦增卓玛']])
    const plan = planDutyGroupImport(rows, students, existingGroups)
    expect(plan.importable).toBe(0)
    expect(plan.rows[0]?.errors.some((error) => error.includes('存在重名学生'))).toBe(true)
  })

  it('学号不存在 / 姓名与学号不匹配 → 拦下', () => {
    const rows = parseGroups([
      ['1', '9999', '张三'],
      ['1', '20250101', '李四'],
    ])
    const plan = planDutyGroupImport(rows, students, existingGroups)
    expect(plan.importable).toBe(0)
    expect(plan.rows[0]?.errors.some((error) => error.includes('9999'))).toBe(true)
    expect(plan.rows[1]?.errors.some((error) => error.includes('不匹配'))).toBe(true)
  })

  it('同一学生在表内出现两次 → 第二次拦下（一个学生只属于一个组）', () => {
    const rows = parseGroups([
      ['1', '20250101', '张三'],
      ['2', '20250101', '张三'],
    ])
    const plan = planDutyGroupImport(rows, students, existingGroups)
    expect(plan.importable).toBe(1)
    expect(plan.blocked).toBe(1)
    expect(plan.rows[1]?.errors.some((error) => error.includes('只能属于一个组'))).toBe(true)
  })

  it('学生已属于表外其他组 → 只警告不拦（未涉及的组保持不变）', () => {
    // s1 目前在第 1 组；本表只提到第 2 组把 s1 也排进去 → 第 1 组保持不变 → 两个组都有他
    const rows = parseGroups([['2', '20250101', '张三']])
    const plan = planDutyGroupImport(rows, students, existingGroups)
    expect(plan.errorCount).toBe(0)
    expect(plan.rows[0]?.warnings.some((warning) => warning.includes('第 1 组'))).toBe(true)
  })

  it('错误行不进 plan（错误数据绝不落库）', () => {
    const rows = parseGroups([
      ['1', '20250101', '张三'],
      ['1', '', '不存在的名字'],
    ])
    const plan = planDutyGroupImport(rows, students, existingGroups)
    expect(plan.blocked).toBe(1)
    expect(plan.plan.updates[0]?.studentIds).toEqual(['s1'])
  })
})

/* ========== 安排导入 ========== */

const arrangeGroups: DutyGroup[] = [
  { id: 'g1', kind: 'group', name: '第1组', studentIds: ['s1'] },
  { id: 'g2', kind: 'group', name: '第2组', studentIds: ['s2'] },
  { id: 'g3', kind: 'group', name: '第3组', studentIds: ['s3'] },
]

function parseArrange(data: unknown[][], withWeekday = false) {
  const header = withWeekday ? ['日期', '星期', '组别'] : ['日期', '组别']
  const rows = [header, ...data]
  const parsed = parseDutyArrangeRows(rows)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.rows
}

describe('安排导入：换算成轮换起点 + 组顺序', () => {
  it('正常导入：最早日期为起点，表序决定组顺序（含未提到的组排在其后）', () => {
    const rows = parseArrange([
      ['2026-09-14', '第2组'],
      ['2026-09-15', '第3组'],
      ['2026-09-16', '第1组'],
    ])
    const plan = planDutyArrangeImport(rows, arrangeGroups, { includeWeekend: false })
    expect(plan.errorCount).toBe(0)
    expect(plan.plan.startDate).toBe('2026-09-14')
    expect(plan.plan.startGroupId).toBe('g2')
    // 表序 g2 → g3 → g1；没有未提到的组
    expect(plan.plan.order).toEqual(['g2', 'g3', 'g1'])
    expect(plan.days).toBe(3)
  })

  it('部分组未提到 → 保持相对顺序排在表序之后', () => {
    const rows = parseArrange([
      ['2026-09-14', '第3组'],
      ['2026-09-15', '第1组'],
    ])
    const plan = planDutyArrangeImport(rows, arrangeGroups, { includeWeekend: false })
    expect(plan.errorCount).toBe(0)
    // 表序 g3, g1；g2 未提到 → 排在其后
    expect(plan.plan.order).toEqual(['g3', 'g1', 'g2'])
  })

  it('周末不排时，周六周日自动跳过（周五 → 周一 连续）', () => {
    const rows = parseArrange([
      ['2026-09-11', '第1组'], // 周五
      ['2026-09-14', '第2组'], // 周一
    ])
    const plan = planDutyArrangeImport(rows, arrangeGroups, { includeWeekend: false })
    expect(plan.errorCount).toBe(0)
    // 表序 g1, g2；g3 未提到 → 排在其后（order 恒含全部组）
    expect(plan.plan.order).toEqual(['g1', 'g2', 'g3'])
  })

  it('日期不连续（缺中间的值日日）→ 拦下并说明缺哪天', () => {
    const rows = parseArrange([
      ['2026-09-14', '第1组'],
      ['2026-09-16', '第2组'], // 9-15 缺了
    ])
    const plan = planDutyArrangeImport(rows, arrangeGroups, { includeWeekend: false })
    expect(plan.importable).toBe(1) // 第一行本身合法（UI 层 blocked > 0 会禁用确认）
    expect(plan.blocked).toBe(1)
    expect(plan.rows[1]?.errors.some((error) => error.includes('不连续'))).toBe(true)
  })

  it('无效组别 → 拦下（安排导入不建组）', () => {
    const rows = parseArrange([['2026-09-14', '第9组']])
    const plan = planDutyArrangeImport(rows, arrangeGroups, { includeWeekend: false })
    expect(plan.importable).toBe(0)
    expect(plan.rows[0]?.errors.some((error) => error.includes('第9组'))).toBe(true)
  })

  it('无效日期 / 星期列与日期不符 → 拦下', () => {
    const rows = parseArrange(
      [
        ['不是日期', '第1组'],
        ['2026-09-14', '星期三', '第2组'], // 9-14 是周一
      ],
      true,
    )
    const plan = planDutyArrangeImport(rows, arrangeGroups, { includeWeekend: false })
    expect(plan.importable).toBe(0)
    expect(plan.rows[0]?.errors.some((error) => error.includes('无法识别'))).toBe(true)
    expect(plan.rows[1]?.errors.some((error) => error.includes('与日期不符'))).toBe(true)
  })
})

/* ========== helpers ========== */

function mkStudent(id: string, name: string, studentNo: string): Student {
  return {
    id,
    name,
    studentNo,
    gender: 'male',
    dormitory: '宿舍1',
    cadreRole: '',
    tags: [],
    phone: '',
    familyAddress: '',
    familyScope: 'town',
    seatNumber: null,
    createdAt: '',
    updatedAt: '',
    deletedAt: undefined,
  } as unknown as Student
}
