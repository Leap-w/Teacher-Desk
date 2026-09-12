/**
 * SeatPlan 座位模型自检（V1.1.2 Phase 1 起，Phase 2 补「关系判定唯一来源」）。
 *
 * 覆盖几类**错了会静默出错**的东西：
 *  ① 坐标合法性：越界坐标一旦被接受，就会在别的行 / 列上覆盖一个真学生的座位；
 *  ② 视角转换：`(row, col) → (8-row, 10-col)` 必须是**自逆**的 180° 旋转——
 *     写错方向时页面照样能显示，只是学生视角与老师视角的左右是反的，
 *     教师不会发现，直到排座时按错方位叫人；
 *  ③ 同桌 / 相邻：真实教室里「1/2/3 是一桌」（隔着一个人也算同桌），
 *     而过道两侧既不同桌也不相邻——判错会让教师看到假的「没问题」；
 *  ④ 单一来源：方案级检查器、全局检查器、自动排座求解器必须给出同一结论
 *     （两套算法并存时，同一个座位布局会在两个面板上显示不同的结果）；
 *  ⑤ 旧数据兼容：缺 `constraints` 的方案要能照常打开，缺 row/col 的更早期数据要按
 *     数组顺序**确定性**还原，绝不丢学生。
 */
import { describe, expect, it } from 'vitest'

import { DEFAULT_CLASSROOM_CONFIG as CFG } from '@/types/classroom'
import {
  areSeatsAdjacent,
  areSeatsSameDesk,
  BACK_ROW_MIN,
  buildSeatGrid,
  createEmptySeatPlanConstraints,
  createSeat,
  deskGroupKey,
  FRONT_ROW_LIMIT,
  getSeatKey,
  isBackRowSeat,
  isFrontRowSeat,
  isValidSeatPosition,
  normalizeSeatPlan,
  seatOrdinal,
} from '@/utils/seat'
import {
  doorSidesOf,
  positionAtViewSlot,
  transformSeatPosition,
  viewColOrder,
  viewPhysicalRow,
  viewPositionOf,
  viewRoomItems,
  viewRowUnits,
  windowSideOf,
} from '@/utils/seatView'
import { checkSeatConstraints } from '@/utils/constraint'
import { validateSeatPlanConstraints } from '@/utils/seatPlanConstraint'
import { arrangeSeats } from '@/utils/seatArrange'
import type { Seat, SeatPlan, SeatPlanConstraints, SeatView } from '@/types/seat'
import type { Student } from '@/types'

function makeStudent(id: string, name: string, studentNo = ''): Student {
  return { id, name, studentNo, gender: 'female' }
}

/** 只带必要字段的方案：seats 由调用方给定 */
function makePlan(seats: Seat[], constraints?: Partial<SeatPlanConstraints>): SeatPlan {
  return {
    id: 'p1',
    name: '测试方案',
    createdAt: '',
    updatedAt: '',
    isCurrent: true,
    seats,
    changeLogs: [],
    constraints: { ...createEmptySeatPlanConstraints(), ...constraints },
  }
}

/**
 * 盘上的旧数据**本来就不满足 SeatPlan 的形状**（没有 block、没有 constraints、
 * 更早期连 row / col 都没有），所以这里刻意按「脏数据」传进去——
 * 被测的正是 normalizeSeatPlan 面对真实历史数据时的兜底。
 */
function normalizeLegacy(raw: unknown): SeatPlan {
  return normalizeSeatPlan(raw as Partial<SeatPlan>)
}

/** 63 个空座位 → id 查表 */
function emptySeatsById(): Map<string, Seat> {
  return new Map(buildSeatGrid().map((seat) => [seat.id, seat]))
}

describe('坐标：真实教室只有 7 × 9', () => {
  it('(1,1) 与 (7,9) 合法，(0,1) / (8,1) / (1,10) 一律非法', () => {
    expect(isValidSeatPosition(1, 1, CFG)).toBe(true)
    expect(isValidSeatPosition(7, 9, CFG)).toBe(true)
    expect(isValidSeatPosition(0, 1, CFG)).toBe(false)
    expect(isValidSeatPosition(8, 1, CFG)).toBe(false)
    expect(isValidSeatPosition(1, 10, CFG)).toBe(false)
  })

  it('非整数 / 非数字一律非法（Excel 里的 "1.5" 不该被当成第 1 排）', () => {
    expect(isValidSeatPosition(1.5, 2, CFG)).toBe(false)
    expect(isValidSeatPosition('1', 2, CFG)).toBe(false)
    expect(isValidSeatPosition(undefined, 2, CFG)).toBe(false)
  })

  it('座位键由物理坐标决定（不是数组下标、更不是学生姓名），且与 seatIdOf 同源', () => {
    expect(getSeatKey(1, 1)).toBe('r1c1')
    expect(getSeatKey(7, 9)).toBe('r7c9')
    // 座位号（行优先序）与坐标一一对应：(7,9) = 第 63 号
    expect(seatOrdinal(7, 9, CFG)).toBe(63)
    expect(seatOrdinal(1, 1, CFG)).toBe(1)
  })
})

describe('视角：老师视角与学生视角是 180° 旋转', () => {
  it('需求给定的四个角点都能对上（含正中心的原地不动）', () => {
    expect(transformSeatPosition(1, 1, CFG)).toEqual({ row: 7, col: 9 })
    expect(transformSeatPosition(1, 9, CFG)).toEqual({ row: 7, col: 1 })
    expect(transformSeatPosition(7, 1, CFG)).toEqual({ row: 1, col: 9 })
    expect(transformSeatPosition(7, 9, CFG)).toEqual({ row: 1, col: 1 })
    // (4,5) 是 7×9 的正中心，旋转后仍是自己
    expect(transformSeatPosition(4, 5, CFG)).toEqual({ row: 4, col: 5 })
  })

  it('变换可逆：transform(transform(p)) === p（否则来回切视角会越切越偏）', () => {
    for (let row = 1; row <= CFG.rows; row++) {
      for (let col = 1; col <= CFG.cols; col++) {
        const once = transformSeatPosition(row, col, CFG)
        expect(transformSeatPosition(once.row, once.col, CFG)).toEqual({ row, col })
      }
    }
  })

  it('老师视角 = 物理坐标本身；学生视角 = 旋转后的坐标（两个方向互为逆）', () => {
    expect(viewPositionOf(2, 3, 'teacher', CFG)).toEqual({ row: 2, col: 3 })
    expect(viewPositionOf(2, 3, 'student', CFG)).toEqual({ row: 6, col: 7 })
    expect(positionAtViewSlot(6, 7, 'student', CFG)).toEqual({ row: 2, col: 3 })
    expect(positionAtViewSlot(2, 3, 'teacher', CFG)).toEqual({ row: 2, col: 3 })
  })

  it('老师视角第 1 排 → 学生视角第 7 排（前后翻转）', () => {
    expect(viewPhysicalRow(1, 'teacher', CFG)).toBe(1)
    expect(viewPhysicalRow(1, 'student', CFG)).toBe(7)
    expect(viewPhysicalRow(7, 'student', CFG)).toBe(1)
  })

  it('列顺序：老师 1→9，学生 9→1（左右翻转）', () => {
    expect(viewColOrder('teacher', CFG)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(viewColOrder('student', CFG)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1])
  })

  it('渲染布局：老师视角第 1 排是 1 2 3 | 4 5 6 | 7 8 9，学生视角第 1 排是 9 8 7 | 6 5 4 | 3 2 1', () => {
    const seatsById = emptySeatsById()

    const teacherUnits = viewRowUnits(1, 'teacher', CFG, seatsById)
    // 列块 / 过道 / 列块 / 过道 / 列块 —— 两条纵向过道固定夹在三个区域之间
    expect(teacherUnits.map((unit) => unit.kind)).toEqual([
      'block',
      'aisle',
      'block',
      'aisle',
      'block',
    ])
    expect(teacherUnits[0]).toMatchObject({ kind: 'block' })
    expect(
      teacherUnits
        .filter((unit) => unit.kind === 'block')
        .flatMap((unit) => (unit.kind === 'block' ? unit.seats.map((seat) => seat.id) : [])),
    ).toEqual(['r1c1', 'r1c2', 'r1c3', 'r1c4', 'r1c5', 'r1c6', 'r1c7', 'r1c8', 'r1c9'])

    const studentUnits = viewRowUnits(1, 'student', CFG, seatsById)
    expect(
      studentUnits
        .filter((unit) => unit.kind === 'block')
        .flatMap((unit) => (unit.kind === 'block' ? unit.seats.map((seat) => seat.id) : [])),
    ).toEqual(['r7c9', 'r7c8', 'r7c7', 'r7c6', 'r7c5', 'r7c4', 'r7c3', 'r7c2', 'r7c1'])
  })

  it('房间单元顺序：老师视角讲台在上、后门收底；学生视角整体旋转 180°', () => {
    const teacher = viewRoomItems('teacher', CFG).map((item) => item.key)
    const student = viewRoomItems('student', CFG).map((item) => item.key)
    expect(teacher[0]).toBe('podium')
    expect(teacher[1]).toBe('door-front')
    expect(teacher.at(-1)).toBe('door-back')
    expect(student[0]).toBe('door-back')
    expect(student.at(-1)).toBe('podium')
    // 排的顺序整体反过来
    expect(teacher.slice(2, -1)).toEqual([
      'row-1',
      'row-2',
      'row-3',
      'row-4',
      'row-5',
      'row-6',
      'row-7',
    ])
    expect(student.slice(1, -2)).toEqual([
      'row-7',
      'row-6',
      'row-5',
      'row-4',
      'row-3',
      'row-2',
      'row-1',
    ])
  })

  it('两门同在配置所写的那面墙（真实教室：右墙），学生视角镜像到左墙', () => {
    expect(doorSidesOf('teacher', CFG)).toEqual({ front: 'right', back: 'right' })
    expect(doorSidesOf('student', CFG)).toEqual({ front: 'left', back: 'left' })
    expect(windowSideOf('teacher', CFG)).toBe('right')
    expect(windowSideOf('student', CFG)).toBe('left')
  })
})

describe('同桌：同排同列块 = 同一张长桌（V1.1.2 Phase 2 起的唯一定义）', () => {
  const s1 = createSeat(1, 1)
  const s2 = createSeat(1, 2)
  const s3 = createSeat(1, 3)
  const s4 = createSeat(1, 4)
  const s5 = createSeat(1, 5)
  const s6 = createSeat(1, 6)
  const s7 = createSeat(1, 7)
  const s9 = createSeat(1, 9)

  it('r1c1 ↔ r1c2 / r1c1 ↔ r1c3 都是同桌（隔着一个人也算）', () => {
    expect(areSeatsSameDesk(s1, s2)).toBe(true)
    expect(areSeatsSameDesk(s1, s3)).toBe(true)
  })

  it('r1c4 ↔ r1c5、r1c7 ↔ r1c9 都是同桌', () => {
    expect(areSeatsSameDesk(s4, s5)).toBe(true)
    expect(areSeatsSameDesk(s7, s9)).toBe(true)
    expect(areSeatsSameDesk(s4, s6)).toBe(true)
  })

  it('过道两侧不是同桌：r1c3 ↔ r1c4、r1c6 ↔ r1c7', () => {
    expect(areSeatsSameDesk(s3, s4)).toBe(false)
    expect(areSeatsSameDesk(s6, s7)).toBe(false)
  })

  it('跨排不是同桌', () => {
    expect(areSeatsSameDesk(s1, createSeat(2, 1))).toBe(false)
    expect(areSeatsSameDesk(s7, s1)).toBe(false)
    expect(deskGroupKey(s1)).toBe(deskGroupKey(s2))
    expect(deskGroupKey(s1)).not.toBe(deskGroupKey(s4))
  })
})

describe('邻接：四邻域（上下左右），不含斜对角、不含跨过道', () => {
  const origin = createSeat(2, 2)

  it('上下左右相邻成立', () => {
    expect(areSeatsAdjacent(origin, createSeat(2, 3))).toBe(true)
    expect(areSeatsAdjacent(origin, createSeat(2, 1))).toBe(true)
    expect(areSeatsAdjacent(origin, createSeat(3, 2))).toBe(true)
    expect(areSeatsAdjacent(origin, createSeat(1, 2))).toBe(true)
  })

  it('非相邻：隔一个座位、隔一排、斜对角、自己与自己都不算', () => {
    expect(areSeatsAdjacent(origin, createSeat(2, 4))).toBe(false)
    expect(areSeatsAdjacent(origin, createSeat(4, 2))).toBe(false)
    expect(areSeatsAdjacent(origin, createSeat(3, 3))).toBe(false)
    expect(areSeatsAdjacent(origin, origin)).toBe(false)
  })

  it('跨过道不算相邻（3 ↔ 4、6 ↔ 7，V1.1.2 Phase 2 修正）', () => {
    expect(areSeatsAdjacent(createSeat(1, 3), createSeat(1, 4))).toBe(false)
    expect(areSeatsAdjacent(createSeat(1, 6), createSeat(1, 7))).toBe(false)
    // 同一列块内仍然相邻（3 与 2、4 与 5 挨着）
    expect(areSeatsAdjacent(createSeat(1, 2), createSeat(1, 3))).toBe(true)
    expect(areSeatsAdjacent(createSeat(1, 4), createSeat(1, 5))).toBe(true)
    // 过道不阻断前后：跨排同列照旧相邻
    expect(areSeatsAdjacent(createSeat(1, 4), createSeat(2, 4))).toBe(true)
  })
})

describe('过道：3 与 4、6 与 7 在**所有**入口下都不算同桌 / 相邻', () => {
  const students = new Map<string, Student>([
    ['a', makeStudent('a', '甲', '0101')],
    ['b', makeStudent('b', '乙', '0102')],
    ['c', makeStudent('c', '丙', '0103')],
  ])

  /** 甲坐 3 号（左区尾座）、乙坐 4 号（中区首座）、丙在远处：甲乙之间隔着左边那条过道 */
  function acrossAislePlan(bCol = 4): SeatPlan {
    const seats = buildSeatGrid().map((seat) => {
      if (seat.id === 'r1c3') return { ...seat, studentId: 'a' }
      if (seat.id === `r1c${bCol}`) return { ...seat, studentId: 'b' }
      if (seat.id === 'r5c5') return { ...seat, studentId: 'c' }
      return seat
    })
    return makePlan(seats, {
      adjacentGroupForbidden: [{ id: 'g', students: ['a', 'b', 'c'] }],
      sameDeskForbidden: [{ id: 'x', studentA: 'a', studentB: 'b' }],
    })
  }

  it('过道两侧既不报「同桌冲突」也不报「三人相邻」', () => {
    const report = validateSeatPlanConstraints(acrossAislePlan(4), students)
    expect(report.errors).toHaveLength(0)
    expect(report.ok).toBe(true)
  })

  it('全局检查器的 no-adjacent / no-deskmate 同样不报（两个入口同一结论）', () => {
    const plan = acrossAislePlan(4)
    const issues = checkSeatConstraints({
      constraints: [
        { id: 'c1', studentA: 'a', studentB: 'b', type: 'no-adjacent', enabled: true },
        { id: 'c2', studentA: 'a', studentB: 'b', type: 'no-deskmate', enabled: true },
      ],
      seats: plan.seats,
      students,
    })
    expect(issues).toHaveLength(0)
  })

  it('把乙挪到同区挨着的 2 号后，两个检查器同时报冲突（说明判定真的是「挨着」而不是「过道」）', () => {
    const plan = acrossAislePlan(2)
    expect(validateSeatPlanConstraints(plan, students).errors).toHaveLength(2) // 同桌 + 三人相邻

    const issues = checkSeatConstraints({
      constraints: [
        { id: 'c1', studentA: 'a', studentB: 'b', type: 'no-adjacent', enabled: true },
        { id: 'c2', studentA: 'a', studentB: 'b', type: 'no-deskmate', enabled: true },
      ],
      seats: plan.seats,
      students,
    })
    expect(issues).toHaveLength(2)
  })
})

describe('前排 / 后排：阈值只有一份（两个检查器共用）', () => {
  it('第 1~2 排是前排，第 5 排起是后排，中间三排都不是', () => {
    expect(isFrontRowSeat(createSeat(1, 1))).toBe(true)
    expect(isFrontRowSeat(createSeat(FRONT_ROW_LIMIT, 9))).toBe(true)
    expect(isFrontRowSeat(createSeat(FRONT_ROW_LIMIT + 1, 1))).toBe(false)
    expect(isBackRowSeat(createSeat(BACK_ROW_MIN, 1))).toBe(true)
    expect(isBackRowSeat(createSeat(BACK_ROW_MIN - 1, 1))).toBe(false)
    // 同一名学生不会同时落在「前排」与「后排」两个集合里（阈值不重叠）
    for (let row = 1; row <= CFG.rows; row++) {
      const seat = createSeat(row, 1)
      expect(isFrontRowSeat(seat) && isBackRowSeat(seat)).toBe(false)
    }
  })
})

describe('统一：全局约束与方案级约束用同一套判定', () => {
  const students = new Map<string, Student>([
    ['a', makeStudent('a', '甲', '0101')],
    ['b', makeStudent('b', '乙', '0102')],
  ])

  /** 甲 (1,1)、乙 (1,3)：同一张长桌的两端，中间还坐着别人（这正是旧口径判不出来的情形） */
  function sameDeskPlan(): SeatPlan {
    const seats = buildSeatGrid().map((seat) => {
      if (seat.id === 'r1c1') return { ...seat, studentId: 'a' }
      if (seat.id === 'r1c3') return { ...seat, studentId: 'b' }
      return seat
    })
    return makePlan(seats, {
      sameDeskForbidden: [{ id: 'x', studentA: 'a', studentB: 'b' }],
    })
  }

  it('方案级报「同桌冲突」时，全局 no-deskmate 也报（两条入口同一结论）', () => {
    const plan = sameDeskPlan()
    expect(validateSeatPlanConstraints(plan, students).errors).toHaveLength(1)

    const globalIssues = checkSeatConstraints({
      constraints: [{ id: 'c1', studentA: 'a', studentB: 'b', type: 'no-deskmate', enabled: true }],
      seats: plan.seats,
      students,
    })
    expect(globalIssues).toHaveLength(1)
    expect(globalIssues[0]!.severity).toBe('conflict')
  })

  it('自动排座的硬约束用的是同一套判定（不再自己算「挨着」）', () => {
    // 两名学生 + 一条「不能同桌」：求解器必须把他们排到不同的长桌组上
    const result = arrangeSeats({
      students: [makeStudent('a', '甲', '0101'), makeStudent('b', '乙', '0102')],
      constraints: [{ id: 'c1', studentA: 'a', studentB: 'b', type: 'no-deskmate', enabled: true }],
      config: CFG,
      seed: 7,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const seatOf = (id: string) => result.seats.find((seat) => seat.studentId === id)!
    expect(areSeatsSameDesk(seatOf('a'), seatOf('b'))).toBe(false)
  })
})

describe('视角不影响约束结论', () => {
  const students = new Map<string, Student>([
    ['a', makeStudent('a', '甲', '0101')],
    ['b', makeStudent('b', '乙', '0102')],
    ['c', makeStudent('c', '丙', '0103')],
  ])

  it('同一份方案按老师视角 / 学生视角的渲染顺序重排后，检查结论完全相同', () => {
    const seats = buildSeatGrid().map((seat) => {
      if (seat.id === 'r1c1') return { ...seat, studentId: 'a' }
      if (seat.id === 'r1c3') return { ...seat, studentId: 'b' }
      if (seat.id === 'r7c9') return { ...seat, studentId: 'c' }
      return seat
    })
    const constraints: SeatPlanConstraints = {
      ...createEmptySeatPlanConstraints(),
      sameDeskForbidden: [{ id: 'x', studentA: 'a', studentB: 'b' }],
      frontRowStudents: ['c'],
    }
    const plan = makePlan(seats, constraints)

    /** 按某视角的渲染顺序（排 → 列块 → 列）重排座位数组：模拟「学生视角下 DOM 的顺序」 */
    const renderOrder = (view: SeatView): Seat[] => {
      const byId = new Map(seats.map((seat) => [seat.id, seat]))
      const ordered: Seat[] = []
      for (let slot = 1; slot <= CFG.rows; slot++) {
        for (const unit of viewRowUnits(slot, view, CFG, byId)) {
          if (unit.kind === 'block') ordered.push(...unit.seats)
        }
      }
      return ordered
    }

    const teacherReport = validateSeatPlanConstraints(
      { ...plan, seats: renderOrder('teacher') },
      students,
    )
    const studentReport = validateSeatPlanConstraints(
      { ...plan, seats: renderOrder('student') },
      students,
    )

    expect(teacherReport.errors.map((issue) => issue.key)).toEqual(
      studentReport.errors.map((issue) => issue.key),
    )
    expect(teacherReport.warnings.map((issue) => issue.key)).toEqual(
      studentReport.warnings.map((issue) => issue.key),
    )
    expect(teacherReport.errors).toHaveLength(1)
    expect(teacherReport.warnings).toHaveLength(1)
  })
})

describe('约束检查器：只报告，不改座位', () => {
  const students = new Map<string, Student>([
    ['a', makeStudent('a', '甲', '0101')],
    ['b', makeStudent('b', '乙', '0102')],
    ['c', makeStudent('c', '丙', '0103')],
    ['d', makeStudent('d', '丁', '0104')],
  ])

  it('不能同桌：同排同列块（哪怕不挨着）即冲突', () => {
    const seats = [
      createSeat(1, 1, 'a'),
      createSeat(1, 3, 'b'),
      ...buildSeatGrid().filter((seat) => seat.id !== 'r1c1' && seat.id !== 'r1c3'),
    ]
    const report = validateSeatPlanConstraints(
      makePlan(seats, { sameDeskForbidden: [{ id: 'r1', studentA: 'a', studentB: 'b' }] }),
      students,
    )

    expect(report.ok).toBe(false)
    expect(report.errors).toHaveLength(1)
    expect(report.errors[0]!.kind).toBe('same-desk-forbidden')
    expect(report.errors[0]!.seatIds).toEqual(['r1c1', 'r1c3'])
  })

  it('不能同桌：一名未就座时不算冲突（没坐在教室里就谈不上同桌）', () => {
    const seats = [createSeat(1, 1, 'a'), ...buildSeatGrid().filter((seat) => seat.id !== 'r1c1')]
    const report = validateSeatPlanConstraints(
      makePlan(seats, { sameDeskForbidden: [{ id: 'r1', studentA: 'a', studentB: 'b' }] }),
      students,
    )
    expect(report.ok).toBe(true)
  })

  it('三人不能相邻：组内任意两人相邻即冲突，并指出是哪一对', () => {
    const seats = [
      createSeat(1, 1, 'a'),
      createSeat(1, 2, 'b'),
      createSeat(5, 5, 'c'),
      ...buildSeatGrid().filter((seat) => !['r1c1', 'r1c2', 'r5c5'].includes(seat.id)),
    ]
    const report = validateSeatPlanConstraints(
      makePlan(seats, {
        adjacentGroupForbidden: [{ id: 'g1', students: ['a', 'b', 'c'] }],
      }),
      students,
    )

    expect(report.errors).toHaveLength(1)
    expect(report.errors[0]!.kind).toBe('adjacent-group-forbidden')
    expect(report.errors[0]!.message).toContain('相邻')
    expect(report.errors[0]!.seatIds.sort()).toEqual(['r1c1', 'r1c2'])
  })

  it('三人不能相邻：三人互不相邻时通过；斜对角不算相邻', () => {
    const seats = [
      createSeat(1, 1, 'a'),
      createSeat(2, 2, 'b'),
      createSeat(5, 5, 'c'),
      ...buildSeatGrid().filter((seat) => !['r1c1', 'r2c2', 'r5c5'].includes(seat.id)),
    ]
    const report = validateSeatPlanConstraints(
      makePlan(seats, {
        adjacentGroupForbidden: [{ id: 'g1', students: ['a', 'b', 'c'] }],
      }),
      students,
    )
    expect(report.errors).toHaveLength(0)
    expect(report.ok).toBe(true)
  })

  it('前排 / 后排是提醒不是错误：不通过也不阻止拖拽', () => {
    const seats = [
      createSeat(4, 1, 'a'),
      createSeat(2, 2, 'b'),
      ...buildSeatGrid().filter((seat) => !['r4c1', 'r2c2'].includes(seat.id)),
    ]
    const report = validateSeatPlanConstraints(
      makePlan(seats, { frontRowStudents: ['a'], backRowStudents: ['b'] }),
      students,
    )

    expect(report.ok).toBe(true) // 警告不影响通过
    expect(report.errors).toHaveLength(0)
    expect(report.warnings).toHaveLength(2)
    expect(report.warnings[0]!.message).toContain('未处于指定前排')
    expect(report.warnings[1]!.message).toContain('未处于指定后排')
  })

  it('前排 / 后排满足时不产生任何结论', () => {
    const seats = [
      createSeat(1, 1, 'a'),
      createSeat(7, 9, 'b'),
      ...buildSeatGrid().filter((seat) => !['r1c1', 'r7c9'].includes(seat.id)),
    ]
    const report = validateSeatPlanConstraints(
      makePlan(seats, { frontRowStudents: ['a'], backRowStudents: ['b'] }),
      students,
    )
    expect(report.issues).toHaveLength(0)
  })

  it('没有方案 / 方案没有约束时给出空结论（不炸）', () => {
    expect(validateSeatPlanConstraints(undefined, students).ok).toBe(true)
    const plan = makePlan(buildSeatGrid(), {})
    delete (plan as Partial<SeatPlan>).constraints
    expect(validateSeatPlanConstraints(plan, students).ok).toBe(true)
  })
})

describe('数据兼容：旧方案照常打开，升级不丢学生', () => {
  it('旧数据没有 constraints → 自动补空约束，座位一个不丢', () => {
    const raw = {
      id: 'p1',
      name: '开学初',
      seats: [
        { id: '旧', row: 1, col: 1, studentId: 'a' },
        { id: '旧', row: 2, col: 5, studentId: 'b' },
      ],
      changeLogs: [],
    }
    const plan = normalizeLegacy(raw)

    expect(plan.constraints).toEqual(createEmptySeatPlanConstraints())
    expect(plan.seats).toHaveLength(CFG.totalSeats)
    expect(plan.seats.find((seat) => seat.id === 'r1c1')?.studentId).toBe('a')
    expect(plan.seats.find((seat) => seat.id === 'r2c5')?.studentId).toBe('b')
  })

  it('更早期只有数组顺序的数据 → 按行优先序号确定性迁移到 row / col', () => {
    // 前 5 条没有 row / col：第 1 条 = 1 号座 (1,1) … 第 5 条 = 5 号座 (1,5)
    const raw = {
      id: 'p1',
      name: '远古方案',
      seats: [
        { studentId: 'a' },
        { studentId: 'b' },
        { studentId: 'c' },
        { studentId: 'd' },
        { studentId: 'e' },
        // 第 10 条 = 第 10 号座 = (2,1)：证明是「行优先」而不是当列号用
        ...Array.from({ length: 4 }, () => ({})),
        { studentId: 'f' },
      ],
    }
    const plan = normalizeLegacy(raw)

    expect(plan.seats.find((seat) => seat.id === 'r1c1')?.studentId).toBe('a')
    expect(plan.seats.find((seat) => seat.id === 'r1c5')?.studentId).toBe('e')
    expect(plan.seats.find((seat) => seat.id === 'r2c1')?.studentId).toBe('f')
  })

  it('已有坐标的数据不会被下标迁移覆盖（迁移只对坐标非法的条目生效）', () => {
    const raw = {
      id: 'p1',
      name: '方案',
      seats: [
        { row: 7, col: 9, studentId: 'a' },
        { row: 1, col: 1, studentId: 'b' },
      ],
    }
    const plan = normalizeLegacy(raw)

    expect(plan.seats.find((seat) => seat.id === 'r7c9')?.studentId).toBe('a')
    expect(plan.seats.find((seat) => seat.id === 'r1c1')?.studentId).toBe('b')
  })

  it('越界坐标不写入（防止把学生塞进不存在的座位）', () => {
    const raw = {
      id: 'p1',
      name: '方案',
      seats: [{ row: 8, col: 1, studentId: 'a' }],
    }
    const plan = normalizeLegacy(raw)
    expect(plan.seats.every((seat) => !seat.studentId)).toBe(true)
  })

  it('约束规范化：丢弃自相约束与重复项，前后排互斥', () => {
    const raw = {
      id: 'p1',
      name: '方案',
      seats: buildSeatGrid(),
      constraints: {
        sameDeskForbidden: [
          { id: 'x', studentA: 'a', studentB: 'b' },
          { id: 'y', studentA: 'b', studentB: 'a' }, // 同一对（不计方向）→ 丢弃
          { id: 'z', studentA: 'c', studentB: 'c' }, // 自相 → 丢弃
        ],
        adjacentGroupForbidden: [
          { id: 'g', students: ['a', 'b', 'c'] },
          { id: 'g2', students: ['a', 'b'] }, // 不是三人 → 丢弃
          { id: 'g3', students: ['a', 'a', 'b'] }, // 有重复 → 丢弃
        ],
        frontRowStudents: ['a', 'a', ''],
        backRowStudents: ['a', 'b'], // a 已在前后名单 → 只留 b
      },
    }
    const plan = normalizeLegacy(raw)

    expect(plan.constraints.sameDeskForbidden).toHaveLength(1)
    expect(plan.constraints.adjacentGroupForbidden).toHaveLength(1)
    expect(plan.constraints.frontRowStudents).toEqual(['a'])
    expect(plan.constraints.backRowStudents).toEqual(['b'])
  })
})
