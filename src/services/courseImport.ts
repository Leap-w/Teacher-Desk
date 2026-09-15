/**
 * Excel 课程表导入（V1.1.3）。
 *
 * 与 `services/seatImport.ts` / `services/studentImport.ts` 同一套分层：
 *   ① 读文件复用 `readSheetRows`（唯一碰 xlsx / 字节的一层，动态 import、表头签名校验都在那）；
 *   ② **本文件全是纯函数**（不碰 xlsx、不碰 DOM、不碰 store），校验规则与统计都在这层，
 *      因此能在 node 常驻自检里被直接喂二维数组跑。
 *
 * 流程与座位导入一致：选择文件 → 读取 → 解析 → 校验 → 预览 → 确认 → 一次性写入。
 * **一行有错就不许确认**（阻断性错误），未确认前**一个字节都不写**。
 *
 * 落库语义（与座位导入同一纪律）：**逐条应用**——导入涉及的「星期 + 时段」被替换成表里的安排，
 * 未涉及的时段保持原样；不整表覆盖，避免一份不完整的表把整周课表清空。
 */
import { COURSE_PERIODS, EVENING_PERIOD_IDS } from '@/types/timetable'
import type { CoursePeriodId, Lesson, LessonInput, LessonType, Weekday } from '@/types/timetable'
import { classIdOf, eveningGroupIdOf, periodLabelOf } from '@/utils/timetable'
import { cellText, isBlankRow, normalizeHeader } from '@/services/sheetCell'

/** 模板表头（弹窗首屏与错误文案共用一份说法） */
export const COURSE_IMPORT_HEADERS = ['星期', '节次', '班级', '科目', '类型', '原教师'] as const

/**
 * 模板示例（帮助教师理解「节次」写什么、「原教师」什么时候必填）。
 * v3.3.1：末行举一节**周六**的课——导入本来就吃周一~周日，
 * 但示例只举工作日会让人以为周末不能排（周视图现在恒定显示七天）。
 */
export const COURSE_IMPORT_SAMPLE: readonly (readonly string[])[] = [
  ['周一', '第5节', '高一9班', '数学', '正常', ''],
  ['周二', '第3节', '高一9班', '数学', '代课', '张老师'],
  ['周三', '晚自习1', '高一9班', '数学', '正常', ''],
  ['周六', '第2节', '高一9班', '数学', '正常', ''],
]

export const COURSE_IMPORT_HINT =
  '「节次」可写第2~7节 / 早自习及第一节 / 晚自习1~3，也可直接写序号 1~10；「类型」写正常或代课（留空按正常），代课必须填「原教师」'

/** 一行数据在文件里的位置与解析结果 */
export interface ParsedCourseRow {
  /** Excel 里的实际行号（1 起，含表头）——预览里要给教师看「第几行」 */
  rowNumber: number
  weekday: Weekday | null
  periodId: CoursePeriodId | null
  className: string
  subject: string
  type: LessonType | null
  originalTeacher: string
  errors: string[]
  warnings: string[]
}

/** 表头识别结果：列下标，-1 表示没有这一列 */
interface ColumnMap {
  weekday: number
  period: number
  className: number
  subject: number
  type: number
  originalTeacher: number
}

/** 列名与常见别名的对应表（**先匹配到的列胜出**，顺序即优先级） */
const COLUMN_ALIASES: Array<{ key: keyof ColumnMap; label: string; aliases: string[] }> = [
  { key: 'weekday', label: '星期', aliases: ['星期', '周', '周几', '星期几'] },
  { key: 'period', label: '节次', aliases: ['节次', '时间', '时段', '第几节'] },
  { key: 'className', label: '班级', aliases: ['班级', '上课班级', '班'] },
  { key: 'subject', label: '科目', aliases: ['科目', '课程', '学科'] },
  { key: 'type', label: '类型', aliases: ['类型', '课程类型'] },
  {
    key: 'originalTeacher',
    label: '原教师',
    aliases: ['原教师', '原授课教师', '原任课教师', '原老师'],
  },
]

const WEEKDAY_ALIASES: Record<string, Weekday> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7,
}

const CN_NUMBERS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
}

function mapColumns(headerRow: unknown[]): ColumnMap {
  const map: ColumnMap = {
    weekday: -1,
    period: -1,
    className: -1,
    subject: -1,
    type: -1,
    originalTeacher: -1,
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

/** 「周一」「星期一」「周1」「1」都能读成 1；读不出返回 null */
export function resolveWeekday(text: string): Weekday | null {
  const value = text.replace(/\s+/g, '')
  if (!value) return null
  const matched = /^(?:周|星期|礼拜)([1-7]|[一二三四五六日天])$/.exec(value)
  if (matched) {
    const group = matched[1]!
    if (/^[1-7]$/.test(group)) return Number(group) as Weekday
    return WEEKDAY_ALIASES[group] ?? null
  }
  if (/^[1-7]$/.test(value)) return Number(value) as Weekday
  return null
}

/**
 * 「节次」列 → 时段 id。认得的写法：
 * ① 时间段的完整名 / 短名（`早自习及第一节`、`第2节`、`晚自习1`）；
 * ② 序号 1~10（`5`、`第5节`、`第五节`）——**与旧数据迁移表同一口径**，`8` = 晚自习1；
 * ③ `晚自习一/二/三`。
 */
export function resolvePeriodId(text: string): CoursePeriodId | null {
  const value = text.replace(/\s+/g, '')
  if (!value) return null
  const byLabel = COURSE_PERIODS.find(
    (period) => period.label === value || period.shortLabel === value,
  )
  if (byLabel) return byLabel.id

  const stripped = value.replace(/^第/, '').replace(/节$/, '')
  const byStripped = COURSE_PERIODS.find(
    (period) => period.label === stripped || period.shortLabel === stripped,
  )
  if (byStripped) return byStripped.id

  const evening = /^晚自习(\d+|[一二三])$/.exec(stripped)
  if (evening) {
    const group = evening[1]!
    const index = /^\d+$/.test(group) ? Number(group) : (CN_NUMBERS[group] ?? 0)
    if (index >= 1 && index <= EVENING_PERIOD_IDS.length) return EVENING_PERIOD_IDS[index - 1]!
    return null
  }

  const numeric = /^\d+$/.test(stripped) ? Number(stripped) : CN_NUMBERS[stripped]
  if (numeric && numeric >= 1 && numeric <= COURSE_PERIODS.length) {
    return COURSE_PERIODS[numeric - 1]!.id
  }
  // 旧课表的 1~8 节写法直接复用迁移表（保证「导入」与「迁移」对同一串数字理解一致）
  return null
}

/** 「正常」「代课」（也接受 normal / substitute，以及空） */
export function resolveLessonType(text: string): LessonType | null {
  const value = text.trim()
  if (!value) return 'normal'
  if (value === '正常' || value === '正常课程' || value === '本人' || value === 'normal') {
    return 'normal'
  }
  if (value === '代课' || value === '代课课程' || value === 'substitute') return 'substitute'
  if (value === '调课' || /^调课/.test(value)) {
    // 调课是「换课」的产物，由换课功能生成；导入表里写调课会被拦下（不能手工造一条无来源的调课）
    return null
  }
  return null
}

export type ParseCourseResult =
  | { ok: true; rows: ParsedCourseRow[]; columns: string[]; blankRows: number }
  | { ok: false; error: string }

/**
 * 二维数组 → 逐行解析结果（纯函数）。
 * 这一层只判「这一行本身是否读得懂」，重复时段留给 `planCourseImport`（那边要看全表）。
 */
export function parseCourseRows(rows: unknown[][]): ParseCourseResult {
  if (rows.length === 0) return { ok: false, error: '表格里没有任何内容' }

  const map = mapColumns(rows[0])
  const missing: string[] = []
  if (map.weekday === -1) missing.push('星期')
  if (map.period === -1) missing.push('节次')
  if (missing.length > 0) {
    return {
      ok: false,
      error: `没有找到「${missing.join('」「')}」列。请确认第一行是表头，并含「${COURSE_IMPORT_HEADERS.join(' / ')}」这几列`,
    }
  }
  if (map.className === -1) {
    return {
      ok: false,
      error: `没有找到「班级」列。表头应含「${COURSE_IMPORT_HEADERS.join(' / ')}」`,
    }
  }
  if (map.subject === -1) {
    return {
      ok: false,
      error: `没有找到「科目」列。表头应含「${COURSE_IMPORT_HEADERS.join(' / ')}」`,
    }
  }
  const columns = COLUMN_ALIASES.filter((column) => map[column.key] !== -1).map(
    (column) => column.label,
  )

  const parsed: ParsedCourseRow[] = []
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

    const weekdayText = at('weekday')
    const weekday = resolveWeekday(weekdayText)
    if (!weekday) errors.push(weekdayText ? `星期「${weekdayText}」无法识别` : '星期为空')

    const periodText = at('period')
    const periodId = resolvePeriodId(periodText)
    if (!periodId) errors.push(periodText ? `节次「${periodText}」无法识别` : '节次为空')

    const className = at('className')
    if (!className) errors.push('班级为空')
    const subject = at('subject')
    if (!subject) errors.push('科目为空')

    const typeText = at('type')
    const type = resolveLessonType(typeText)
    if (!type)
      errors.push(
        typeText ? `类型「${typeText}」无法识别（应为「正常」或「代课」）` : '类型无法识别',
      )

    const originalTeacher = at('originalTeacher')
    if (type === 'substitute' && !originalTeacher) errors.push('代课缺少「原教师」')
    if (type === 'normal' && originalTeacher) {
      warnings.push(`正常课程不需要原教师，已忽略「${originalTeacher}」`)
    }

    parsed.push({
      rowNumber: index + 1,
      weekday,
      periodId,
      className,
      subject,
      type,
      originalTeacher: type === 'substitute' ? originalTeacher : '',
      errors,
      warnings,
    })
  }

  if (parsed.length === 0) return { ok: false, error: '表头下面没有数据行（只找到表头）' }
  return { ok: true, rows: parsed, columns, blankRows }
}

export interface CourseImportPreviewRow extends ParsedCourseRow {
  action: 'create' | 'replace' | 'blocked'
  /** 该行在现有课表里是否已有课（有则说明本次会覆盖它） */
  replacedSubject?: string
  /** 该行是否已归入某个晚自习组 */
  eveningGroup?: boolean
}

export interface CourseImportResult {
  /** 数据行数（不含表头、不含全空行） */
  total: number
  /** 全空行条数（已跳过，只在提示里说一声） */
  blankRows: number
  /** 可导入行数（= 新增 + 覆盖） */
  importable: number
  /** 被拦行数 */
  blocked: number
  /** 新增（该时段原本没课） */
  added: number
  /** 覆盖（该时段原本有课，导入后换成表里的安排） */
  replaced: number
  /** 代课行数 */
  substituted: number
  /** 重复时段行数 */
  duplicateSlots: number
  /** 归入晚自习组的行数 */
  eveningGrouped: number
  /** 错误条数（> 0 即不允许确认） */
  errorCount: number
  rows: CourseImportPreviewRow[]
  plan: { lessons: LessonInput[] }
}

/**
 * 与现有课表合并成一份可执行的导入计划（纯函数，无副作用）。
 *
 * 校验口径：① 星期合法；② 节次合法；③ 班级 / 科目非空；④ 类型合法；
 * ⑤ 代课必须有原教师；⑥ **同一天同一时段不能出现两条**（教师同一时段只能在一个班上课）；
 * ⑦ 空行已由解析层跳过；⑧ 表头缺失 / 文件格式由解析层与读文件层挡住。
 *
 * **错误数据绝不进 plan**：教师看到预览上写着「2 行被拦下」，落库时就不该悄悄写进去。
 * 因此 `blocked > 0` 时页面禁用确认按钮，`plan.lessons` 只含无错误的行。
 *
 * 晚自习组：同一星期 + 同一班级 + 同一科目的三节晚自习齐备时，自动共享 `courseGroupId`
 * （**三节仍是独立课程**，只是业务上可以视为一组，便于整组换课）。
 */
export function planCourseImport(
  rows: readonly ParsedCourseRow[],
  existingLessons: readonly Lesson[],
): CourseImportResult {
  const bySlot = new Map<string, Lesson>()
  for (const lesson of existingLessons) {
    const key = `${lesson.weekday}-${lesson.periodId}`
    if (!bySlot.has(key)) bySlot.set(key, lesson)
  }

  /** 「先到先得」的时段登记：只由无错误的行填充，避免被拦行把时段占掉 */
  const slotOwner = new Map<string, number>()
  const previewRows: CourseImportPreviewRow[] = []
  const lessons: LessonInput[] = []
  let added = 0
  let replaced = 0
  let substituted = 0
  let duplicateSlots = 0
  let errorCount = 0

  rows.forEach((row) => {
    const errors = [...row.errors]
    const warnings = [...row.warnings]
    if (row.weekday === null || row.periodId === null || row.type === null) {
      errorCount += errors.length
      previewRows.push({ ...row, errors, warnings, action: 'blocked' })
      return
    }

    const slotKey = `${row.weekday}-${row.periodId}`
    const ownerRow = slotOwner.get(slotKey)
    if (ownerRow !== undefined) {
      duplicateSlots += 1
      errors.push(
        `同一时段重复（${periodLabelOf(row.periodId)}）与第 ${ownerRow} 行冲突：同一时段只能排一节课`,
      )
    } else if (errors.length === 0) {
      slotOwner.set(slotKey, row.rowNumber)
    }

    if (errors.length > 0) {
      errorCount += errors.length
      previewRows.push({ ...row, errors, warnings, action: 'blocked' })
      return
    }

    const existing = bySlot.get(slotKey)
    const className = row.className.trim()
    const input: LessonInput = {
      weekday: row.weekday,
      periodId: row.periodId,
      subject: row.subject.trim(),
      classId: classIdOf(className),
      className,
      teacher: '我',
      type: row.type,
      originalTeacher: row.type === 'substitute' ? row.originalTeacher.trim() : undefined,
    }
    lessons.push(input)
    if (existing) replaced += 1
    else added += 1
    if (row.type === 'substitute') substituted += 1
    previewRows.push({
      ...row,
      errors,
      warnings,
      action: existing ? 'replace' : 'create',
      replacedSubject: existing?.subject,
    })
  })

  // 晚自习组：同一星期 + 同一班级 + 同一科目的三节齐备 → 共享同一个组 id
  const eveningBuckets = new Map<string, LessonInput[]>()
  for (const lesson of lessons) {
    if (!EVENING_PERIOD_IDS.includes(lesson.periodId)) continue
    const key = `${lesson.weekday}-${lesson.classId}-${lesson.subject}`
    const list = eveningBuckets.get(key) ?? []
    list.push(lesson)
    eveningBuckets.set(key, list)
  }
  let eveningGrouped = 0
  for (const [key, list] of eveningBuckets) {
    const ids = new Set(list.map((lesson) => lesson.periodId))
    if (!EVENING_PERIOD_IDS.every((id) => ids.has(id))) continue
    const [weekdayPart, classIdPart, ...subjectParts] = key.split('-')
    const groupId = eveningGroupIdOf(
      Number(weekdayPart) as Weekday,
      classIdPart ?? '',
      subjectParts.join('-'),
    )
    for (const lesson of list) lesson.courseGroupId = groupId
    eveningGrouped += list.length
  }
  for (const row of previewRows) {
    if (row.action === 'blocked' || !row.periodId || row.weekday === null) continue
    const input = lessons.find(
      (lesson) => lesson.weekday === row.weekday && lesson.periodId === row.periodId,
    )
    row.eveningGroup = Boolean(input?.courseGroupId)
  }

  const blocked = previewRows.filter((row) => row.action === 'blocked').length
  return {
    total: rows.length,
    blankRows: 0,
    importable: previewRows.length - blocked,
    blocked,
    added,
    replaced,
    substituted,
    duplicateSlots,
    eveningGrouped,
    errorCount,
    rows: previewRows,
    plan: { lessons },
  }
}
