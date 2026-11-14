/**
 * 违纪统计纯函数自检（v3.8.0 · Phase 1A）。
 *
 * 统计是「错了不报错、只会显示一个像模像样的错数」的典型区域，所以这里把口径逐条钉住：
 *
 * ① **每条事件恒计一次**：严重程度不加权、不折算（同一次严重违纪 = 1，不是 3）。
 * ② **概览的 total 覆盖全部历史**，但**涉及人数只数在读学生**（软删学生不再属于这个班）。
 * ③ **排行**：次数降序 → 姓名升序（稳定中文比较）→ studentId 兜底；软删学生不进排行。
 * ④ **个人档案**按 studentId 算，**软删学生也能算**（历史不丢）。
 * ⑤ 取消分类后：行为只列出现过的、经常违纪 ≥3 且前 10。
 * ⑥ **纯函数不修改入参**。
 */
import { describe, expect, it } from 'vitest'

import type { Student } from '@/types'
import type { ViolationEvent } from '@/types/violation'
import {
  FREQUENT_VIOLATION_LIMIT,
  FREQUENT_VIOLATION_THRESHOLD,
  buildStudentViolationStats,
  buildViolationBehaviorCounts,
  buildViolationCountByStudent,
  buildViolationOverview,
  buildViolationRanking,
  compareZhText,
  countViolationsBySeverity,
  pickFrequentViolationStudents,
  sortBySeverityThenDate,
} from '@/utils/violationStats'

/* ========== 夹具 ========== */

function makeEvent(overrides: Partial<ViolationEvent> & { id: string }): ViolationEvent {
  return {
    studentId: 's1',
    studentName: '张三',
    date: '2026-11-03',
    timeSlotKind: 'forenoon',
    behaviorLabel: '迟到',
    severity: 'minor',
    createdAt: '2026-11-03T01:00:00.000Z',
    updatedAt: '2026-11-03T01:00:00.000Z',
    ...overrides,
  }
}

function student(id: string, name: string, extra: Partial<Student> = {}): Student {
  return { id, name, studentNo: '', gender: 'male', ...extra }
}

/* ==================== 空数组边界 ==================== */

describe('空数组边界（每个函数都要能安全返回空值）', () => {
  it('计数类全 0 / 空集合', () => {
    expect(countViolationsBySeverity([])).toEqual({ minor: 0, moderate: 0, severe: 0 })
    expect(buildViolationOverview([])).toEqual({
      total: 0,
      studentCount: 0,
      severity: { minor: 0, moderate: 0, severe: 0 },
    })
    expect(buildViolationRanking([], [student('s1', '张三')])).toEqual([])
    expect(buildViolationBehaviorCounts([])).toEqual([])
    expect(buildViolationCountByStudent([]).size).toBe(0)
    expect(pickFrequentViolationStudents([])).toEqual([])
  })

  it('取消分类后不再有分类统计（分类字段已从业务模型移除）', () => {
    // 行为统计仍然存在；分类统计 API 已删除
    expect(buildViolationBehaviorCounts([])).toEqual([])
  })

  it('个人统计：无记录的学生返回全 0，而不是 null', () => {
    const stats = buildStudentViolationStats([], 's1')
    expect(stats).toMatchObject({
      studentId: 's1',
      studentName: '',
      total: 0,
      severity: { minor: 0, moderate: 0, severe: 0 },
      lastDate: null,
    })
    expect('categories' in stats).toBe(false)
    expect(stats.behaviors).toEqual([])
  })
})

/* ==================== 严重程度 ==================== */

describe('三级严重程度各自计数（每条事件只落一个等级）', () => {
  it('一般 / 较严重 / 严重分别计数，总和等于事件数', () => {
    const events = [
      makeEvent({ id: 'a', severity: 'minor' }),
      makeEvent({ id: 'b', severity: 'minor' }),
      makeEvent({ id: 'c', severity: 'moderate' }),
      makeEvent({ id: 'd', severity: 'severe' }),
    ]
    expect(countViolationsBySeverity(events)).toEqual({ minor: 2, moderate: 1, severe: 1 })
  })

  it('严重程度不加权：一条严重违纪也只计 1 次', () => {
    const events = [
      makeEvent({ id: 'a', severity: 'severe' }),
      makeEvent({ id: 'b', severity: 'minor' }),
    ]
    const overview = buildViolationOverview(events)
    expect(overview.total).toBe(2)
    expect(overview.severity.minor + overview.severity.moderate + overview.severity.severe).toBe(
      overview.total,
    )
  })
})

/* ==================== 概览 ==================== */

describe('概览：total 全部历史，人数只数在读', () => {
  const students = [student('s1', '张三'), student('s2', '李四')]
  const events = [
    makeEvent({ id: 'a', studentId: 's1' }),
    makeEvent({ id: 'b', studentId: 's1' }),
    makeEvent({ id: 'c', studentId: 's2' }),
    // 已软删除学生（不在 students 名册里）
    makeEvent({ id: 'd', studentId: 'gone' }),
  ]

  it('total / 三级数量覆盖全部历史（含已删除学生的记录）', () => {
    const overview = buildViolationOverview(events, new Set(students.map((item) => item.id)))
    expect(overview.total).toBe(4)
  })

  it('涉及学生人数只数在读学生（软删学生不计入）', () => {
    const overview = buildViolationOverview(events, new Set(students.map((item) => item.id)))
    expect(overview.studentCount).toBe(2)
    // 不传限制时退化为「全部 distinct」（纯函数测试 / 「全部」口径用）
    expect(buildViolationOverview(events).studentCount).toBe(3)
  })
})

/* ==================== 排行 ==================== */

describe('学生违纪次数排行', () => {
  const students = [
    student('s-an', '安琪'),
    student('s-bai', '白玛'),
    student('s-chen', '陈晨'),
    student('s-zhang', '张伟'),
  ]

  it('次数降序', () => {
    const ranking = buildViolationRanking(
      [
        makeEvent({ id: '1', studentId: 's-zhang' }),
        makeEvent({ id: '2', studentId: 's-an' }),
        makeEvent({ id: '3', studentId: 's-an' }),
        makeEvent({ id: '4', studentId: 's-bai' }),
      ],
      students,
    )
    expect(ranking.map((row) => [row.studentId, row.count])).toEqual([
      ['s-an', 2],
      ['s-bai', 1],
      ['s-zhang', 1],
    ])
  })

  it('同次数时姓名升序（中文拼音比较，不受插入顺序影响）', () => {
    const ranking = buildViolationRanking(
      [
        makeEvent({ id: '1', studentId: 's-zhang' }),
        makeEvent({ id: '2', studentId: 's-chen' }),
        makeEvent({ id: '3', studentId: 's-bai' }),
        makeEvent({ id: '4', studentId: 's-an' }),
      ],
      students,
    )
    expect(ranking.map((row) => row.studentName)).toEqual(['安琪', '白玛', '陈晨', '张伟'])
  })

  it('同名同次数时用 studentId 兜底，顺序稳定可复现', () => {
    const twins = [student('s-b', '安琪'), student('s-a', '安琪')]
    const build = () =>
      buildViolationRanking([makeEvent({ id: '1', studentId: 's-b' })], twins).map(
        (row) => row.studentId,
      )
    expect(build()).toEqual(['s-b'])
    // 两人各一条记录：同名同次数 → id 升序
    const both = buildViolationRanking(
      [makeEvent({ id: '1', studentId: 's-b' }), makeEvent({ id: '2', studentId: 's-a' })],
      twins,
    )
    expect(both.map((row) => row.studentId)).toEqual(['s-a', 's-b'])
  })

  it('只有有违纪记录的学生进排行（0 次不出现）', () => {
    const ranking = buildViolationRanking([makeEvent({ id: '1', studentId: 's-an' })], students)
    expect(ranking).toHaveLength(1)
    expect(ranking[0]?.studentId).toBe('s-an')
  })

  it('已软删除学生不进入在读学生排行，但记录本身不影响其他人的计数', () => {
    // 名册里没有 gone（= 已软删 / 已退档）
    const ranking = buildViolationRanking(
      [
        makeEvent({ id: '1', studentId: 'gone' }),
        makeEvent({ id: '2', studentId: 'an', studentName: '安琪' }),
      ],
      [student('an', '安琪')],
    )
    expect(ranking.map((row) => row.studentId)).toEqual(['an'])
    expect(ranking[0]?.count).toBe(1)
  })

  it('排行带上该生三级数量与最近违纪日期', () => {
    const ranking = buildViolationRanking(
      [
        makeEvent({ id: '1', studentId: 's-an', severity: 'severe', date: '2026-11-01' }),
        makeEvent({ id: '2', studentId: 's-an', severity: 'minor', date: '2026-11-08' }),
      ],
      students,
    )
    expect(ranking[0]).toMatchObject({
      studentId: 's-an',
      count: 2,
      severity: { minor: 1, moderate: 0, severe: 1 },
      lastDate: '2026-11-08',
    })
  })

  it('重名学生的展示名带身份证尾号，但排序仍按原始姓名', () => {
    const twins = [
      student('s-1', '安琪', { idCardSuffix: '1111' }),
      student('s-2', '安琪', { idCardSuffix: '2222' }),
    ]
    const ranking = buildViolationRanking(
      [makeEvent({ id: '1', studentId: 's-1' }), makeEvent({ id: '2', studentId: 's-2' })],
      twins,
    )
    expect(ranking.map((row) => row.studentName).sort()).toEqual(['安琪（1111）', '安琪（2222）'])
  })
})

/* ==================== 经常违纪 ==================== */

describe('经常违纪学生：≥3 次、前 10 名', () => {
  it('门槛与上限就是需求给定的常数', () => {
    expect(FREQUENT_VIOLATION_THRESHOLD).toBe(3)
    expect(FREQUENT_VIOLATION_LIMIT).toBe(10)
  })

  it('2 次不进、3 次进；超过 10 人只取前 10', () => {
    const students: Student[] = []
    const events: ViolationEvent[] = []
    for (let index = 1; index <= 12; index += 1) {
      // 名字用数字补零，保证中文比较之外的稳定顺序（ID 兜底）
      students.push(student(`s${index}`, `学生${index}`))
      const times = index === 1 ? 2 : 3
      for (let count = 0; count < times; count += 1) {
        events.push(makeEvent({ id: `e-${index}-${count}`, studentId: `s${index}` }))
      }
    }
    const frequent = pickFrequentViolationStudents(buildViolationRanking(events, students))
    expect(frequent).toHaveLength(FREQUENT_VIOLATION_LIMIT)
    expect(frequent.every((row) => row.count >= FREQUENT_VIOLATION_THRESHOLD)).toBe(true)
    expect(frequent.some((row) => row.studentId === 's1')).toBe(false)
  })
})

/* ==================== 具体事件统计（v3.8.1 取消分类后） ==================== */

describe('按具体事件统计', () => {
  const events = [
    makeEvent({ id: '1', behaviorLabel: '迟到' }),
    makeEvent({ id: '2', behaviorLabel: '迟到' }),
    makeEvent({ id: '3', behaviorLabel: '卫生脏乱' }),
    makeEvent({ id: '4', behaviorLabel: '打架' }),
  ]

  it('具体事件按次数降序、同次数按文本升序（只列出现过的）', () => {
    const rows = buildViolationBehaviorCounts(events)
    expect(rows).toEqual([
      { behaviorLabel: '迟到', count: 2 },
      { behaviorLabel: '打架', count: 1 },
      { behaviorLabel: '卫生脏乱', count: 1 },
    ])
  })

  it('自定义行为与预设行为一视同仁（按 behaviorLabel 归类）', () => {
    const rows = buildViolationBehaviorCounts([
      makeEvent({ id: '1', behaviorLabel: '在走廊追逐' }),
      makeEvent({ id: '2', behaviorLabel: '在走廊追逐' }),
      makeEvent({ id: '3', behaviorLabel: '迟到' }),
    ])
    expect(rows[0]).toEqual({ behaviorLabel: '在走廊追逐', count: 2 })
  })
})

/* ==================== 学生选择器次数映射 ==================== */

describe('学生违纪次数映射（选择器显示用）', () => {
  it('按 studentId 累计，包含已软删除学生（由调用方按名册取用）', () => {
    const map = buildViolationCountByStudent([
      makeEvent({ id: '1', studentId: 's1' }),
      makeEvent({ id: '2', studentId: 's1' }),
      makeEvent({ id: '3', studentId: 'gone' }),
    ])
    expect(map.get('s1')).toBe(2)
    expect(map.get('gone')).toBe(1)
    expect(map.get('nobody')).toBeUndefined()
  })
})

/* ==================== 个人档案 ==================== */

describe('单个学生的完整违纪统计（个人档案）', () => {
  const realEvents = [
    makeEvent({
      id: '1',
      studentId: 's1',
      severity: 'minor',
      behaviorLabel: '迟到',
      date: '2026-11-01',
      createdAt: '2026-11-01T01:00:00.000Z',
    }),
    makeEvent({
      id: '2',
      studentId: 's1',
      severity: 'severe',
      behaviorLabel: '打架',
      studentName: '张三（旧快照）',
      date: '2026-11-09',
      createdAt: '2026-11-09T01:00:00.000Z',
    }),
    makeEvent({ id: '3', studentId: 's2', severity: 'moderate' }),
  ]

  it('按 studentId 汇总：次数 / 三级 / 行为 / 最近日期', () => {
    const stats = buildStudentViolationStats(realEvents, 's1')
    expect(stats).toMatchObject({
      studentId: 's1',
      total: 2,
      severity: { minor: 1, moderate: 0, severe: 1 },
      lastDate: '2026-11-09',
    })
    expect('categories' in stats).toBe(false)
    // 同次数按中文拼音升序：迟(chi) 在 打(da) 之前
    expect(stats.behaviors).toEqual([
      { behaviorLabel: '迟到', count: 1 },
      { behaviorLabel: '打架', count: 1 },
    ])
  })

  it('姓名取最近一条事件的快照（学生已被彻底移除时仍能显示是谁）', () => {
    const stats = buildStudentViolationStats(realEvents, 's1')
    expect(stats.studentName).toBe('张三（旧快照）')
  })

  it('已软删除学生的个人历史仍然可查（口径 ③：记录不随学生删除消失）', () => {
    const deletedStudentEvents = [
      ...realEvents,
      makeEvent({
        id: '4',
        studentId: 'deleted-1',
        studentName: '已退档同学',
        severity: 'moderate',
        date: '2026-11-05',
      }),
    ]
    // 名册里没有 deleted-1（软删），但个人档案按 studentId 仍能算出完整历史
    const stats = buildStudentViolationStats(deletedStudentEvents, 'deleted-1')
    expect(stats.total).toBe(1)
    expect(stats.studentName).toBe('已退档同学')
    expect(stats.severity.moderate).toBe(1)
    expect(stats.lastDate).toBe('2026-11-05')
  })
})

/* ==================== 排序辅助 / 比较器 ==================== */

describe('展示排序与中文比较', () => {
  it('严重程度从重到轻，同级按日期倒序（只影响展示分组，不改变计数）', () => {
    const sorted = sortBySeverityThenDate([
      makeEvent({ id: 'minor', severity: 'minor', date: '2026-11-09' }),
      makeEvent({ id: 'severe-old', severity: 'severe', date: '2026-11-01' }),
      makeEvent({ id: 'severe-new', severity: 'severe', date: '2026-11-08' }),
      makeEvent({ id: 'moderate', severity: 'moderate', date: '2026-11-02' }),
    ])
    expect(sorted.map((item) => item.id)).toEqual(['severe-new', 'severe-old', 'moderate', 'minor'])
  })

  it('中文比较稳定且数字按数值排（学生2 在 学生10 之前）', () => {
    expect(compareZhText('学生2', '学生10')).toBeLessThan(0)
    expect(compareZhText('安琪', '白玛')).toBeLessThan(0)
    expect(compareZhText('张三', '张三')).toBe(0)
  })
})

/* ==================== 纯度 ==================== */

describe('纯函数不修改入参', () => {
  it('排行 / 事件统计 / 严重排序都不动原数组顺序', () => {
    const events = [
      makeEvent({ id: 'a', studentId: 's2', severity: 'severe' }),
      makeEvent({ id: 'b', studentId: 's1', severity: 'minor' }),
      makeEvent({ id: 'c', studentId: 's1', severity: 'severe' }),
    ]
    const before = events.map((item) => item.id)
    buildViolationRanking(events, [student('s1', '张三'), student('s2', '李四')])
    buildViolationBehaviorCounts(events)
    sortBySeverityThenDate(events)
    expect(events.map((item) => item.id)).toEqual(before)
  })
})
