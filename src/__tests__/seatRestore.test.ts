/**
 * v3.7.6 Phase 2 自检：**座位图导出文件 → 重新导入并恢复座位安排**。
 *
 * 这一版盯的是「导出前后能不能对上」这一件事，分三层：
 *
 *  ① **我们导出的文件，我们自己的导入端能原样读回来**（结构化数据 + 可视化版面交叉校验）。
 *     这条必须让「写文件」与「读文件」都走真实实现——手写的假数据测不出字段名漂移。
 *  ② **旧版导出文件（只有两张可视化工作表）按版面也能恢复**，同时明确「约束恢复不了」；
 *     旧的行列列表文件仍然走原来的逐条导入，不被新逻辑抢走。
 *  ③ **坏文件一律整份拦下**：版本不认识 / 缺字段 / 坐标非法 / 固定空位有人 / 版面与数据对不上 /
 *     损坏的行列布局，都要有可照做的错误文案，且不产生半份恢复计划。
 *
 * 落库侧（`applySeatRestore`）另开一组：整表替换时未列出的座位必须清空、失败不写一个字节、
 * 撤销能同时还原座位与约束。
 */
import { readFileSync } from 'node:fs'

import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { installFakeBrowser, type FakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import { readRaw } from '@/services/storage'
import { readWorkbookSheets } from '@/services/studentImport'
import {
  detectSeatRestoreWorkbook,
  parseSeatDataSheet,
  planSeatRestore,
} from '@/services/seatRestore'
import type { ParsedSeatRestore, SeatRestoreSeatInput } from '@/services/seatRestore'
import { useSeatStore } from '@/stores/seat'
import { useStudentStore } from '@/stores/student'
import { SEAT_EXPORT_SHEET } from '@/utils/seatExportFormat'
import { buildSeatWorkbookFromTemplate } from '@/utils/seatTemplateXlsx'
import {
  buildSeatGrid,
  createEmptySeatPlanConstraints,
  getSeatKey,
  seatOrdinal,
} from '@/utils/seat'
import { DEFAULT_CLASSROOM_CONFIG as CFG } from '@/types/classroom'
import type { SeatPlanConstraints } from '@/types/seat'
import type { Student } from '@/types'
import type { ReadWorkbookResult } from '@/services/studentImport'

const TEMPLATE_PATH = 'docs/座位图-9.3.xlsx'

function readTemplate(): ArrayBuffer {
  const buffer = readFileSync(TEMPLATE_PATH)
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer
}

function makeStudent(id: string, name: string, studentNo = '', idCardSuffix = ''): Student {
  return { id, name, studentNo, gender: 'female', idCardSuffix }
}

/**
 * 名册刻意覆盖四种匹配路径：有学号 / 重名（带身份证尾号）/ 没有学号 / 未在导出里就座。
 * s6 只用于「坏数据」测试（手工把学生塞进固定空位），正常导出里没有他。
 */
const ROSTER: Student[] = [
  makeStudent('s1', '王小明', '0101'),
  makeStudent('s2', '张伟', '0102', '3287'),
  makeStudent('s3', '张伟', '0103', '3288'),
  makeStudent('s4', '李思远', '0104'),
  makeStudent('s5', '旦增卓玛', ''),
  makeStudent('s6', '白马', '0106'),
]
const STUDENTS = new Map(ROSTER.map((student) => [student.id, student]))

/** (排, 列, 学生 id)：避开固定空位（第 1 排第 9 列） */
const PLACEMENT: [number, number, string][] = [
  [1, 1, 's1'],
  [1, 8, 's2'],
  [2, 5, 's4'],
  [3, 3, 's5'],
  [7, 9, 's3'],
]

const CONSTRAINTS: SeatPlanConstraints = {
  sameDeskForbidden: [{ id: 'c1', studentA: 's1', studentB: 's2' }],
  adjacentGroupForbidden: [{ id: 'c2', students: ['s1', 's2', 's4'] }],
  frontRowStudents: ['s4'],
  backRowStudents: ['s3'],
}

const EXPORT_DATE = new Date(2026, 9, 18)

function seatsOf(placement: readonly [number, number, string][] = PLACEMENT) {
  return buildSeatGrid(
    new Map(placement.map(([row, col, id]) => [seatOrdinal(row, col, CFG), id])),
    CFG,
  )
}

function buildExport(
  options: { constraints?: SeatPlanConstraints; placement?: [number, number, string][] } = {},
): Promise<ArrayBuffer> {
  const seats = seatsOf(options.placement)
  return buildSeatWorkbookFromTemplate(readTemplate(), {
    title: `${CFG.name}座位图`,
    date: EXPORT_DATE,
    sheets: [
      { sheetName: '学生视角', seats, students: STUDENTS },
      { sheetName: '老师视角', seats, students: STUDENTS },
    ],
    config: CFG,
    plan: { name: '座位方案 A', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '' },
    appVersion: 'v3.7.6',
    constraints: options.constraints ?? CONSTRAINTS,
  })
}

async function readExport(
  bytes?: ArrayBuffer,
): Promise<{ read: ReadWorkbookResult; parsed: ParsedSeatRestore }> {
  const result = await readWorkbookSheets(bytes ?? (await buildExport()))
  if (!result.ok) throw new Error(`读取导出文件失败：${result.error}`)
  const detection = detectSeatRestoreWorkbook(result.workbook, CFG)
  if (detection.kind !== 'restore') {
    throw new Error(`没有识别成恢复文件：${detection.kind === 'error' ? detection.error : 'none'}`)
  }
  return { read: result.workbook, parsed: detection.parsed }
}

function visualOnly(workbook: ReadWorkbookResult): ReadWorkbookResult {
  const sheetNames = workbook.sheetNames.filter((name) => name !== SEAT_EXPORT_SHEET)
  const sheets = new Map(sheetNames.map((name) => [name, workbook.sheets.get(name) ?? []]))
  return { sheetNames, sheets }
}

/** 深拷贝隐藏数据行，供「坏文件」用例逐格改 */
function cloneHiddenRows(workbook: ReadWorkbookResult): unknown[][] {
  return (workbook.sheets.get(SEAT_EXPORT_SHEET) ?? []).map((row) => [...row])
}

function metaRowIndex(rows: unknown[][], key: string): number {
  const index = rows.findIndex((row) => String(row[0] ?? '').trim() === key)
  if (index < 0) throw new Error(`隐藏数据里找不到「${key}」`)
  return index
}

function seatRowIndex(rows: unknown[][], row: number, col: number): number {
  const header = rows.findIndex(
    (item) => String(item[0] ?? '').trim() === '排' && String(item[1] ?? '').trim() === '列',
  )
  if (header < 0) throw new Error('隐藏数据里找不到座位区表头')
  return header + 1 + (row - 1) * CFG.cols + (col - 1)
}

/** 手工构造解析结果：只改想测的那一个座位，其余照导出数据 */
function parsedWith(
  parsed: ParsedSeatRestore,
  mutate: (seats: SeatRestoreSeatInput[]) => void,
): ParsedSeatRestore {
  const seats = parsed.seats.map((seat) => ({ ...seat }))
  mutate(seats)
  return { ...parsed, seats, warnings: [] }
}

function occupierAt(seats: SeatRestoreSeatInput[], row: number, col: number): SeatRestoreSeatInput {
  const seat = seats.find((item) => item.row === row && item.col === col)
  if (!seat) throw new Error(`测试数据里没有第 ${row} 排第 ${col} 列`)
  return seat
}

/* ==================== ① 导出 → 读回：结构化数据与版面交叉校验 ==================== */

describe('座位图导出文件：整份读回来', () => {
  it('隐藏数据表被识别，布局 / 方案 / 版本 / 约束都在', async () => {
    const { parsed } = await readExport()

    expect(parsed.source).toBe('metadata')
    expect(parsed.formatVersion).toBe(1)
    expect(parsed.appVersion).toBe('v3.7.6')
    expect(parsed.planName).toBe('座位方案 A')
    expect(parsed.visualChecked).toBe(true)
    expect(parsed.warnings).toEqual([])

    expect(parsed.layout).toEqual({
      rows: CFG.rows,
      cols: CFG.cols,
      blocks: [...CFG.blocks],
      totalSeats: CFG.totalSeats,
      occupiedSeats: CFG.occupiedSeats,
      fixedEmptySeat: { ...CFG.fixedEmptySeat },
    })
    expect(parsed.seats).toHaveLength(CFG.totalSeats)
    expect(parsed.seats.filter((seat) => seat.occupied)).toHaveLength(PLACEMENT.length)

    expect(parsed.constraints?.sameDeskForbidden).toEqual([
      [
        { studentNo: '0101', name: '王小明' },
        { studentNo: '0102', name: '张伟' },
      ],
    ])
    expect(parsed.constraints?.adjacentGroupForbidden).toHaveLength(1)
    expect(parsed.constraints?.frontRowStudents).toEqual([{ studentNo: '0104', name: '李思远' }])
    expect(parsed.constraints?.backRowStudents).toEqual([{ studentNo: '0103', name: '张伟' }])
  })

  it('空座逐格保留（63 行，不只是有人的 5 行）', async () => {
    const { parsed } = await readExport()
    const empty = parsed.seats.filter((seat) => !seat.occupied)
    expect(empty).toHaveLength(CFG.totalSeats - PLACEMENT.length)
    // 固定空位在导出文件里必须是空的
    expect(occupierAt(parsed.seats, 1, 9).occupied).toBe(false)
  })

  it('计划：5 个座位全部可恢复，约束回到当前学生 id', async () => {
    const { parsed } = await readExport()
    const plan = planSeatRestore(parsed, ROSTER, buildSeatGrid(), CFG)

    expect(plan.ok).toBe(true)
    expect(plan.assignable).toBe(PLACEMENT.length)
    expect(plan.changed).toBe(PLACEMENT.length)
    expect(plan.unchanged).toBe(0)
    expect(plan.clearedSeats).toBe(0)
    expect(plan.blocked).toBe(0)
    expect(plan.errors).toEqual([])
    expect(plan.warnings).toEqual([])

    const bySeat = new Map(
      plan.assignments.map((item) => [getSeatKey(item.row, item.col), item.studentId]),
    )
    for (const [row, col, id] of PLACEMENT) {
      expect(bySeat.get(getSeatKey(row, col)), `第 ${row} 排第 ${col} 列`).toBe(id)
    }

    expect(plan.constraints?.sameDeskForbidden).toHaveLength(1)
    expect(plan.constraints?.sameDeskForbidden[0]?.studentA).toBe('s1')
    expect(plan.constraints?.sameDeskForbidden[0]?.studentB).toBe('s2')
    expect(plan.constraints?.adjacentGroupForbidden[0]?.students).toEqual(['s1', 's2', 's4'])
    expect(plan.constraints?.frontRowStudents).toEqual(['s4'])
    expect(plan.constraints?.backRowStudents).toEqual(['s3'])
  })

  it('当前表里的多余人 / 换座位：统计「会变动」与「将腾空」', async () => {
    const { parsed } = await readExport()
    // 当前：s1 原位不动；s6 坐第 4 排第 4 列（导出文件里没人 → 会腾空）
    const current = buildSeatGrid(
      new Map([
        [seatOrdinal(1, 1, CFG), 's1'],
        [seatOrdinal(4, 4, CFG), 's6'],
      ]),
      CFG,
    )
    const plan = planSeatRestore(parsed, ROSTER, current, CFG)
    expect(plan.ok).toBe(true)
    expect(plan.unchanged).toBe(1)
    expect(plan.changed).toBe(PLACEMENT.length - 1)
    expect(plan.clearedSeats).toBe(1)
  })
})

/* ==================== ② 旧版导出文件：按可视化版面恢复 ==================== */

describe('旧版导出文件（没有隐藏数据表）', () => {
  it('按两张可视化工作表的版面识别，仍能恢复 5 个座位', async () => {
    const { read } = await readExport()
    const detection = detectSeatRestoreWorkbook(visualOnly(read), CFG)
    expect(detection.kind).toBe('restore')
    if (detection.kind !== 'restore') return

    const parsed = detection.parsed
    expect(parsed.source).toBe('visual')
    expect(parsed.constraints).toBeUndefined()
    expect(parsed.seats).toHaveLength(CFG.totalSeats)

    const plan = planSeatRestore(parsed, ROSTER, buildSeatGrid(), CFG)
    expect(plan.ok).toBe(true)
    expect(plan.assignable).toBe(PLACEMENT.length)
    // 旧版文件恢复不了约束：明确提示，且保持当前约束（`constraints` 为 undefined）
    expect(plan.constraints).toBeUndefined()
    expect(plan.warnings.some((text) => text.includes('约束'))).toBe(true)
    for (const [row, col, id] of PLACEMENT) {
      const assignment = plan.assignments.find((item) => item.row === row && item.col === col)
      expect(assignment?.studentId).toBe(id)
    }
  })

  it('旧版文件里重名消歧后缀仍能唯一匹配（不靠姓名猜）', async () => {
    const { read } = await readExport()
    const detection = detectSeatRestoreWorkbook(visualOnly(read), CFG)
    if (detection.kind !== 'restore') throw new Error('应当识别为旧版导出文件')
    const plan = planSeatRestore(detection.parsed, ROSTER, buildSeatGrid(), CFG)
    expect(plan.ok).toBe(true)
    expect(plan.rows.find((row) => row.row === 1 && row.col === 8)?.studentId).toBe('s2')
    expect(plan.rows.find((row) => row.row === 7 && row.col === 9)?.studentId).toBe('s3')
  })

  it('行列列表文件不被当成导出文件（旧导入行为不变）', () => {
    const detection = detectSeatRestoreWorkbook(
      {
        sheetNames: ['座位表'],
        sheets: new Map([
          [
            '座位表',
            [
              ['行', '列', '学号', '姓名'],
              [1, 1, '0101', '王小明'],
            ],
          ],
        ]),
      },
      CFG,
    )
    expect(detection.kind).toBe('none')
  })
})

/* ==================== ③ 坏文件：整份拦下，错误可照做 ==================== */

describe('坏文件 / 不兼容文件：明确报错，不产生半份计划', () => {
  it('数据版本比当前新 → 提示升级，不猜着读', async () => {
    const { read } = await readExport()
    const rows = cloneHiddenRows(read)
    rows[metaRowIndex(rows, '数据版本')]![1] = 99
    const parsed = parseSeatDataSheet(rows)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.error).toContain('99')
      expect(parsed.error).toContain('升级')
    }
  })

  it('格式标识不对 → 不按结构化数据读', async () => {
    const { read } = await readExport()
    const rows = cloneHiddenRows(read)
    rows[metaRowIndex(rows, '格式')]![1] = 'someone-else'
    const parsed = parseSeatDataSheet(rows)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain('格式标识')
  })

  it('缺一行座位 → 按「文件不完整」拦下', async () => {
    const { read } = await readExport()
    const rows = cloneHiddenRows(read)
    rows.splice(seatRowIndex(rows, 7, 9), 1)
    const parsed = parseSeatDataSheet(rows)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain('按布局应为 63 行')
  })

  it('重复坐标 → 拦下并点名重复的行', async () => {
    const { read } = await readExport()
    const rows = cloneHiddenRows(read)
    const target = rows[seatRowIndex(rows, 2, 5)] as unknown[]
    target[0] = 1
    target[1] = 1
    const parsed = parseSeatDataSheet(rows)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain('重复记录')
  })

  it('版面被改过（隐藏数据与座位图对不上）→ 不照隐藏数据恢复', async () => {
    const { read } = await readExport()
    const sheetNames = [...read.sheetNames]
    const sheets = new Map(read.sheetNames.map((name) => [name, read.sheets.get(name) ?? []]))
    const studentRows = (sheets.get('学生视角') ?? []).map((row) => [...row])
    let changed = false
    for (const row of studentRows) {
      const index = row.findIndex((cell) => String(cell).trim() === '王小明')
      if (index >= 0) {
        row[index] = '李思远'
        changed = true
        break
      }
    }
    expect(changed).toBe(true)
    sheets.set('学生视角', studentRows)

    const detection = detectSeatRestoreWorkbook({ sheetNames, sheets }, CFG)
    expect(detection.kind).toBe('error')
    if (detection.kind === 'error') {
      expect(detection.error).toContain('不一致')
      expect(detection.error).toContain('重新导出')
    }
  })

  it('看起来是座位图、但版面认不出 → 明确报错（不落到行列导入去乱读）', () => {
    const detection = detectSeatRestoreWorkbook(
      {
        sheetNames: ['学生视角'],
        sheets: new Map([['学生视角', [['随便什么']]]]),
      },
      CFG,
    )
    expect(detection.kind).toBe('error')
    if (detection.kind === 'error') expect(detection.error).toContain('版面无法识别')
  })

  it('固定空位被安排了学生 → 该行拦下，整份不可确认', async () => {
    const { parsed } = await readExport()
    const bad = parsedWith(parsed, (seats) => {
      const seat = occupierAt(seats, 1, 9)
      seat.occupied = true
      seat.studentNo = '0106'
      seat.name = '白马'
      seat.displayName = '白马'
    })
    const plan = planSeatRestore(bad, ROSTER, buildSeatGrid(), CFG)
    expect(plan.ok).toBe(false)
    expect(plan.blocked).toBe(1)
    expect(plan.rows.find((row) => row.action === 'blocked')?.errors.join()).toContain('固定空位')
    // 错误数据不进 assignments
    expect(plan.assignments.some((item) => item.row === 1 && item.col === 9)).toBe(false)
  })

  it('查无此人 / 重名无法确认 → 拦下，不凭姓名猜', async () => {
    const { parsed } = await readExport()
    const unknown = parsedWith(parsed, (seats) => {
      const seat = occupierAt(seats, 3, 3)
      seat.studentNo = ''
      seat.name = '不存在的人'
      seat.displayName = '不存在的人'
    })
    const unknownPlan = planSeatRestore(unknown, ROSTER, buildSeatGrid(), CFG)
    expect(unknownPlan.ok).toBe(false)
    expect(unknownPlan.rows.find((row) => row.row === 3)?.errors.join()).toContain('找不到')

    const ambiguous = parsedWith(parsed, (seats) => {
      const seat = occupierAt(seats, 3, 3)
      seat.studentNo = ''
      seat.name = '张伟'
      seat.displayName = '张伟'
    })
    const ambiguousPlan = planSeatRestore(ambiguous, ROSTER, buildSeatGrid(), CFG)
    expect(ambiguousPlan.ok).toBe(false)
    expect(ambiguousPlan.rows.find((row) => row.row === 3)?.errors.join()).toContain('重名')
  })

  it('同一学生被安排两次 → 拦下，整份不可确认', async () => {
    const { parsed } = await readExport()
    const bad = parsedWith(parsed, (seats) => {
      const seat = occupierAt(seats, 3, 3)
      seat.studentNo = '0101'
      seat.name = '王小明'
      seat.displayName = '王小明'
    })
    const plan = planSeatRestore(bad, ROSTER, buildSeatGrid(), CFG)
    expect(plan.ok).toBe(false)
    expect(plan.errorCount).toBeGreaterThan(0)
  })

  it('布局与当前教室不一致 → 整份拒绝', async () => {
    const { parsed } = await readExport()
    const bad = { ...parsed, layout: { ...parsed.layout, rows: 6 } }
    const plan = planSeatRestore(bad, ROSTER, buildSeatGrid(), CFG)
    expect(plan.ok).toBe(false)
    expect(plan.errors[0]).toContain('不一致')
    expect(plan.assignments).toEqual([])
  })
})

/* ==================== ④ 落库：整表替换 / 失败不写 / 撤销 ==================== */

describe('applySeatRestore：整表替换与撤销', () => {
  let browser: FakeBrowser

  const prefix = appConfig.storageKeyPrefix
  const STUDENTS_KEY = `${prefix}:students`
  const SEAT_KEY = `${prefix}:seatPlans`

  function currentPlacement(store: ReturnType<typeof useSeatStore>) {
    return new Map(
      store.currentSeats.filter((seat) => seat.studentId).map((seat) => [seat.id, seat.studentId!]),
    )
  }

  beforeEach(() => {
    browser = installFakeBrowser()
    setActivePinia(createPinia())
    browser.localStorage.seed(
      STUDENTS_KEY,
      JSON.stringify(
        ROSTER.map((student) => ({ ...student, seatNumber: undefined })) satisfies Student[],
      ),
    )
    const seats = buildSeatGrid(
      new Map([
        [seatOrdinal(1, 1, CFG), 's1'],
        [seatOrdinal(3, 3, CFG), 's3'],
      ]),
      CFG,
    )
    const other = buildSeatGrid(new Map([[seatOrdinal(2, 2, CFG), 's4']]), CFG)
    browser.localStorage.seed(
      SEAT_KEY,
      JSON.stringify([
        {
          id: 'plan-current',
          name: '当前方案',
          createdAt: '',
          updatedAt: '',
          isCurrent: true,
          seats,
          changeLogs: [],
          constraints: {
            ...createEmptySeatPlanConstraints(),
            sameDeskForbidden: [{ id: 'seed', studentA: 's1', studentB: 's2' }],
          },
        },
        {
          id: 'plan-other',
          name: '另一张表',
          createdAt: '',
          updatedAt: '',
          isCurrent: false,
          seats: other,
          changeLogs: [],
          constraints: createEmptySeatPlanConstraints(),
        },
      ]),
    )
  })

  it('未列出的座位一律清空；其他座位表不受影响', async () => {
    const store = useSeatStore()
    useStudentStore()
    const otherBefore = JSON.stringify(store.plans.find((plan) => plan.id === 'plan-other'))

    const outcome = store.applySeatRestore({
      assignments: [
        { row: 1, col: 1, studentId: 's1' },
        { row: 2, col: 5, studentId: 's2' },
      ],
    })
    expect(outcome).toEqual({ ok: true, applied: 2, relocated: 1, cleared: 1 })

    const placement = currentPlacement(store)
    expect(placement.get(getSeatKey(1, 1))).toBe('s1')
    expect(placement.get(getSeatKey(2, 5))).toBe('s2')
    expect(placement.get(getSeatKey(3, 3))).toBeUndefined()
    expect(JSON.stringify(store.plans.find((plan) => plan.id === 'plan-other'))).toBe(otherBefore)

    await nextTick()
    const disk = readRaw(SEAT_KEY)
    expect(disk).toContain('plan-current')
  })

  it('约束一起恢复；撤销把座位与约束都还原', async () => {
    const store = useSeatStore()
    useStudentStore()

    const restoreConstraints: SeatPlanConstraints = {
      ...createEmptySeatPlanConstraints(),
      adjacentGroupForbidden: [{ id: 'new', students: ['s1', 's2', 's4'] }],
      frontRowStudents: ['s4'],
    }
    expect(
      store.applySeatRestore({
        assignments: [{ row: 4, col: 4, studentId: 's1' }],
        constraints: restoreConstraints,
      }).ok,
    ).toBe(true)
    expect(store.currentConstraints.sameDeskForbidden).toHaveLength(0)
    expect(store.currentConstraints.adjacentGroupForbidden).toHaveLength(1)
    expect(store.currentConstraints.frontRowStudents).toEqual(['s4'])

    expect(store.undoSession()).toBe(true)
    expect(currentPlacement(store).get(getSeatKey(1, 1))).toBe('s1')
    expect(currentPlacement(store).get(getSeatKey(3, 3))).toBe('s3')
    expect(store.currentConstraints.sameDeskForbidden).toEqual([
      { id: 'seed', studentA: 's1', studentB: 's2' },
    ])
    expect(store.currentConstraints.adjacentGroupForbidden).toHaveLength(0)
  })

  it('固定空位有人 / 学生不存在 → 整批拒绝，一个字节都不写', async () => {
    const store = useSeatStore()
    useStudentStore()
    await nextTick()
    const before = JSON.stringify(store.plans)

    const fixed = store.applySeatRestore({
      assignments: [{ row: 1, col: 9, studentId: 's1' }],
    })
    expect(fixed.ok).toBe(false)
    expect(fixed.reason).toContain('固定空位')

    const unknown = store.applySeatRestore({
      assignments: [{ row: 1, col: 1, studentId: 'not-a-student' }],
    })
    expect(unknown.ok).toBe(false)

    expect(JSON.stringify(store.plans)).toBe(before)
  })

  it('约束引用不在名单中的学生 → 整批拒绝', async () => {
    const store = useSeatStore()
    useStudentStore()
    const before = JSON.stringify(store.plans)

    const outcome = store.applySeatRestore({
      assignments: [],
      constraints: {
        ...createEmptySeatPlanConstraints(),
        frontRowStudents: ['ghost'],
      },
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toContain('约束')
    expect(JSON.stringify(store.plans)).toBe(before)
  })

  it('整张空座位表也是合法恢复：清空当前方案，可撤销', () => {
    const store = useSeatStore()
    useStudentStore()

    const outcome = store.applySeatRestore({ assignments: [] })
    expect(outcome).toEqual({ ok: true, applied: 0, relocated: 0, cleared: 2 })
    expect(currentPlacement(store).size).toBe(0)
    expect(store.undoSession()).toBe(true)
    expect(currentPlacement(store).size).toBe(2)
  })
})

/* ==================== ⑤ 接线：现有导入入口 + 导出端写全元数据 ==================== */

describe('接线（源码级钉子）', () => {
  const read = (path: string) => readFileSync(path, 'utf8')

  it('座位导入弹窗仍走现有入口，自动识别并二次确认覆盖', () => {
    const source = read('src/views/Seats/components/SeatImportModal.vue')
    expect(source).toContain('parseWorkbook:')
    expect(source).toContain('detectSeatRestoreWorkbook')
    expect(source).toContain('planSeatRestore')
    expect(source).toContain('applySeatRestore')
    expect(source).toContain('确认覆盖当前座位表')
    // 行列列表解析仍在：旧文件不走恢复分支
    expect(source).toContain('parseSeatRows')
  })

  it('导出端把布局 / 方案 / 版本 / 约束写进隐藏数据表', () => {
    const source = read('src/views/Seats/index.vue')
    expect(source).toContain('config: seatStore.config')
    expect(source).toContain('appVersion: import.meta.env.APP_VERSION')
    expect(source).toContain('constraints: seatStore.currentConstraints')
    expect(source).toContain('plan: currentPlan')
  })
})
