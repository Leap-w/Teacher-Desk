/**
 * Excel 座位导入（V1.1.2 Phase 1）。
 *
 * 与 `services/studentImport.ts` 同一套分层，理由也同一条：
 *   ① 读文件（唯一碰 xlsx / 字节的一层）复用它已有的 `readSheetRows`——文件头校验、
 *      动态 `import('xlsx')`、空行保留、`raw: false` 这些坑只该修一次；
 *   ② **本文件剩下的全是纯函数**（不碰 xlsx、不碰 DOM、不碰 store），
 *      校验规则、匹配口径与统计都在这层，因此能在 node 常驻自检里被直接喂二维数组跑。
 *
 * 导入语义（**明确写在这里，界面上也要照说**）：表格描述的是「学生 → 座位」的指派，
 * 确认后**逐条应用**——只动表格里列出的座位，以及被这些学生让出来的原座位；
 * 表格没提到的座位保持原样。**不走覆盖式整表替换**，避免一份不完整的表把半个班清空。
 *
 * 一行有错 → 整批不允许确认（阻断性错误），**当前方案一个字节都不改**（§导入校验）。
 */
import type { ClassroomConfig } from '@/types/classroom'
import { DEFAULT_CLASSROOM_CONFIG } from '@/types/classroom'
import { isValidSeatPosition, seatPositionShort } from '@/utils/seat'
import { buildNameCounts, formatStudentShortName } from '@/utils/student'
import type { Student } from '@/types'
import { cellText, isBlankRow, normalizeHeader } from '@/services/sheetCell'

/** 导入计划里的一条指派（store 只认这个形状；组件不得自行拼座位数组） */
export interface SeatImportAssignment {
  /** 物理排号 1~rows */
  row: number
  /** 物理列号 1~cols */
  col: number
  studentId: string
}

/** 一行数据在文件里的位置与原始内容 */
export interface ParsedSeatRow {
  /** Excel 里的实际行号（1 起，含表头）——预览里要给教师看「第几行」 */
  rowNumber: number
  /** 行（排）号；无法解析为整数时为 null */
  row: number | null
  /** 列号；无法解析为整数时为 null */
  col: number | null
  studentNo: string
  name: string
  /** 拦截原因：非空表示这一行不会写入 */
  errors: string[]
  /** 提示：不拦截，只是让教师知道 */
  warnings: string[]
}

/** 表头识别结果：列下标，-1 表示没有这一列 */
interface ColumnMap {
  row: number
  col: number
  studentNo: number
  name: number
}

/** 列名与常见别名的对应表（**先匹配到的列胜出**，顺序即优先级） */
const COLUMN_ALIASES: Array<{ key: keyof ColumnMap; label: string; aliases: string[] }> = [
  { key: 'row', label: '行', aliases: ['行', '排', '行号', '排号', '座位行', '座位排'] },
  { key: 'col', label: '列', aliases: ['列', '列号', '座位列', '纵列'] },
  { key: 'studentNo', label: '学号', aliases: ['学号', '学籍号', '考号'] },
  { key: 'name', label: '姓名', aliases: ['姓名', '名字', '学生姓名'] },
]

/** 模板提示（弹窗首屏与错误文案共用一份说法） */
export const SEAT_IMPORT_HEADERS = ['行', '列', '学号', '姓名'] as const

function mapColumns(headerRow: unknown[]): ColumnMap {
  const map: ColumnMap = { row: -1, col: -1, studentNo: -1, name: -1 }
  headerRow.forEach((cell, index) => {
    const text = normalizeHeader(cell)
    if (!text) return
    for (const column of COLUMN_ALIASES) {
      if (map[column.key] !== -1) continue
      if (!column.aliases.includes(text)) continue
      map[column.key] = index
      return
    }
  })
  return map
}

/** 「第3排」「3」「3 列」都能读成 3；读不出整数返回 null */
function parseSeatIndex(text: string): number | null {
  const cleaned = text.replace(/^第/, '').replace(/[排位列号\s]/g, '')
  if (!/^\d+$/.test(cleaned)) return null
  return Number(cleaned)
}

export type ParseSeatResult =
  | { ok: true; rows: ParsedSeatRow[]; columns: string[]; blankRows: number }
  | { ok: false; error: string }

/**
 * 二维数组 → 逐行解析结果（纯函数）。
 * 这一层只判「这一行本身是否读得懂」（行列非法 / 学生信息为空），
 * 与名单的匹配、坐标与学生的重复留给 `planSeatImport`——那边才有学生表和当前方案。
 */
export function parseSeatRows(
  rows: unknown[][],
  config: ClassroomConfig = DEFAULT_CLASSROOM_CONFIG,
): ParseSeatResult {
  if (rows.length === 0) return { ok: false, error: '表格里没有任何内容' }

  const map = mapColumns(rows[0])
  const missing: string[] = []
  if (map.row === -1) missing.push('行')
  if (map.col === -1) missing.push('列')
  if (missing.length > 0) {
    return {
      ok: false,
      error: `没有找到「${missing.join('」「')}」列。请确认第一行是表头，并含「${SEAT_IMPORT_HEADERS.join(' / ')}」这几列`,
    }
  }
  if (map.studentNo === -1 && map.name === -1) {
    return {
      ok: false,
      error: `没有找到「学号」或「姓名」列，无法确定每行安排的是谁。表头应含「${SEAT_IMPORT_HEADERS.join(' / ')}」`,
    }
  }
  const columns = COLUMN_ALIASES.filter((column) => map[column.key] !== -1).map(
    (column) => column.label,
  )

  const parsed: ParsedSeatRow[] = []
  let blankRows = 0
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index]
    if (!Array.isArray(row) || isBlankRow(row, map)) {
      blankRows += 1
      continue
    }

    const errors: string[] = []
    const warnings: string[] = []
    const at = (key: keyof ColumnMap): string => (map[key] >= 0 ? cellText(row[map[key]]) : '')

    const rowText = at('row')
    const colText = at('col')
    const seatRow = parseSeatIndex(rowText)
    const seatCol = parseSeatIndex(colText)

    if (seatRow === null) {
      errors.push(rowText ? `行「${rowText}」不是排号` : '行为空')
    } else if (!isValidSeatPosition(seatRow, 1, config)) {
      errors.push(`行 ${seatRow} 超出范围（应为 1~${config.rows}）`)
    }
    if (seatCol === null) {
      errors.push(colText ? `列「${colText}」不是列号` : '列为空')
    } else if (!isValidSeatPosition(1, seatCol, config)) {
      errors.push(`列 ${seatCol} 超出范围（应为 1~${config.cols}）`)
    }

    const studentNo = at('studentNo')
    const name = at('name')
    if (!studentNo && !name) errors.push('未填写学号与姓名，无法确定学生')

    parsed.push({
      rowNumber: index + 1,
      row: seatRow !== null && isValidSeatPosition(seatRow, 1, config) ? seatRow : null,
      col: seatCol !== null && isValidSeatPosition(1, seatCol, config) ? seatCol : null,
      studentNo,
      name,
      errors,
      warnings,
    })
  }

  if (parsed.length === 0) return { ok: false, error: '表头下面没有数据行（只找到表头）' }
  return { ok: true, rows: parsed, columns, blankRows }
}

/** 该行相对当前方案的变化：same = 原位不动；new = 原本没就座；move = 换了个座位 */
export type SeatImportChange = 'new' | 'move' | 'same'

export interface SeatImportPreviewRow extends ParsedSeatRow {
  action: 'assign' | 'blocked'
  /** 命中后确定的座位与展示名（action 为 assign 时才有） */
  studentId?: string
  studentLabel?: string
  /** 座位短文案（如「2排3列」） */
  seatLabel: string
  change?: SeatImportChange
}

export interface SeatImportResult {
  /** 数据行数（不含表头、不含全空行） */
  total: number
  /** 全空行条数（已跳过，只在提示里说一声） */
  blankRows: number
  /** 坐标合法的行数 */
  validSeats: number
  /** 可导入座位数（= 无错误的行数） */
  assignable: number
  /** 被拦行数 */
  blocked: number
  /** 新安排人数：本次座位会发生变化的行数（不含原位不动的） */
  changed: number
  /** 无法识别的学生（查无此人 / 重名无法确认） */
  unknownStudents: number
  /** 重复座位行数（同一坐标出现多次） */
  duplicateSeats: number
  /** 重复占座行数（同一名学生被安排到多个座位） */
  duplicateStudents: number
  /** 错误条数（> 0 即不允许确认导入） */
  errorCount: number
  rows: SeatImportPreviewRow[]
  plan: { assignments: SeatImportAssignment[] }
}

/** 学生表索引：学号 → 学生（先到先得）/ 姓名 → 学生列表 */
interface StudentIndex {
  byStudentNo: Map<string, Student>
  byName: Map<string, Student[]>
}

export function buildStudentIndex(students: readonly Student[]): StudentIndex {
  const byStudentNo = new Map<string, Student>()
  const byName = new Map<string, Student[]>()
  for (const student of students) {
    if (student.deletedAt) continue
    const studentNo = student.studentNo?.trim()
    if (studentNo && !byStudentNo.has(studentNo)) byStudentNo.set(studentNo, student)
    const list = byName.get(student.name) ?? []
    list.push(student)
    byName.set(student.name, list)
  }
  return { byStudentNo, byName }
}

/** 模板下载用的示例行（弹窗首屏展示，说明行列是「物理座位坐标」而不是学生编号） */
export const SEAT_IMPORT_SAMPLE = [
  ['1', '1', '0101', '旦增卓玛'],
  ['1', '4', '0102', '扎西顿珠'],
] as const

/**
 * 与名单 / 当前方案合并成一份可执行的导入计划（纯函数，无副作用）。
 *
 * 校验口径（需求逐条落地）：
 * ① 行 1~7、列 1~9；② 坐标重复；③ 学生重复占座；④ 学号必须存在于学生名单；
 * ⑤ 学号与姓名必须对得上；⑥ 重名且未填学号 → **不许自动导入**，提示「存在重名学生，请使用学号确认。」；
 * ⑦ 查无此人 → 无法识别；⑧ 空行已由 parse 层跳过（这里只统计条数）。
 *
 * **错误数据绝不进 plan**：教师看到预览上写着「3 行被拦下」，落库时就不该悄悄写进去。
 * 因此 `blocked > 0` 时页面禁用确认按钮，`plan.assignments` 只含无错误的行。
 */
export function planSeatImport(
  rows: readonly ParsedSeatRow[],
  students: readonly Student[],
  currentSeats: ReadonlyArray<{ row: number; col: number; studentId?: string }>,
  blankRows = 0,
): SeatImportResult {
  const index = buildStudentIndex(students)
  // 重名消歧要看整份名册（v3.3.1）：只算一次，预览里每行共用
  const nameCounts = buildNameCounts(students)

  /** 当前方案：学生 → 座位（同一学生至多一处）、座位 id → 学生 */
  const currentSeatOfStudent = new Map<string, string>()
  const currentStudentAtSeat = new Map<string, string>()
  for (const seat of currentSeats) {
    if (!seat.studentId) continue
    const key = `${seat.row}-${seat.col}`
    currentStudentAtSeat.set(key, seat.studentId)
    if (!currentSeatOfStudent.has(seat.studentId)) currentSeatOfStudent.set(seat.studentId, key)
  }

  /** 「先到先得」的记录表：只由**无错误的行**填充，避免被拦行把坐标 / 学生占掉 */
  const seatOwner = new Map<string, number>()
  const studentSeatRow = new Map<string, number>()

  const previewRows: SeatImportPreviewRow[] = []
  const assignments: SeatImportAssignment[] = []
  let validSeats = 0
  let unknownStudents = 0
  let duplicateSeats = 0
  let duplicateStudents = 0
  let errorCount = 0
  let changed = 0

  for (const row of rows) {
    const seatLabel =
      row.row !== null && row.col !== null ? seatPositionShort(row.row, row.col) : '—'
    const errors = [...row.errors]
    const warnings = [...row.warnings]
    let studentId: string | undefined
    let matched: Student | undefined

    if (row.row !== null && row.col !== null) {
      validSeats += 1
      const seatKey = `${row.row}-${row.col}`
      const seatOwnerRow = seatOwner.get(seatKey)
      if (seatOwnerRow !== undefined) {
        duplicateSeats += 1
        errors.push(`座位 ${seatLabel} 与第 ${seatOwnerRow} 行重复`)
      } else {
        // 学生匹配：优先学号；学号为空才用姓名（重名一律拦下）
        if (row.studentNo) {
          const candidate = index.byStudentNo.get(row.studentNo)
          if (!candidate) {
            unknownStudents += 1
            errors.push(`学号 ${row.studentNo} 不在学生名单中`)
          } else if (row.name && row.name !== candidate.name) {
            errors.push(`姓名与学号不匹配：学号 ${row.studentNo} 是「${candidate.name}」`)
          } else {
            matched = candidate
            studentId = candidate.id
          }
        } else {
          const candidates = index.byName.get(row.name) ?? []
          if (candidates.length === 0) {
            unknownStudents += 1
            errors.push(`学生名单中找不到「${row.name}」`)
          } else if (candidates.length > 1) {
            unknownStudents += 1
            errors.push('存在重名学生，请使用学号确认。')
          } else {
            matched = candidates[0]!
            studentId = matched.id
            warnings.push('未填学号，本次按姓名匹配')
          }
        }

        if (studentId && errors.length === 0) {
          const ownerRow = studentSeatRow.get(studentId)
          if (ownerRow !== undefined) {
            duplicateStudents += 1
            errors.push(`该学生已在第 ${ownerRow} 行安排座位`)
            studentId = undefined
            matched = undefined
          }
        }
      }

      if (studentId && matched && errors.length === 0) {
        seatOwner.set(seatKey, row.rowNumber)
        studentSeatRow.set(studentId, row.rowNumber)
        assignments.push({ row: row.row, col: row.col, studentId })
        const here = currentStudentAtSeat.get(seatKey)
        const elsewhere = currentSeatOfStudent.get(studentId)
        const change: SeatImportChange = here === studentId ? 'same' : elsewhere ? 'move' : 'new'
        if (change !== 'same') changed += 1
        previewRows.push({
          ...row,
          errors,
          warnings,
          seatLabel,
          action: 'assign',
          studentId,
          studentLabel: formatStudentShortName(matched, nameCounts),
          change,
        })
        continue
      }
    }

    errorCount += errors.length
    previewRows.push({
      ...row,
      errors,
      warnings,
      seatLabel,
      action: 'blocked',
      change: undefined,
    })
  }

  const assignable = previewRows.filter((row) => row.action === 'assign').length
  return {
    total: rows.length,
    blankRows,
    validSeats,
    assignable,
    blocked: previewRows.length - assignable,
    changed,
    unknownStudents,
    duplicateSeats,
    duplicateStudents,
    errorCount,
    rows: previewRows,
    plan: { assignments },
  }
}

/** 预览用：格式一句话说明（弹窗与空态共用） */
export const SEAT_IMPORT_HINT = `第一行为表头，需要「${SEAT_IMPORT_HEADERS.join(' / ')}」四列；行列填真实座位坐标（行 1~7、列 1~9），不是学生编号`
