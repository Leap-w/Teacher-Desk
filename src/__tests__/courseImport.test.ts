/**
 * 课程表 Excel 导入（V1.1.3）自检。
 *
 * 覆盖：
 * ① 节次 / 星期解析（10 个时段、晚自习别名、序号 1~10 与旧 1~8）；
 * ② 解析错误（表头缺列、空行、非法行/列、非空星期、非法类型）；
 * ③ 计划层：导入表内重复时段 → 拦下；代课缺原教师 → 拦下；
 * ④ 落库语义：仅涉及导入的时段被替换（**逐条应用**），未涉及的时段保持原样；
 * ⑤ 晚自习组：同班同科三节齐备 → 共享 `courseGroupId`。
 */
import { describe, expect, it } from 'vitest'

import {
  COURSE_IMPORT_SAMPLE,
  parseCourseRows,
  planCourseImport,
  resolvePeriodId,
  resolveWeekday,
} from '@/services/courseImport'
import type { Lesson } from '@/types/timetable'

/* ========== 解析工具 ========== */

describe('resolveWeekday / resolvePeriodId', () => {
  it('resolveWeekday：周X / 星期X / 周几 / 数字都识别', () => {
    expect(resolveWeekday('周一')).toBe(1)
    expect(resolveWeekday('星期一')).toBe(1)
    expect(resolveWeekday('周三')).toBe(3)
    expect(resolveWeekday('周日')).toBe(7)
    expect(resolveWeekday('周天')).toBe(7)
    expect(resolveWeekday('7')).toBe(7)
    expect(resolveWeekday('不合法')).toBeNull()
    expect(resolveWeekday('')).toBeNull()
  })

  it('resolvePeriodId：早自习及第一节 / 第N节 / 晚自习X / 数字 1~10 都识别', () => {
    expect(resolvePeriodId('早自习及第一节')).toBe('morning')
    expect(resolvePeriodId('第5节')).toBe('p5')
    expect(resolvePeriodId('5')).toBe('p5')
    expect(resolvePeriodId('晚自习1')).toBe('evening1')
    expect(resolvePeriodId('晚自习3')).toBe('evening3')
    expect(resolvePeriodId('不合法')).toBeNull()
    expect(resolvePeriodId('')).toBeNull()
  })
})

/* ========== 正常导入 ========== */

describe('正常导入：3 行合法数据 → 全可导入', () => {
  const rows: unknown[][] = [
    ['星期', '节次', '班级', '科目', '类型', '原教师'],
    ['周一', '第5节', '高一9班', '数学', '正常', ''],
    ['周二', '第3节', '高一9班', '数学', '代课', '张老师'],
    ['周三', '晚自习1', '高一9班', '数学', '正常', ''],
  ]
  const parsed = parseCourseRows(rows)
  if (!parsed.ok) throw new Error('parse failed')

  it('parseCourseRows：解析全部成功', () => {
    expect(parsed.ok).toBe(true)
    expect(parsed.rows).toHaveLength(3)
    expect(parsed.columns).toContain('星期')
    expect(parsed.columns).toContain('节次')
  })

  it('planCourseImport：无错误 + 3 行可导入（新增 3，覆盖 0）', () => {
    const plan = planCourseImport(parsed.rows, [])
    expect(plan.errorCount).toBe(0)
    expect(plan.importable).toBe(3)
    expect(plan.added).toBe(3)
    expect(plan.replaced).toBe(0)
    expect(plan.substituted).toBe(1) // 周二第3节是代课
  })
})

/* ========== 错误行 ========== */

describe('错误行被拦下且不写入 plan', () => {
  it('非空表头缺失「星期」→ 整批拒', () => {
    const rows: unknown[][] = [
      ['节次', '班级', '科目', '类型', '原教师'],
      ['第5节', '高一9班', '数学', '正常', ''],
    ]
    const result = parseCourseRows(rows)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected parse failure')
    expect(result.error).toContain('星期')
  })

  it('非法星期、非法类型、代课缺原教师 → 全部归入 errors', () => {
    const rows: unknown[][] = [
      ['星期', '节次', '班级', '科目', '类型', '原教师'],
      ['周九', '第5节', '高一9班', '数学', '正常', ''],
      ['周一', '第99节', '高一9班', '数学', '正常', ''],
      ['周一', '第5节', '', '数学', '正常', ''],
      ['周一', '第5节', '高一9班', '', '正常', ''],
      ['周一', '第5节', '高一9班', '数学', '未知类型', ''],
      ['周一', '第5节', '高一9班', '数学', '代课', ''], // 代课缺原教师
    ]
    const parsed = parseCourseRows(rows)
    if (!parsed.ok) throw new Error('parse failed')
    const plan = planCourseImport(parsed.rows, [])
    // 6 行全有错误 → 0 行可导入
    expect(plan.importable).toBe(0)
    expect(plan.errorCount).toBeGreaterThan(0)
    expect(plan.plan.lessons).toHaveLength(0)
  })
})

/* ========== 重复时段 ========== */

describe('同表内重复时段 → 拦下，不写入 plan', () => {
  it('「周一 第5节」出现两次：第二次标记为 blocked，plan 只含一条', () => {
    const rows: unknown[][] = [
      ['星期', '节次', '班级', '科目', '类型', '原教师'],
      ['周一', '第5节', '高一9班', '数学', '正常', ''],
      ['周一', '第5节', '高一7班', '数学', '正常', ''],
    ]
    const parsed = parseCourseRows(rows)
    if (!parsed.ok) throw new Error('parse failed')
    const plan = planCourseImport(parsed.rows, [])
    expect(plan.duplicateSlots).toBe(1)
    expect(plan.importable).toBe(1)
    expect(plan.plan.lessons).toHaveLength(1)
  })
})

/* ========== 落库语义：逐条应用 ========== */

describe('逐条应用：导入只替换涉及到的时段，未涉及的保持原样', () => {
  it('已有「周一 第5节」→ 导入「周一 第5节」会替换；其他时段不动', () => {
    const existing: Lesson[] = [
      mkLesson({ id: 'A', weekday: 1, periodId: 'p5', subject: '旧科目', className: '高一9班' }),
      mkLesson({ id: 'B', weekday: 2, periodId: 'p3', subject: '不动', className: '高一9班' }),
    ]
    const rows: unknown[][] = [
      ['星期', '节次', '班级', '科目', '类型', '原教师'],
      ['周一', '第5节', '高一9班', '新科目', '正常', ''],
    ]
    const parsed = parseCourseRows(rows)
    if (!parsed.ok) throw new Error('parse failed')
    const plan = planCourseImport(parsed.rows, existing)
    expect(plan.added).toBe(0)
    expect(plan.replaced).toBe(1)
    // 模拟 applyCourseImport 的语义（实际入口在 store）
    const slotKey = '1-p5'
    const next = existing
      .filter((lesson) => `${lesson.weekday}-${lesson.periodId}` !== slotKey)
      .concat(plan.plan.lessons.map((input, index) => ({ ...input, id: `n${index}` })))
    expect(next.find((lesson) => lesson.id === 'B')).toBeDefined()
    expect(next.find((lesson) => lesson.weekday === 1 && lesson.periodId === 'p5')?.subject).toBe(
      '新科目',
    )
  })
})

/* ========== 晚自习组 ========== */

describe('同班同科三节晚自习齐备 → 共享 courseGroupId', () => {
  it('导入的三节晚自习自动归组', () => {
    const rows: unknown[][] = [
      ['星期', '节次', '班级', '科目', '类型', '原教师'],
      ['周三', '晚自习1', '高一9班', '数学', '正常', ''],
      ['周三', '晚自习2', '高一9班', '数学', '正常', ''],
      ['周三', '晚自习3', '高一9班', '数学', '正常', ''],
    ]
    const parsed = parseCourseRows(rows)
    if (!parsed.ok) throw new Error('parse failed')
    const plan = planCourseImport(parsed.rows, [])
    expect(plan.eveningGrouped).toBe(3)
    const groups = new Set(plan.plan.lessons.map((lesson) => lesson.courseGroupId).filter(Boolean))
    expect(groups.size).toBe(1)
  })

  it('只导入两节晚自习 → 不归组（业务上未组成「同一科目连续晚自习」）', () => {
    const rows: unknown[][] = [
      ['星期', '节次', '班级', '科目', '类型', '原教师'],
      ['周三', '晚自习1', '高一9班', '数学', '正常', ''],
      ['周三', '晚自习2', '高一9班', '数学', '正常', ''],
    ]
    const parsed = parseCourseRows(rows)
    if (!parsed.ok) throw new Error('parse failed')
    const plan = planCourseImport(parsed.rows, [])
    expect(plan.eveningGrouped).toBe(0)
    expect(plan.plan.lessons.every((lesson) => !lesson.courseGroupId)).toBe(true)
  })
})

/* ========== 模板示例本身合法 ========== */

describe('模板示例 COURSE_IMPORT_SAMPLE 全部合法', () => {
  it('解析无错', () => {
    const header = ['星期', '节次', '班级', '科目', '类型', '原教师']
    const dataRows: unknown[][] = COURSE_IMPORT_SAMPLE.map((row) => [...row])
    const rows: unknown[][] = [header, ...dataRows]
    const parsed = parseCourseRows(rows)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const plan = planCourseImport(parsed.rows, [])
    expect(plan.errorCount).toBe(0)
    expect(plan.importable).toBe(COURSE_IMPORT_SAMPLE.length)
  })
})

function mkLesson(overrides: Partial<Lesson>): Lesson {
  return {
    id: 'x',
    weekday: 1,
    periodId: 'morning',
    subject: '默认',
    className: '高一9班',
    classId: 'class-高一9班',
    teacher: '我',
    type: 'normal',
    ...overrides,
  }
}
