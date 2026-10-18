/**
 * 座位图导入自检：**Excel 座位图 → 新建一张座位表**。
 *
 * 这一版盯的是「图能不能读进来、读进来会不会破坏已有数据」，分四层：
 *
 *  ① **我们导出的文件，我们自己的导入端能原样读回来**（结构化数据 + 可视化版面交叉校验）。
 *     这条必须让「写文件」与「读文件」都走真实实现——手写的假数据测不出字段名漂移。
 *  ② **没有隐藏数据的座位图按版面识别**：旧版导出文件、改名后的文件、外部手工座位图，
 *     只要版式符合模板几何（第 5 行列号 1~9、A6:A12 排号 1~7）都能读；
 *     隐藏数据与可见图不一致 / 隐藏数据坏掉时，以可见图为准并提示。
 *  ③ **坏文件一律整份拦下**：版本不认识 / 缺字段 / 坐标非法 / 固定空位有人 / 损坏的行列布局，
 *     都要有可照做的错误文案，且不产生半份计划。
 *  ④ **落库是新建方案，不是覆盖当前方案**：现有座位表原样保留、新表名取自文件名并按序去重、
 *     失败不写一个字节。
 */
import { readFileSync } from 'node:fs'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { installFakeBrowser, type FakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import { readWorkbookSheets } from '@/services/studentImport'
import {
  detectSeatMapWorkbook,
  parseSeatDataSheet,
  planSeatMapImport,
} from '@/services/seatMapImport'
import type { ParsedSeatMap, SeatMapSeatInput } from '@/services/seatMapImport'
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
): Promise<{ read: ReadWorkbookResult; parsed: ParsedSeatMap }> {
  const result = await readWorkbookSheets(bytes ?? (await buildExport()))
  if (!result.ok) throw new Error(`读取导出文件失败：${result.error}`)
  const detection = detectSeatMapWorkbook(result.workbook, CFG)
  if (detection.kind !== 'map') {
    throw new Error(`没有识别成座位图：${detection.kind === 'error' ? detection.error : 'none'}`)
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
  parsed: ParsedSeatMap,
  mutate: (seats: SeatMapSeatInput[]) => void,
): ParsedSeatMap {
  const seats = parsed.seats.map((seat) => ({ ...seat }))
  mutate(seats)
  return { ...parsed, seats, warnings: [] }
}

function occupierAt(seats: SeatMapSeatInput[], row: number, col: number): SeatMapSeatInput {
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

  it('计划：5 个座位全部可导入，约束回到当前学生 id', async () => {
    const { parsed } = await readExport()
    const plan = planSeatMapImport(parsed, ROSTER, CFG)

    expect(plan.ok).toBe(true)
    expect(plan.totalSeats).toBe(CFG.totalSeats)
    expect(plan.occupiedSeats).toBe(PLACEMENT.length)
    expect(plan.emptySeats).toBe(CFG.totalSeats - PLACEMENT.length)
    expect(plan.assignable).toBe(PLACEMENT.length)
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
})

/* ==================== ② 没有隐藏数据：按可见版面识别 ==================== */

describe('没有隐藏数据表：按可视化版面识别', () => {
  it('旧版导出文件（只有两张可视化工作表）按版面识别', async () => {
    const { read } = await readExport()
    const detection = detectSeatMapWorkbook(visualOnly(read), CFG)
    expect(detection.kind).toBe('map')
    if (detection.kind !== 'map') return

    const parsed = detection.parsed
    expect(parsed.source).toBe('visual')
    expect(parsed.visualFallback).toBe('missing')
    expect(parsed.constraints).toBeUndefined()
    expect(parsed.seats).toHaveLength(CFG.totalSeats)

    const plan = planSeatMapImport(parsed, ROSTER, CFG)
    expect(plan.ok).toBe(true)
    expect(plan.assignable).toBe(PLACEMENT.length)
    // 旧版文件恢复不了约束：明确提示，且新表用空约束（`constraints` 为 undefined）
    expect(plan.constraints).toBeUndefined()
    expect(plan.warnings.some((text) => text.includes('约束'))).toBe(true)
    for (const [row, col, id] of PLACEMENT) {
      const assignment = plan.assignments.find((item) => item.row === row && item.col === col)
      expect(assignment?.studentId).toBe(id)
    }
  })

  it('旧版文件里重名消歧后缀仍能唯一匹配（不靠姓名猜）', async () => {
    const { read } = await readExport()
    const detection = detectSeatMapWorkbook(visualOnly(read), CFG)
    if (detection.kind !== 'map') throw new Error('应当识别为座位图')
    const plan = planSeatMapImport(detection.parsed, ROSTER, CFG)
    expect(plan.ok).toBe(true)
    expect(plan.rows.find((row) => row.row === 1 && row.col === 8)?.studentId).toBe('s2')
    expect(plan.rows.find((row) => row.row === 7 && row.col === 9)?.studentId).toBe('s3')
  })

  it('外部手工座位图：任意表名，只要版面符合模板几何就能识别', async () => {
    const { read } = await readExport()
    const rows = read.sheets.get('学生视角') ?? []
    const workbook: ReadWorkbookResult = {
      sheetNames: ['我的手工座位图'],
      sheets: new Map([['我的手工座位图', rows]]),
    }
    const detection = detectSeatMapWorkbook(workbook, CFG)
    expect(detection.kind).toBe('map')
    if (detection.kind !== 'map') return

    expect(detection.parsed.source).toBe('visual')
    expect(detection.parsed.sourceSheet).toBe('我的手工座位图')
    expect(detection.parsed.visualFallback).toBe('missing')

    const plan = planSeatMapImport(detection.parsed, ROSTER, CFG)
    expect(plan.ok).toBe(true)
    expect(plan.assignable).toBe(PLACEMENT.length)
  })

  it('隐藏数据与可见图不一致 → 按可见图导入并提示，不整份拦下', async () => {
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

    const detection = detectSeatMapWorkbook({ sheetNames, sheets }, CFG)
    expect(detection.kind).toBe('map')
    if (detection.kind !== 'map') return
    expect(detection.parsed.source).toBe('visual')
    expect(detection.parsed.sourceSheet).toBe('学生视角')
    expect(detection.parsed.visualFallback).toBe('mismatch')
    expect(detection.parsed.warnings.some((text) => text.includes('不一致'))).toBe(true)
  })

  it('隐藏数据坏掉、可见图认得出 → 回退可见图并提示', async () => {
    const { read } = await readExport()
    const sheetNames = [...read.sheetNames]
    const sheets = new Map(read.sheetNames.map((name) => [name, read.sheets.get(name) ?? []]))
    const hidden = cloneHiddenRows(read)
    hidden[metaRowIndex(hidden, '数据版本')]![1] = 99
    sheets.set(SEAT_EXPORT_SHEET, hidden)

    const detection = detectSeatMapWorkbook({ sheetNames, sheets }, CFG)
    expect(detection.kind).toBe('map')
    if (detection.kind !== 'map') return
    expect(detection.parsed.source).toBe('visual')
    expect(detection.parsed.visualFallback).toBe('unreadable')
    expect(detection.parsed.warnings.some((text) => text.includes('隐藏数据无法读取'))).toBe(true)
  })

  it('行列列表文件不被当成座位图（旧导入行为不变）', () => {
    const detection = detectSeatMapWorkbook(
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

  it('看起来是座位图、但版面认不出 → 明确报错（不落到行列导入去乱读）', () => {
    const detection = detectSeatMapWorkbook(
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
    const plan = planSeatMapImport(bad, ROSTER, CFG)
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
    const unknownPlan = planSeatMapImport(unknown, ROSTER, CFG)
    expect(unknownPlan.ok).toBe(false)
    expect(unknownPlan.rows.find((row) => row.row === 3)?.errors.join()).toContain('找不到')

    const ambiguous = parsedWith(parsed, (seats) => {
      const seat = occupierAt(seats, 3, 3)
      seat.studentNo = ''
      seat.name = '张伟'
      seat.displayName = '张伟'
    })
    const ambiguousPlan = planSeatMapImport(ambiguous, ROSTER, CFG)
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
    const plan = planSeatMapImport(bad, ROSTER, CFG)
    expect(plan.ok).toBe(false)
    expect(plan.errorCount).toBeGreaterThan(0)
  })

  it('布局与当前教室不一致 → 整份拒绝', async () => {
    const { parsed } = await readExport()
    const bad = { ...parsed, layout: { ...parsed.layout, rows: 6 } }
    const plan = planSeatMapImport(bad, ROSTER, CFG)
    expect(plan.ok).toBe(false)
    expect(plan.errors[0]).toContain('不一致')
    expect(plan.assignments).toEqual([])
  })
})

/* ==================== ④ 落库：新建座位表，现有方案不动 ==================== */

describe('createPlanFromSeatMap：新建座位表', () => {
  let browser: FakeBrowser

  const prefix = appConfig.storageKeyPrefix
  const STUDENTS_KEY = `${prefix}:students`
  const SEAT_KEY = `${prefix}:seatPlans`

  function placementOf(store: ReturnType<typeof useSeatStore>) {
    return new Map(
      store.currentSeats.filter((seat) => seat.studentId).map((seat) => [seat.id, seat.studentId!]),
    )
  }

  /** 现有两张方案：当前方案 s1(1,1)、s3(3,3) + 一条同桌约束；另一张 s4(2,2) */
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

  it('新建并切换过去；现有所有座位表原样保留', () => {
    const store = useSeatStore()
    useStudentStore()
    const before = store.plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      seats: JSON.stringify(plan.seats),
      constraints: JSON.stringify(plan.constraints),
    }))

    const outcome = store.createPlanFromSeatMap({
      baseName: '我的座位图',
      assignments: [
        { row: 1, col: 1, studentId: 's1' },
        { row: 2, col: 5, studentId: 's2' },
      ],
    })
    expect(outcome.ok).toBe(true)
    expect(outcome.planName).toBe('我的座位图')
    expect(outcome.applied).toBe(2)

    // 新表成为当前方案，原先的座位安排原样在新表里
    expect(store.currentPlan?.name).toBe('我的座位图')
    const placement = placementOf(store)
    expect(placement.get(getSeatKey(1, 1))).toBe('s1')
    expect(placement.get(getSeatKey(2, 5))).toBe('s2')
    expect(placement.size).toBe(2)

    // 原有方案：只被取消 isCurrent，座位与约束一个字节都没变
    expect(store.plans).toHaveLength(3)
    const after = store.plans
      .filter((plan) => plan.id !== outcome.planId)
      .map((plan) => ({
        id: plan.id,
        name: plan.name,
        seats: JSON.stringify(plan.seats),
        constraints: JSON.stringify(plan.constraints),
      }))
    expect(after).toEqual(before)
    expect(store.plans.find((plan) => plan.id === 'plan-current')?.isCurrent).toBe(false)
  })

  it('文件名重名时自动加序号（同一个文件反复导入不互相覆盖）', () => {
    const store = useSeatStore()
    useStudentStore()

    const first = store.createPlanFromSeatMap({ baseName: '座位图', assignments: [] })
    const second = store.createPlanFromSeatMap({ baseName: '座位图', assignments: [] })
    const third = store.createPlanFromSeatMap({ baseName: '座位图', assignments: [] })

    expect(first.planName).toBe('座位图')
    expect(second.planName).toBe('座位图 2')
    expect(third.planName).toBe('座位图 3')
  })

  it('隐藏数据里的约束一起带到新表；可见图来源用空约束', () => {
    const store = useSeatStore()
    useStudentStore()

    const withConstraints = store.createPlanFromSeatMap({
      baseName: '带约束',
      assignments: [{ row: 4, col: 4, studentId: 's1' }],
      constraints: {
        ...createEmptySeatPlanConstraints(),
        adjacentGroupForbidden: [{ id: 'new', students: ['s1', 's2', 's4'] }],
        frontRowStudents: ['s4'],
      },
    })
    expect(withConstraints.ok).toBe(true)
    expect(store.currentConstraints.adjacentGroupForbidden).toHaveLength(1)
    expect(store.currentConstraints.frontRowStudents).toEqual(['s4'])

    const visual = store.createPlanFromSeatMap({
      baseName: '可见图',
      assignments: [{ row: 4, col: 4, studentId: 's1' }],
    })
    expect(visual.ok).toBe(true)
    // 不传 constraints = 新座位表的排座约束为空
    expect(store.currentConstraints).toEqual(createEmptySeatPlanConstraints())
  })

  it('固定空位有人 / 学生不存在 → 整批拒绝，一个字节都不写', () => {
    const store = useSeatStore()
    useStudentStore()
    const before = JSON.stringify(store.plans)

    const fixed = store.createPlanFromSeatMap({
      baseName: '坏图',
      assignments: [{ row: 1, col: 9, studentId: 's1' }],
    })
    expect(fixed.ok).toBe(false)
    expect(fixed.reason).toContain('固定空位')

    const unknown = store.createPlanFromSeatMap({
      baseName: '坏图',
      assignments: [{ row: 1, col: 1, studentId: 'not-a-student' }],
    })
    expect(unknown.ok).toBe(false)

    expect(JSON.stringify(store.plans)).toBe(before)
  })

  it('重复座位 / 重复学生 / 约束引用失效 → 整批拒绝', () => {
    const store = useSeatStore()
    useStudentStore()
    const before = JSON.stringify(store.plans)

    const duplicateSeat = store.createPlanFromSeatMap({
      assignments: [
        { row: 2, col: 2, studentId: 's1' },
        { row: 2, col: 2, studentId: 's2' },
      ],
    })
    expect(duplicateSeat.ok).toBe(false)

    const duplicateStudent = store.createPlanFromSeatMap({
      assignments: [
        { row: 2, col: 2, studentId: 's1' },
        { row: 3, col: 3, studentId: 's1' },
      ],
    })
    expect(duplicateStudent.ok).toBe(false)

    const ghost = store.createPlanFromSeatMap({
      assignments: [],
      constraints: {
        ...createEmptySeatPlanConstraints(),
        frontRowStudents: ['ghost'],
      },
    })
    expect(ghost.ok).toBe(false)
    expect(ghost.reason).toContain('约束')
    expect(JSON.stringify(store.plans)).toBe(before)
  })

  it('整张空座位表也是合法导入：新建空表并切换，不影响原方案', () => {
    const store = useSeatStore()
    useStudentStore()
    const original = store.currentPlan?.id

    const outcome = store.createPlanFromSeatMap({ baseName: '空表', assignments: [] })
    expect(outcome).toEqual({
      ok: true,
      planId: store.currentPlan?.id,
      planName: '空表',
      applied: 0,
    })
    expect(placementOf(store).size).toBe(0)

    // 换回原方案，原安排仍在
    store.switchPlan(original!)
    expect(placementOf(store).size).toBe(2)
  })

  it('新建方案会结束「本轮修改」：撤销按钮不会把新表撤到旧方案上', () => {
    const store = useSeatStore()
    useStudentStore()

    store.createPlanFromSeatMap({ baseName: '新表', assignments: [] })
    expect(store.canUndoSession).toBe(false)
    expect(store.undoSession()).toBe(false)
  })
})

/* ==================== ⑤ 接线：导入入口 + 导出端写全元数据 ==================== */

describe('接线（源码级钉子）', () => {
  const read = (path: string) => readFileSync(path, 'utf8')

  it('座位导入弹窗走座位图识别，并且是「新建座位表」而不是覆盖', () => {
    const source = read('src/views/Seats/components/SeatImportModal.vue')
    expect(source).toContain('parseWorkbook:')
    expect(source).toContain('detectSeatMapWorkbook')
    expect(source).toContain('planSeatMapImport')
    expect(source).toContain('createPlanFromSeatMap')
    // 覆盖式恢复的二次确认已经撤掉，文案也不许留
    expect(source).not.toContain('确认覆盖当前座位表')
    expect(source).not.toContain('applySeatRestore')
    // 行列列表解析仍在：旧文件不走座位图分支
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
