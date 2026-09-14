/**
 * 值日 Excel 批量导入（V1.1.5）。
 *
 * 与 `services/seatImport.ts` / `services/courseImport.ts` 同一套分层：
 * 读文件复用 `readSheetRows`（唯一碰 xlsx 的一层），**本文件全是纯函数**——
 * 校验规则与统计都在这层，能在 node 常驻自检里直接喂二维数组跑。
 * 流程同款：选择 → 解析 → 校验 → 预览 → 确认 → 一次性写入；有错**禁止确认**、取消**不写**。
 *
 * 两条独立管道：
 * - **分组导入**（`组别 / 学号 / 姓名`）：按组别更新或创建值日组；
 *   **未涉及的分组保持不变**（不整班清空）。学生匹配优先学号（姓名辅助，重名一律拦下，
 *   与座位 / 学生导入同一提示语）；同一学生在表内出现多次 → 拦下。
 * - **安排导入**（`日期 / 组别`，可带星期列）：把一行行「某天由某组值日」翻译成
 *   轮换模型的**起点 + 组顺序**（本模块的安排就是轮换，见 types/duty.ts；
 *   不为导入强造第二套「星期 → 组」模型）。要求表里的日期恰好覆盖连续的值日日，
 *   这样组顺序才能被唯一确定；未提到的组保持相对顺序排在其后。
 */
import { addDaysToDateKey, isDateKey, isWeekendDateKey, weekdayOfDateKey } from '@/utils/date'
import { buildStudentIndex } from '@/services/seatImport'
import type { Student } from '@/types'
import type { DutyGroup, DutySettings } from '@/types/duty'
import type { Weekday } from '@/types/timetable'
import { WEEKDAY_LABELS } from '@/utils/timetable'
import { cellText, isBlankRow, normalizeHeader } from '@/services/sheetCell'

/* ========== 共用小工具 ========== */

interface ParsedColumns {
  map: Record<string, number>
  missing: string[]
}

/** 按别名表找列；返回列下标映射。`required` 里的列缺失才算整体失败（可选列找不到只是没有这一列） */
function mapColumns(
  headerRow: unknown[],
  aliases: Record<string, string[]>,
  required: readonly string[] = [],
): ParsedColumns {
  const map: Record<string, number> = {}
  for (const key of Object.keys(aliases)) map[key] = -1
  headerRow.forEach((cell, index) => {
    const text = normalizeHeader(cell)
    if (!text) return
    for (const [key, names] of Object.entries(aliases)) {
      if (map[key] !== -1) continue
      if (!names.includes(text)) continue
      map[key] = index
      return
    }
  })
  const missing = required.filter((key) => map[key] === -1)
  return { map, missing }
}

/**
 * 组名归一（分组导入用）：「第1组」「第 1 组」「1」「1组」都归到数字 1。
 * 提不出数字的组名按原文小写匹配（教师可能用了「A组」这类命名）。
 */
export function dutyGroupNameKey(name: string): string {
  const value = name.replace(/\s+/g, '')
  const digits = /\d+/.exec(value.replace(/^[第]/, '').replace(/组$/, ''))
  if (digits) return `#${Number(digits[0])}`
  return value.toLowerCase()
}

/* ========== 分组导入 ========== */

/** 模板表头与示例（弹窗首屏与错误文案共用一份说法） */
export const DUTY_GROUP_HEADERS = ['组别', '学号', '姓名'] as const

export const DUTY_GROUP_SAMPLE: readonly (readonly string[])[] = [
  ['1', '20250101', '张三'],
  ['1', '20250102', '李四'],
  ['2', '20250104', '赵六'],
]

export const DUTY_GROUP_HINT =
  '「组别」写组序号或组名（如 1 / 第1组）；优先按学号匹配学生，没填学号时按姓名匹配（重名会被拦下）；同一学生只能出现在一个组'

export interface ParsedDutyGroupRow {
  rowNumber: number
  /** 原文组名（预览展示用） */
  groupNameText: string
  studentNo: string
  name: string
  errors: string[]
  warnings: string[]
}

export type ParseDutyGroupResult =
  | { ok: true; rows: ParsedDutyGroupRow[]; columns: string[]; blankRows: number }
  | { ok: false; error: string }

/** 二维数组 → 逐行解析（纯函数）。这一层只判「行本身读不读得懂」，组与学生的匹配留给 plan */
export function parseDutyGroupRows(rows: unknown[][]): ParseDutyGroupResult {
  if (rows.length === 0) return { ok: false, error: '表格里没有任何内容' }
  const { map, missing } = mapColumns(
    rows[0],
    {
      group: ['组别', '组', '组名', '小组'],
      studentNo: ['学号', '学生学号'],
      name: ['姓名', '学生', '学生姓名', '名字'],
    },
    ['group', 'studentNo', 'name'],
  )
  if (missing.length > 0) {
    return {
      ok: false,
      error: `没有找到「${missing.join('」「')}」列。请确认第一行是表头，并含「${DUTY_GROUP_HEADERS.join(' / ')}」`,
    }
  }

  const parsed: ParsedDutyGroupRow[] = []
  let blankRows = 0
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index]
    if (!Array.isArray(row) || isBlankRow(row, map)) {
      blankRows += 1
      continue
    }
    const errors: string[] = []
    const groupNameText = cellText(row[map.group])
    if (!groupNameText) errors.push('组别为空')
    const studentNo = cellText(row[map.studentNo])
    const name = cellText(row[map.name])
    if (!studentNo && !name) errors.push('学号与姓名都为空，无法确定学生')
    parsed.push({ rowNumber: index + 1, groupNameText, studentNo, name, errors, warnings: [] })
  }
  if (parsed.length === 0) return { ok: false, error: '表头下面没有数据行（只找到表头）' }
  const columns = Object.entries(map)
    .filter(([, index]) => index >= 0)
    .map(([key]) => ({ group: '组别', studentNo: '学号', name: '姓名' })[key] ?? key)
  return { ok: true, rows: parsed, columns, blankRows }
}

export interface DutyGroupImportRow extends ParsedDutyGroupRow {
  action: 'assign' | 'blocked'
  /** 匹配到的学生展示名（重名区分口径「姓名（学号后四位）」） */
  studentLabel?: string
  /** 目标组名（沿用现有组名；新建组用表内原文） */
  groupName?: string
  /** 目标组是新建还是更新现有 */
  create?: boolean
}

export interface DutyGroupImportPlan {
  /** 要更新的现有组（按 id） */
  updates: Array<{ id: string; name: string; studentIds: string[] }>
  /** 要新建的组（追加到队尾；组序 = 轮换顺序） */
  creates: Array<{ name: string; studentIds: string[] }>
}

export interface DutyGroupImportResult {
  total: number
  blankRows: number
  importable: number
  blocked: number
  /** 表里出现的组数（更新 + 新建） */
  groupsTouched: number
  groupsCreated: number
  errorCount: number
  rows: DutyGroupImportRow[]
  plan: DutyGroupImportPlan
}

/**
 * 与学生名单、现有分组合并成分组导入计划（纯函数，无副作用）。
 * 校验：学号必须存在、姓名与学号一致、无学号时按姓名匹配（重名拦下，提示语与
 * 座位导入一致）、同一学生在表内出现多次拦下；学生已属于**未涉及**的组只警告不拦
 * （「未涉及的分组保持不变」是明确语义，教师看得到提醒，自己决定）。
 */
export function planDutyGroupImport(
  rows: readonly ParsedDutyGroupRow[],
  students: readonly Student[],
  existingGroups: readonly DutyGroup[],
): DutyGroupImportResult {
  const index = buildStudentIndex(students)
  const groupByKey = new Map<string, DutyGroup>()
  for (const group of existingGroups) groupByKey.set(dutyGroupNameKey(group.name), group)

  const previewRows: DutyGroupImportRow[] = []
  /** 组 key → 组员（先到先得；被拦的行不占组员位） */
  const groupMembers = new Map<string, { name: string; ids: string[] }>()
  /** 学生 id → 首次出现的行号（表内重复拦下用） */
  const seenStudent = new Map<string, number>()
  let errorCount = 0

  for (const row of rows) {
    const errors = [...row.errors]
    const warnings = [...row.warnings]
    if (row.groupNameText === '') {
      errorCount += errors.length
      previewRows.push({ ...row, errors, warnings, action: 'blocked' })
      continue
    }

    const groupKey = dutyGroupNameKey(row.groupNameText)
    const existing = groupByKey.get(groupKey)
    let bucket = groupMembers.get(groupKey)
    if (!bucket) {
      bucket = { name: existing?.name ?? row.groupNameText, ids: [] }
      groupMembers.set(groupKey, bucket)
    }

    // 学生匹配：优先学号；无学号才按姓名（重名一律拦下）
    let student: Student | undefined
    if (row.studentNo) {
      student = index.byStudentNo.get(row.studentNo)
      if (!student) {
        errors.push(`学号 ${row.studentNo} 不在学生名单中`)
      } else if (row.name && row.name !== student.name) {
        errors.push(`姓名与学号不匹配：学号 ${row.studentNo} 是「${student.name}」`)
      }
    } else {
      const candidates = index.byName.get(row.name) ?? []
      if (candidates.length === 0) {
        errors.push(`学生名单中找不到「${row.name}」`)
      } else if (candidates.length > 1) {
        errors.push('存在重名学生，请使用学号确认。')
      } else {
        student = candidates[0]
        warnings.push('未填学号，本次按姓名匹配')
      }
    }

    if (student && errors.length === 0) {
      const seenAt = seenStudent.get(student.id)
      if (seenAt !== undefined) {
        errors.push(`该学生已在第 ${seenAt} 行出现过（同一学生只能属于一个组）`)
        student = undefined
      } else {
        seenStudent.set(student.id, row.rowNumber)
        // 学生已属于「表里没提到」的组：只提醒，不拦（未涉及的分组保持不变是明确语义）
        const otherGroup = existingGroups.find(
          (group) =>
            group.studentIds.includes(student!.id) && dutyGroupNameKey(group.name) !== groupKey,
        )
        if (otherGroup) {
          warnings.push(`该学生目前还在「${otherGroup.name}」里，导入后两个组都会有他`)
        }
        bucket.ids.push(student.id)
      }
    }

    if (errors.length > 0) {
      errorCount += errors.length
      previewRows.push({
        ...row,
        errors,
        warnings,
        action: 'blocked',
        studentLabel: student ? undefined : undefined,
        groupName: bucket.name,
        create: !existing,
      })
      continue
    }

    previewRows.push({
      ...row,
      errors,
      warnings,
      action: 'assign',
      studentLabel: student
        ? `${student.name}${student.studentNo ? `（${student.studentNo.slice(-4)}）` : ''}`
        : undefined,
      groupName: bucket.name,
      create: !existing,
    })
  }

  // 汇总计划：现有组只更新提到的；新组按表内出现顺序追加
  const updates: DutyGroupImportPlan['updates'] = []
  const creates: DutyGroupImportPlan['creates'] = []
  for (const [key, bucket] of groupMembers) {
    const existing = groupByKey.get(key)
    if (existing) {
      updates.push({ id: existing.id, name: existing.name, studentIds: [...bucket.ids] })
    } else {
      creates.push({ name: bucket.name, studentIds: [...bucket.ids] })
    }
  }

  const blocked = previewRows.filter((row) => row.action === 'blocked').length
  return {
    total: rows.length,
    blankRows: 0,
    importable: previewRows.length - blocked,
    blocked,
    groupsTouched: groupMembers.size,
    groupsCreated: creates.length,
    errorCount,
    rows: previewRows,
    plan: { updates, creates },
  }
}

/* ========== 安排导入 ========== */

export const DUTY_ARRANGE_HEADERS = ['日期', '组别'] as const

export const DUTY_ARRANGE_SAMPLE: readonly (readonly string[])[] = [
  ['2026-09-14', '第1组'],
  ['2026-09-15', '第2组'],
  ['2026-09-16', '第3组'],
]

export const DUTY_ARRANGE_HINT =
  '「日期」写 2026-09-14 这类真实日期，「组别」写现有组名（如 第1组）；日期必须覆盖连续的值日日（周末不排时跳过周末），导入后最早日期与该日组成为轮换起点'

export interface ParsedDutyArrangeRow {
  rowNumber: number
  /** 原文日期（预览展示用） */
  dateText: string
  /** 解析出的日期键（YYYY-MM-DD）；非法为空 */
  dateKey: string
  weekdayText: string
  groupNameText: string
  errors: string[]
  warnings: string[]
}

export type ParseDutyArrangeResult =
  | { ok: true; rows: ParsedDutyArrangeRow[]; columns: string[]; blankRows: number }
  | { ok: false; error: string }

/** 二维数组 → 逐行解析（纯函数） */
export function parseDutyArrangeRows(rows: unknown[][]): ParseDutyArrangeResult {
  if (rows.length === 0) return { ok: false, error: '表格里没有任何内容' }
  const { map, missing } = mapColumns(
    rows[0],
    {
      date: ['日期', '值日日期', '开始日期'],
      weekday: ['星期', '周', '星期几'],
      group: ['组别', '组', '组名', '值日组', '小组'],
    },
    ['date', 'group'],
  )
  if (missing.length > 0) {
    return {
      ok: false,
      error: `没有找到「${missing.join('」「')}」列。请确认第一行是表头，并含「${DUTY_ARRANGE_HEADERS.join(' / ')}」`,
    }
  }

  const parsed: ParsedDutyArrangeRow[] = []
  let blankRows = 0
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index]
    if (!Array.isArray(row) || isBlankRow(row, map)) {
      blankRows += 1
      continue
    }
    const errors: string[] = []
    const dateText = cellText(row[map.date])
    // 归一「2026/9/4」「2026年9月4日」等写法（与工作清单导入同一套宽容口径）
    const normalized = /^(\d{4})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})\s*日?$/.exec(dateText)
    const dateKey = normalized
      ? `${normalized[1]}-${normalized[2]!.padStart(2, '0')}-${normalized[3]!.padStart(2, '0')}`
      : ''
    if (!dateText) errors.push('日期为空')
    else if (!isDateKey(dateKey)) errors.push(`日期「${dateText}」无法识别（应写成 2026-09-14）`)

    const groupNameText = cellText(row[map.group])
    if (!groupNameText) errors.push('组别为空')

    let weekdayText = ''
    if (map.weekday !== -1 && isDateKey(dateKey)) {
      weekdayText = cellText(row[map.weekday])
      if (weekdayText) {
        const actual = WEEKDAY_LABELS[weekdayOfDateKey(dateKey)]
        // 「周一」「星期一」「星期三」都按包含「一二三…」字判断
        const char = actual.replace(/^星期/, '')
        if (!weekdayText.includes(char)) {
          errors.push(`星期「${weekdayText}」与日期不符：${dateKey} 是${actual}`)
        }
      }
    }

    parsed.push({
      rowNumber: index + 1,
      dateText,
      dateKey,
      weekdayText,
      groupNameText,
      errors,
      warnings: [],
    })
  }
  if (parsed.length === 0) return { ok: false, error: '表头下面没有数据行（只找到表头）' }
  const columns = ['日期', '组别']
  return { ok: true, rows: parsed, columns, blankRows }
}

export interface DutyArrangeImportRow extends ParsedDutyArrangeRow {
  action: 'assign' | 'blocked'
  /** 解析到的组 id（预览展示与落库共用） */
  groupId?: string
  groupName?: string
}

export interface DutyArrangeImportPlan {
  /** 轮换起点日期（最早一行） */
  startDate: string
  /** 起点组 id */
  startGroupId: string
  /** 轮换顺序（组 id）：表里提到的组按表序在前，未提到的保持相对顺序排在其后 */
  order: string[]
  /** 周末开关沿用当前设置（预览里说明） */
  includeWeekend: boolean
}

export interface DutyArrangeImportResult {
  total: number
  blankRows: number
  importable: number
  blocked: number
  errorCount: number
  /** 表覆盖的值日天数 */
  days: number
  rows: DutyArrangeImportRow[]
  plan: DutyArrangeImportPlan
}

/**
 * 与现有分组、轮换设置合并成安排导入计划（纯函数）。
 *
 * 本模块的「安排」就是**轮换**（起点 + 组顺序，按天顺延），因此要求表里的日期
 * **恰好覆盖连续的值日日**（不排周末时周六日不算）——否则组顺序无法唯一确定，
 * 缺口行报错说明原因；组名必须能在现有组里找到（安排导入不建组，建组用分组导入）。
 */
export function planDutyArrangeImport(
  rows: readonly ParsedDutyArrangeRow[],
  groups: readonly DutyGroup[],
  settings: Pick<DutySettings, 'includeWeekend'>,
): DutyArrangeImportResult {
  const previewRows: DutyArrangeImportRow[] = []
  let errorCount = 0
  const groupByKey = new Map<string, DutyGroup>()
  for (const group of groups) groupByKey.set(dutyGroupNameKey(group.name), group)

  // 排序副本：按日期升序检查连续性（Excel 行序乱也能读）
  const sorted = [...rows].sort((a, b) => a.dateKey.localeCompare(b.dateKey))
  let previous: ParsedDutyArrangeRow | undefined

  for (const row of sorted) {
    const errors = [...row.errors]
    const warnings = [...row.warnings]

    if (row.dateKey && isDateKey(row.dateKey)) {
      // 年份范围与轮换设置同一道闸（9999 年会让逐日推进卡死）
      const year = Number(row.dateKey.slice(0, 4))
      if (year < 2000 || year > 2099) errors.push(`日期年份要在 2000–2099 之间（${row.dateKey}）`)
      if (settings.includeWeekend === false && isWeekendDateKey(row.dateKey)) {
        warnings.push('这天是周末，当前设置周末不排；该行将忽略周末继续顺延')
      }
    }

    const group = groupByKey.get(dutyGroupNameKey(row.groupNameText))
    if (row.groupNameText && !group) {
      errors.push(`找不到「${row.groupNameText}」这个组（先用「导入分组」把组建起来）`)
    }

    // 连续性：与上一行必须相差一个值日日（周末不排时跳过周末）
    if (previous && previous.dateKey && row.dateKey && errors.length === 0) {
      let cursor = previous.dateKey
      do {
        cursor = addDaysToDateKey(cursor, 1)
      } while (settings.includeWeekend === false && isWeekendDateKey(cursor))
      if (cursor !== row.dateKey) {
        errors.push(
          `与上一行（${previous.dateKey}）不连续：轮换按天顺延，表要覆盖每个值日日（缺 ${cursor}）`,
        )
      }
    }

    if (errors.length > 0) {
      errorCount += errors.length
      previewRows.push({ ...row, errors, warnings, action: 'blocked' })
    } else {
      previewRows.push({
        ...row,
        errors,
        warnings,
        action: 'assign',
        groupId: group?.id,
        groupName: group?.name,
      })
    }
    previous = row
  }

  const assigned = previewRows.filter(
    (row): row is DutyArrangeImportRow & { groupId: string } =>
      row.action === 'assign' && row.groupId !== undefined,
  )

  // 组顺序：表序在前（去重），未提到的保持相对顺序排在其后
  const order: string[] = []
  for (const row of assigned) {
    if (row.groupId && !order.includes(row.groupId)) order.push(row.groupId)
  }
  for (const group of groups) {
    if (!order.includes(group.id)) order.push(group.id)
  }

  const blocked = previewRows.filter((row) => row.action === 'blocked').length
  return {
    total: rows.length,
    blankRows: 0,
    importable: previewRows.length - blocked,
    blocked,
    errorCount,
    days: assigned.length,
    rows: previewRows,
    plan: {
      startDate: assigned[0]?.dateKey ?? '',
      startGroupId: assigned[0]?.groupId ?? '',
      order,
      includeWeekend: settings.includeWeekend,
    },
  }
}

/** 「星期几」中文（安排导入的星期列校验用）；re-export 自 utils/timetable 免得调用方两处 import */
export { WEEKDAY_LABELS }
export type { Weekday }
