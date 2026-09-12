/**
 * Excel 座位导入自检（V1.1.2 Phase 1）。
 *
 * 分两段：① 纯函数层（解析 / 校验 / 预览统计）——规则全在这层，喂数组即可跑；
 * ② 落库层（`seatStore.applySeatImport`）——**只写一次盘**、**失败不改数据**、
 * **取消不写任何东西**、**刷新后数据还在**。
 *
 * 这几条都是「错了会静默丢数据」的类型：教师看到预览上写着「2 行被拦下」，
 * 落库时要是把错行也写进去（或反过来把整份表都丢了），他不会再核对第二遍。
 */
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import { installFakeBrowser, type FakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import { readSheetRows } from '@/services/studentImport'
import { parseSeatRows, planSeatImport } from '@/services/seatImport'
import { useSeatStore } from '@/stores/seat'
import { useStudentStore } from '@/stores/student'
import { buildSeatGrid } from '@/utils/seat'
import { DEFAULT_CLASSROOM_CONFIG as CFG } from '@/types/classroom'
import type { ParsedSeatRow } from '@/services/seatImport'
import type { Student } from '@/types'

const prefix = appConfig.storageKeyPrefix
const STUDENTS_KEY = `${prefix}:students`
const SEAT_KEY = `${prefix}:seatPlans`

const HEADER = ['行', '列', '学号', '姓名']

/** 表头 + 数据行 */
function sheet(...rows: unknown[][]): unknown[][] {
  return [HEADER, ...rows]
}

function parseOk(rows: unknown[][]): ParsedSeatRow[] {
  const result = parseSeatRows(rows, CFG)
  if (!result.ok) throw new Error(`预期解析成功，实际失败：${result.error}`)
  return result.rows
}

function makeStudent(id: string, name: string, studentNo: string): Student {
  return { id, name, studentNo, gender: 'female' }
}

/** 三名学生：甲乙丙（丙另有重名者，用于「重名必须用学号」这一条） */
function makeStudents(): Student[] {
  return [
    makeStudent('s1', '甲', '0101'),
    makeStudent('s2', '乙', '0102'),
    makeStudent('s3', '丙', '0103'),
    makeStudent('s4', '丙', '0104'),
  ]
}

/** 没有学生就座的空方案（占用矩阵全空） */
function emptySeats() {
  return buildSeatGrid()
}

describe('解析：表头识别与行号', () => {
  it('列顺序调换照样认得出', () => {
    const rows = parseOk([
      ['姓名', '学号', '列', '行'],
      ['甲', '0101', '3', '2'],
    ])
    expect(rows[0]!.row).toBe(2)
    expect(rows[0]!.col).toBe(3)
    expect(rows[0]!.studentNo).toBe('0101')
  })

  it('「第3排」「3 列」这类写法也读得出来', () => {
    const rows = parseOk([
      ['行', '列', '学号'],
      ['第 3 排', '第 4 列', '0101'],
    ])
    expect(rows[0]!.row).toBe(3)
    expect(rows[0]!.col).toBe(4)
  })

  it('缺「行 / 列」时给出可照做的错误，而不是让教师猜', () => {
    const result = parseSeatRows(
      [
        ['座位', '学号', '姓名'],
        ['1', '0101', '甲'],
      ],
      CFG,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('行')
    expect(result.error).toContain('列')
  })

  it('全空行跳过并计数，行号仍按 Excel 实际行号（预览里的「第几行」对得上表）', () => {
    const result = parseSeatRows(
      sheet(['1', '1', '0101', '甲'], ['', '', '', ''], ['1', '2', '0102', '乙']),
      CFG,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.blankRows).toBe(1)
    expect(result.rows.map((row) => row.rowNumber)).toEqual([2, 4])
  })
})

describe('校验：错误数据绝不进 plan', () => {
  const students = makeStudents()

  it('正常导入：可导入数与新安排数都对，指派准确', () => {
    const rows = parseOk(sheet(['1', '1', '0101', '甲'], ['1', '9', '0102', '乙']))
    const result = planSeatImport(rows, students, emptySeats(), 0)

    expect(result.total).toBe(2)
    expect(result.assignable).toBe(2)
    expect(result.blocked).toBe(0)
    expect(result.errorCount).toBe(0)
    expect(result.changed).toBe(2) // 两名学生原本都没就座 → 都是新安排
    expect(result.plan.assignments).toEqual([
      { row: 1, col: 1, studentId: 's1' },
      { row: 1, col: 9, studentId: 's2' },
    ])
  })

  it('非法行列（0 排 / 8 排 / 10 列）被拦下', () => {
    const rows = parseOk(
      sheet(['0', '1', '0101', '甲'], ['8', '1', '0102', '乙'], ['1', '10', '0101', '甲']),
    )
    const result = planSeatImport(rows, students, emptySeats(), 0)

    expect(result.assignable).toBe(0)
    expect(result.blocked).toBe(3)
    expect(result.errorCount).toBe(3)
    expect(result.plan.assignments).toHaveLength(0)
  })

  it('坐标重复：第二行被拦下并指出与哪一行重复', () => {
    const rows = parseOk(sheet(['1', '1', '0101', '甲'], ['1', '1', '0102', '乙']))
    const result = planSeatImport(rows, students, emptySeats(), 0)

    expect(result.duplicateSeats).toBe(1)
    expect(result.assignable).toBe(1)
    const blocked = result.rows.find((row) => row.action === 'blocked')!
    expect(blocked.errors[0]).toContain('第 2 行')
  })

  it('同一名学生被安排到两个座位：后者被拦下', () => {
    const rows = parseOk(sheet(['1', '1', '0101', '甲'], ['3', '3', '0101', '甲']))
    const result = planSeatImport(rows, students, emptySeats(), 0)

    expect(result.duplicateStudents).toBe(1)
    expect(result.assignable).toBe(1)
    expect(result.plan.assignments).toEqual([{ row: 1, col: 1, studentId: 's1' }])
  })

  it('学号不在名单中 → 记为无法识别的学生', () => {
    const rows = parseOk(sheet(['1', '1', '9999', '陌生人']))
    const result = planSeatImport(rows, students, emptySeats(), 0)

    expect(result.unknownStudents).toBe(1)
    expect(result.blocked).toBe(1)
    expect(result.rows[0]!.errors[0]).toContain('不在学生名单中')
  })

  it('姓名与学号不匹配 → 拦下（表与档案对不上时不能猜）', () => {
    const rows = parseOk(sheet(['1', '1', '0101', '乙']))
    const result = planSeatImport(rows, students, emptySeats(), 0)

    expect(result.blocked).toBe(1)
    expect(result.rows[0]!.errors[0]).toContain('姓名与学号不匹配')
  })

  it('重名且没填学号 → 明确要求用学号确认', () => {
    const rows = parseOk(sheet(['1', '1', '', '丙']))
    const result = planSeatImport(rows, students, emptySeats(), 0)

    expect(result.unknownStudents).toBe(1)
    expect(result.blocked).toBe(1)
    expect(result.rows[0]!.errors[0]).toContain('存在重名学生，请使用学号确认。')
  })

  it('没填学号但姓名唯一 → 允许导入并提示本次按姓名匹配', () => {
    const rows = parseOk(sheet(['2', '2', '', '乙']))
    const result = planSeatImport(rows, students, emptySeats(), 0)

    expect(result.assignable).toBe(1)
    expect(result.rows[0]!.warnings).toContain('未填学号，本次按姓名匹配')
    expect(result.plan.assignments).toEqual([{ row: 2, col: 2, studentId: 's2' }])
  })

  it('部分错误：好行照常计入可导入，但整批仍不许确认（存在阻断性错误）', () => {
    const rows = parseOk(
      sheet(['1', '1', '0101', '甲'], ['9', '1', '0102', '乙'], ['2', '2', '0103', '丙']),
    )
    const result = planSeatImport(rows, students, emptySeats(), 0)

    expect(result.assignable).toBe(2)
    expect(result.blocked).toBe(1)
    expect(result.errorCount).toBe(1)
    expect(result.plan.assignments).toHaveLength(2)
  })

  it('已在原位的行标为「原位不动」，不计入新安排人数', () => {
    const seats = emptySeats()
    const target = seats.find((seat) => seat.id === 'r2c2')!
    target.studentId = 's2'
    const rows = parseOk(sheet(['2', '2', '0102', '乙'], ['3', '3', '0101', '甲']))
    const result = planSeatImport(rows, students, seats, 0)

    expect(result.rows[0]!.change).toBe('same')
    expect(result.rows[1]!.change).toBe('new')
    expect(result.changed).toBe(1)
  })

  it('学生原本坐在别处 → 标为「换座位」', () => {
    const seats = emptySeats()
    seats.find((seat) => seat.id === 'r7c1')!.studentId = 's1'
    const rows = parseOk(sheet(['1', '1', '0101', '甲']))
    const result = planSeatImport(rows, students, seats, 0)

    expect(result.rows[0]!.change).toBe('move')
    expect(result.changed).toBe(1)
  })

  it('空行只统计不报错', () => {
    const rows = parseOk(sheet(['1', '1', '0101', '甲']))
    const result = planSeatImport(rows, students, emptySeats(), 3)

    expect(result.blankRows).toBe(3)
    expect(result.blocked).toBe(0)
  })
})

describe('读文件层：坏文件在预览之前就被挡下', () => {
  it('CSV 改名成 .xlsx 时明说「这不是 Excel」', async () => {
    const result = await readSheetRows(
      new TextEncoder().encode('行,列,学号,姓名\n1,1,0101,甲').buffer as ArrayBuffer,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('不是 Excel')
  })

  it('正常的工作簿读出来的行仍是文本（学号 0101 不会变成数字 101）', async () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([HEADER, ['1', '2', '0101', '甲']]),
      '座位',
    )
    const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const sheetResult = await readSheetRows(buffer)
    expect(sheetResult.ok).toBe(true)
    if (!sheetResult.ok) return

    const rows = parseOk(sheetResult.rows)
    expect(rows[0]!.studentNo).toBe('0101')
    expect(rows[0]!.row).toBe(1)
    expect(rows[0]!.col).toBe(2)
  })
})

describe('落库：一次性写入、失败不动数据', () => {
  let browser: FakeBrowser

  /** 盘上放一份「开学初」方案：甲 在 (1,1)、乙 在 (1,2) */
  function seedPlan() {
    const seats = emptySeats()
    seats.find((seat) => seat.id === 'r1c1')!.studentId = 's1'
    seats.find((seat) => seat.id === 'r1c2')!.studentId = 's2'
    browser.localStorage.seed(
      SEAT_KEY,
      JSON.stringify([
        {
          id: 'plan1',
          name: '开学初',
          createdAt: '',
          updatedAt: '',
          isCurrent: true,
          seats,
          changeLogs: [],
        },
      ]),
    )
  }

  function seedStudents() {
    browser.localStorage.seed(STUDENTS_KEY, JSON.stringify(makeStudents()))
  }

  beforeEach(() => {
    browser = installFakeBrowser()
    setActivePinia(createPinia())
    seedStudents()
    seedPlan()
  })

  it('成功导入：座位落地、整批只写一次盘、只广播一次', async () => {
    const store = useSeatStore()
    const rows = parseOk(sheet(['2', '2', '0101', '甲'], ['2', '3', '0102', '乙']))
    const result = planSeatImport(rows, storeStudents(), store.currentSeats, 0)

    browser.localStorage.resetCounters()
    const outcome = store.applySeatImport(result.plan.assignments)
    await nextTick()

    expect(outcome.ok).toBe(true)
    expect(outcome.applied).toBe(2)
    // 两名学生都换了座位（甲从 (1,1) 到 (2,2)、乙从 (1,2) 到 (2,3)）
    expect(outcome.relocated).toBe(2)
    expect(browser.localStorage.writesFor(SEAT_KEY)).toBe(1)
    const seats = store.currentSeats
    expect(seats.find((seat) => seat.id === 'r2c2')?.studentId).toBe('s1')
    expect(seats.find((seat) => seat.id === 'r2c3')?.studentId).toBe('s2')
    // 原座位被释放，不会出现「一个人坐两个位」
    expect(seats.find((seat) => seat.id === 'r1c1')?.studentId).toBeUndefined()
    expect(seats.filter((seat) => seat.studentId === 's1')).toHaveLength(1)
  })

  it('导入不改动表格没有提到的座位（不是覆盖式整表替换）', () => {
    const store = useSeatStore()
    const rows = parseOk(sheet(['2', '2', '0101', '甲']))
    const result = planSeatImport(rows, storeStudents(), store.currentSeats, 0)

    store.applySeatImport(result.plan.assignments)

    // 乙不在表里 → 仍在 (1,2) 原位坐着
    expect(store.currentSeats.find((seat) => seat.id === 'r1c2')?.studentId).toBe('s2')
    expect(store.currentSeats.find((seat) => seat.id === 'r2c2')?.studentId).toBe('s1')
  })

  it('导入失败：整批拒绝且**一个座位都没动**、一次盘都没写', async () => {
    const store = useSeatStore()
    const snapshot = JSON.stringify(store.currentSeats)

    browser.localStorage.resetCounters()
    // 同一个学生被指派到两个座位（组件已拦，这里验数据层兜底）
    const outcome = store.applySeatImport([
      { row: 2, col: 2, studentId: 's1' },
      { row: 3, col: 3, studentId: 's1' },
    ])
    await nextTick()

    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toContain('冲突')
    expect(JSON.stringify(store.currentSeats)).toBe(snapshot)
    expect(browser.localStorage.writesFor(SEAT_KEY)).toBe(0)
  })

  it('非法坐标与不存在的学生被丢弃；没有可应用的条目时同样不动数据', async () => {
    const store = useSeatStore()
    const snapshot = JSON.stringify(store.currentSeats)

    browser.localStorage.resetCounters()
    const outcome = store.applySeatImport([
      { row: 8, col: 1, studentId: 's1' },
      { row: 1, col: 1, studentId: '不存在' },
    ])
    await nextTick()

    expect(outcome.ok).toBe(false)
    expect(JSON.stringify(store.currentSeats)).toBe(snapshot)
    expect(browser.localStorage.writesFor(SEAT_KEY)).toBe(0)
  })

  it('取消导入（只解析与预览、不落库）不写任何东西', () => {
    const store = useSeatStore()
    browser.localStorage.resetCounters()

    const rows = parseOk(sheet(['2', '2', '0101', '甲'], ['8', '1', '0102', '乙']))
    const result = planSeatImport(rows, storeStudents(), store.currentSeats, 0)
    expect(result.assignable).toBe(1)

    // 教师点了「取消」：什么都没发生
    expect(browser.localStorage.writesFor(SEAT_KEY)).toBe(0)
    expect(store.currentSeats.find((seat) => seat.id === 'r2c2')?.studentId).toBeUndefined()
  })

  it('刷新页面后导入结果仍在（数据真的落到了盘上）', async () => {
    const store = useSeatStore()
    const rows = parseOk(sheet(['2', '2', '0101', '甲']))
    store.applySeatImport(
      planSeatImport(rows, storeStudents(), store.currentSeats, 0).plan.assignments,
    )
    await nextTick()

    // 重新装载一次（模拟刷新）
    setActivePinia(createPinia())
    const reloaded = useSeatStore()
    expect(reloaded.currentSeats.find((seat) => seat.id === 'r2c2')?.studentId).toBe('s1')
    expect(reloaded.currentSeats.find((seat) => seat.id === 'r1c1')?.studentId).toBeUndefined()
  })

  /** 学生表（与盘上那份一致）：检查器与导入匹配都用它 */
  function storeStudents(): Student[] {
    return useStudentStore().activeStudents
  }
})

describe('方案级约束：批量标记一次写入、互斥、重复拒绝', () => {
  let browser: FakeBrowser

  beforeEach(() => {
    browser = installFakeBrowser()
    setActivePinia(createPinia())
    browser.localStorage.seed(STUDENTS_KEY, JSON.stringify(makeStudents()))
    browser.localStorage.seed(
      SEAT_KEY,
      JSON.stringify([
        {
          id: 'plan1',
          name: '开学初',
          createdAt: '',
          updatedAt: '',
          isCurrent: true,
          seats: emptySeats(),
          changeLogs: [],
        },
      ]),
    )
  })

  it('批量设为前排：一次写盘，且与后排名单互斥', async () => {
    const store = useSeatStore()
    // 先全标为后排
    store.setRowPreference(['s1', 's2'], 'back')
    await nextTick()
    browser.localStorage.resetCounters()

    expect(store.setRowPreference(['s1'], 'front')).toBe(1)
    await nextTick()

    expect(browser.localStorage.writesFor(SEAT_KEY)).toBe(1)
    expect(store.currentConstraints.frontRowStudents).toEqual(['s1'])
    expect(store.currentConstraints.backRowStudents).toEqual(['s2'])
  })

  it('取消标记把学生从两份名单一起移除', () => {
    const store = useSeatStore()
    store.setRowPreference(['s1', 's2'], 'front')
    store.setRowPreference(['s1'], 'clear')

    expect(store.currentConstraints.frontRowStudents).toEqual(['s2'])
    expect(store.currentConstraints.backRowStudents).toEqual([])
  })

  it('不能同桌：同一对学生（不计方向）不能重复添加', () => {
    const store = useSeatStore()
    expect(store.addSameDeskForbidden('s1', 's2')).toEqual({ ok: true })
    expect(store.addSameDeskForbidden('s2', 's1').ok).toBe(false)
    expect(store.addSameDeskForbidden('s1', 's1').ok).toBe(false)
    expect(store.currentConstraints.sameDeskForbidden).toHaveLength(1)
  })

  it('三人不能相邻：必须三名互异学生，同一组不能重复', () => {
    const store = useSeatStore()
    expect(store.addAdjacentGroupForbidden(['s1', 's2', 's2']).ok).toBe(false)
    expect(store.addAdjacentGroupForbidden(['s1', 's2', 's3'])).toEqual({ ok: true })
    expect(store.addAdjacentGroupForbidden(['s3', 's2', 's1']).ok).toBe(false)
    expect(store.currentConstraints.adjacentGroupForbidden).toHaveLength(1)
  })

  it('约束检查随座位变化实时重算（换座后立刻能报出冲突）', async () => {
    const store = useSeatStore()
    store.addSameDeskForbidden('s1', 's2')
    // 甲 (1,1)、乙 (1,2) 同排同列块 → 同一张长桌 → 冲突
    store.applySeatImport([
      { row: 1, col: 1, studentId: 's1' },
      { row: 1, col: 2, studentId: 's2' },
    ])
    await nextTick()

    expect(store.constraintReport.ok).toBe(false)
    expect(store.constraintReport.errors[0]!.kind).toBe('same-desk-forbidden')

    // 把乙挪到另一区 → 冲突消失（约束不变，结论跟着座位走）
    store.moveStudent('r1c2', 'r1c4')
    expect(store.constraintReport.ok).toBe(true)
  })

  it('学生被删除后，**四类**约束里的脏引用全部清理（座位也一并释放）', async () => {
    const store = useSeatStore()
    const studentStore = useStudentStore()
    store.addSameDeskForbidden('s1', 's2')
    store.addAdjacentGroupForbidden(['s1', 's2', 's3'])
    store.setRowPreference(['s1'], 'front')
    store.setRowPreference(['s2'], 'back')
    store.applySeatImport([{ row: 1, col: 1, studentId: 's1' }])
    await nextTick()

    studentStore.removeStudent('s1')
    await nextTick()

    const constraints = store.currentConstraints
    expect(constraints.sameDeskForbidden).toHaveLength(0)
    expect(constraints.adjacentGroupForbidden).toHaveLength(0)
    expect(constraints.frontRowStudents).toEqual([])
    // 与 s1 无关的条目必须原样留着（清理只针对被删学生的引用）
    expect(constraints.backRowStudents).toEqual(['s2'])
    // 座位也释放了
    expect(store.currentSeats.find((seat) => seat.id === 'r1c1')?.studentId).toBeUndefined()
  })

  it('导入不改写约束条目：检查结论跟着实际座位走（V1.1.2 Phase 2）', async () => {
    const store = useSeatStore()
    const students = useStudentStore().activeStudents
    const noOf = (id: string) => students.find((student) => student.id === id)!.studentNo
    store.addSameDeskForbidden('s1', 's2')
    await nextTick()
    const constraintSnapshot = JSON.stringify(store.currentConstraints)

    // 导入把甲、乙排到同一张长桌的两端（中间还空着一个座位）
    const rows = parseOk(sheet(['1', '1', noOf('s1'), '甲'], ['1', '3', noOf('s2'), '乙']))
    const outcome = store.applySeatImport(
      planSeatImport(rows, students, store.currentSeats, 0).plan.assignments,
    )
    await nextTick()

    expect(outcome.ok).toBe(true)
    // ① 约束条目一字未改（导入只懂座位，不该动约束）
    expect(JSON.stringify(store.currentConstraints)).toBe(constraintSnapshot)
    // ② 检查结论 = 座位的真实状态（同排同列块 → 冲突）
    expect(store.constraintReport.errors).toHaveLength(1)
    expect([...store.constraintReport.errors[0]!.seatIds].sort()).toEqual(['r1c1', 'r1c3'])

    // ③ 把乙挪到中区（跨过道）→ 冲突消失，约束仍在（跨过道不是同桌）
    store.moveStudent('r1c3', 'r1c4')
    expect(store.constraintReport.errors).toHaveLength(0)
    expect(JSON.stringify(store.currentConstraints)).toBe(constraintSnapshot)
  })
})
