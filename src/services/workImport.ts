/**
 * Excel 工作清单导入（V1.1.3）。
 *
 * 与 `services/courseImport.ts` / `services/seatImport.ts` 同一套分层：
 * 读文件复用 `readSheetRows`，其余全是纯函数（规则与统计在纯函数层，可在 node 自检里直接跑）。
 * 流程同样是：选择 → 解析 → 校验 → 预览 → 确认 → 一次性写入；有错**禁止确认**、取消**不写**。
 *
 * 落库语义：**追加**，但**同日同名的任务会被跳过**（标为「已存在」）——
 * 教师把同一份月度清单导入两次不该得到两份任务；跳过的行在预览里逐行说明。
 */
import { WORK_CATEGORIES, WORK_PRIORITY_LABELS } from '@/types/work'
import type { WorkCategory, WorkInput, WorkItem, WorkPriority } from '@/types/work'
import { isoDateOf, isValidIsoDate, parseDateText, parseTimeText, isSameWork } from '@/utils/work'
import { cellText, isBlankRow, normalizeHeader } from '@/services/sheetCell'

/** 模板表头（弹窗首屏与错误文案共用一份说法） */
export const WORK_IMPORT_HEADERS = [
  '工作名称',
  '日期',
  '截止时间',
  '优先级',
  '分类',
  '描述',
] as const

/** 模板示例 */
export const WORK_IMPORT_SAMPLE: readonly (readonly string[])[] = [
  ['收齐学生请假条', '2026-09-14', '18:00', '重要', '班主任', '放学前收齐'],
  ['批改数学作业', '2026-09-14', '22:00', '普通', '教学', ''],
  ['联系学生家长', '2026-09-15', '', '紧急', '班主任', '沟通月考情况'],
]

export const WORK_IMPORT_HINT =
  '「日期」写 2026-09-14 或 2026/9/14；「截止时间」写 18:00（可留空）；优先级写普通 / 重要 / 紧急；分类写班主任 / 教学 / 其他；同日同名的任务不会重复创建'

/** 一行数据在文件里的位置与解析结果 */
export interface ParsedWorkRow {
  rowNumber: number
  title: string
  date: string
  deadline: string
  priority: WorkPriority
  category: WorkCategory
  description: string
  errors: string[]
  warnings: string[]
}

interface ColumnMap {
  title: number
  date: number
  deadline: number
  priority: number
  category: number
  description: number
}

/** 列名与常见别名的对应表（**先匹配到的列胜出**，顺序即优先级） */
const COLUMN_ALIASES: Array<{ key: keyof ColumnMap; label: string; aliases: string[] }> = [
  {
    key: 'title',
    label: '工作名称',
    aliases: ['工作名称', '名称', '工作', '任务', '事项', '标题'],
  },
  { key: 'date', label: '日期', aliases: ['日期', '时间', '安排日期'] },
  { key: 'deadline', label: '截止时间', aliases: ['截止时间', '截止', '最后期限', '时间点'] },
  { key: 'priority', label: '优先级', aliases: ['优先级', '紧急程度', '重要程度'] },
  { key: 'category', label: '分类', aliases: ['分类', '类别', '类型'] },
  { key: 'description', label: '描述', aliases: ['描述', '备注', '说明', '详情'] },
]

/** 优先级各种写法 */
const PRIORITY_ALIASES: Record<string, WorkPriority> = {
  普通: 'normal',
  一般: 'normal',
  正常: 'normal',
  normal: 'normal',
  重要: 'important',
  较重要: 'important',
  important: 'important',
  紧急: 'urgent',
  很紧急: 'urgent',
  特急: 'urgent',
  urgent: 'urgent',
}

function mapColumns(headerRow: unknown[]): ColumnMap {
  const map: ColumnMap = {
    title: -1,
    date: -1,
    deadline: -1,
    priority: -1,
    category: -1,
    description: -1,
  }
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

export type ParseWorkResult =
  | { ok: true; rows: ParsedWorkRow[]; columns: string[]; blankRows: number }
  | { ok: false; error: string }

/**
 * 二维数组 → 逐行解析结果（纯函数）。
 * 日期 / 名称 / 截止时间写错是**错误**（拦下）；优先级 / 分类写错只是**警告**（归默认值）——
 * 前者会让这条任务无处可去，后者只是分类不精确，不该因此让教师重做整张表。
 */
export function parseWorkRows(rows: unknown[][], today: string = isoDateOf()): ParseWorkResult {
  if (rows.length === 0) return { ok: false, error: '表格里没有任何内容' }

  const map = mapColumns(rows[0])
  if (map.title === -1) {
    return {
      ok: false,
      error: `没有找到「工作名称」列。请确认第一行是表头，并含「${WORK_IMPORT_HEADERS.join(' / ')}」`,
    }
  }
  if (map.date === -1) {
    return {
      ok: false,
      error: `没有找到「日期」列。表头应含「${WORK_IMPORT_HEADERS.join(' / ')}」`,
    }
  }
  const columns = COLUMN_ALIASES.filter((column) => map[column.key] !== -1).map(
    (column) => column.label,
  )

  const parsed: ParsedWorkRow[] = []
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

    const title = at('title')
    if (!title) errors.push('工作名称为空')

    const dateText = at('date')
    const date = parseDateText(dateText) ?? (isValidIsoDate(dateText) ? dateText : undefined)
    if (!date) {
      errors.push(dateText ? `日期「${dateText}」无法识别（应写成 2026-09-14）` : '日期为空')
    } else if (date < addDaysSafe(today, -365) || date > addDaysSafe(today, 365 * 2)) {
      // 只做「明显离谱」的提醒，不阻断——教师补录去年的总结是合理的
      warnings.push(`日期「${date}」距今天较远，请确认没写错`)
    }

    const deadlineText = at('deadline')
    const deadline = parseTimeText(deadlineText)
    if (deadlineText && !deadline)
      errors.push(`截止时间「${deadlineText}」无法识别（应写成 18:00）`)

    const priorityText = at('priority')
    const priority = priorityText ? PRIORITY_ALIASES[priorityText] : ('normal' as WorkPriority)
    if (priorityText && !priority) {
      warnings.push(
        `优先级「${priorityText}」无法识别，本次按「${WORK_PRIORITY_LABELS.normal}」处理`,
      )
    }

    const categoryText = at('category')
    const category = (WORK_CATEGORIES as readonly string[]).includes(categoryText)
      ? (categoryText as WorkCategory)
      : '其他'
    if (categoryText && !(WORK_CATEGORIES as readonly string[]).includes(categoryText)) {
      warnings.push(`分类「${categoryText}」不在预设内，本次归入「其他」`)
    }

    parsed.push({
      rowNumber: index + 1,
      title,
      date: date ?? '',
      deadline: deadline ?? '',
      priority: priority ?? 'normal',
      category,
      description: at('description'),
      errors,
      warnings,
    })
  }

  if (parsed.length === 0) return { ok: false, error: '表头下面没有数据行（只找到表头）' }
  return { ok: true, rows: parsed, columns, blankRows }
}

/** 宽松的日期加减（只用于「日期是否离今天很远」的提示，不参与落库） */
function addDaysSafe(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(year ?? 2026, (month ?? 1) - 1, day ?? 1)
  date.setDate(date.getDate() + days)
  return isoDateOf(date)
}

export interface WorkImportPreviewRow extends ParsedWorkRow {
  action: 'create' | 'skip' | 'blocked'
  /** action 为 skip 的原因（与已有任务同日同名） */
  skipReason?: string
}

export interface WorkImportResult {
  total: number
  blankRows: number
  importable: number
  blocked: number
  /** 其中新增 */
  added: number
  /** 其中已存在（跳过） */
  skipped: number
  /** 逾期行数（日期早于今天，只提示） */
  overdue: number
  errorCount: number
  rows: WorkImportPreviewRow[]
  plan: { works: WorkInput[] }
}

/**
 * 与现有工作合并成一份可执行的导入计划（纯函数）。
 * 同日同名 → 跳过（`skip`），其它无错误的行进 plan；有错误的行继续拦（`blocked > 0` 即禁止确认）。
 */
export function planWorkImport(
  rows: readonly ParsedWorkRow[],
  existing: readonly WorkItem[],
  today: string = isoDateOf(),
): WorkImportResult {
  const previewRows: WorkImportPreviewRow[] = []
  const works: WorkInput[] = []
  let errorCount = 0
  let added = 0
  let skipped = 0
  let overdue = 0

  for (const row of rows) {
    const errors = [...row.errors]
    const warnings = [...row.warnings]
    if (errors.length > 0) {
      errorCount += errors.length
      previewRows.push({ ...row, errors, warnings, action: 'blocked' })
      continue
    }

    const duplicated = existing.some((work) => isSameWork(work, row))
    if (duplicated) {
      skipped += 1
      previewRows.push({
        ...row,
        errors,
        warnings,
        action: 'skip',
        skipReason: '同一天已有同名的工作，未重复创建',
      })
      continue
    }

    if (row.date < today) overdue += 1
    works.push({
      title: row.title.trim(),
      description: row.description.trim() || undefined,
      date: row.date,
      deadline: row.deadline || undefined,
      // 导入的都是「要做的事」：一律 todo（状态在界面上点一下就能改）
      status: 'todo',
      priority: row.priority,
      category: row.category,
    })
    added += 1
    previewRows.push({ ...row, errors, warnings, action: 'create' })
  }

  const blocked = previewRows.filter((row) => row.action === 'blocked').length
  return {
    total: rows.length,
    blankRows: 0,
    importable: previewRows.length - blocked,
    blocked,
    added,
    skipped,
    overdue,
    errorCount,
    rows: previewRows,
    plan: { works },
  }
}
