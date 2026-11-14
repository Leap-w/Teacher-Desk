/**
 * 违纪管理 UI 的纯逻辑（v3.8.0 · Phase 2）。
 *
 * 组件只负责渲染与事件绑定；**排序 / 筛选 / 快捷选择 / 时间段与课表联动**这些
 * 容易「算错却不报错」的逻辑全部放这里，可在 node 测试里直接跑。
 *
 * 纪律：
 * - 累计次数只从 Phase 1A 的统计口径来（调用方传 `countByStudent`），UI **不另算一套**；
 * - 预设 / 严重程度全部读 `config/violationPresets.ts` 与 `utils/violation.ts`，
 *   不在组件里硬编码第二份；
 * - 学生关联只认 `Student.id`；姓名只用于展示。
 */
import { VIOLATION_PRESETS } from '@/config/violationPresets'
import {
  KNOWN_VIOLATION_SEVERITIES,
  KNOWN_VIOLATION_TIME_SLOT_KINDS,
  VIOLATION_SEVERITY_LABELS,
  VIOLATION_TIME_SLOT_LABELS,
  findViolationPresetById,
  presetKindOfEvent,
} from '@/utils/violation'
import { findCustomPresetById } from '@/utils/violationPreset'
import { formatStudentShortName } from '@/utils/student'
import { isDateKey, weekdayOfDateKey as weekdayOfValidDateKey } from '@/utils/date'
import { COURSE_PERIODS } from '@/types/timetable'
import type { CoursePeriodId, Lesson, Weekday } from '@/types/timetable'
import type { Gender, Student } from '@/types'
import type {
  ViolationCustomPreset,
  ViolationEvent,
  ViolationSeverity,
  ViolationTimeSlotKind,
} from '@/types/violation'

/** 「＋ 自定义事件」的 UI 哨兵（绝不写入事件模型；提交时替换为自定义预设/系统匹配结果） */
export const VIOLATION_CUSTOM_EVENT_SENTINEL = '__custom_event__'

/** 编辑违纪事件时，事件 → 表单「事件下拉 + 自定义输入 + 严重程度」的回填结果 */
export interface ViolationEventFormSelection {
  /** 下拉值：系统预设 id / 已有自定义预设 id / `VIOLATION_CUSTOM_EVENT_SENTINEL` */
  presetId: string
  /** 下拉选自定义时输入框里应回填的原文 */
  customBehavior: string
  /** 历史事件的 severity（事实，不按当前预设重算） */
  severity: ViolationSeverity
}

/**
 * 编辑回填规则（v3.8.1 Phase 3）：
 * - 能解析到系统预设 → 系统 id；
 * - 能解析到仍存在的自定义预设 → 自定义 id；
 * - 其余（旧 `other-custom` / 已下线 id / 无预设历史文本）→ 自定义输入框 + 原始 behaviorLabel；
 * - `severity` **永远取历史记录的 severity**，绝不按预设默认值重算。
 */
export function selectionForEditingEvent(
  event: Pick<ViolationEvent, 'presetId' | 'presetKind' | 'behaviorLabel' | 'severity'>,
  customPresets: readonly ViolationCustomPreset[],
): ViolationEventFormSelection {
  const kind = presetKindOfEvent(event)
  const systemPreset = kind === 'system' ? findViolationPresetById(event.presetId) : undefined
  const customPreset =
    kind === 'custom' ? findCustomPresetById(customPresets, event.presetId) : undefined
  return {
    presetId: systemPreset
      ? systemPreset.id
      : customPreset
        ? customPreset.id
        : VIOLATION_CUSTOM_EVENT_SENTINEL,
    customBehavior: systemPreset || customPreset ? '' : event.behaviorLabel,
    severity: event.severity,
  }
}

/* ==================== 下拉选项（全部来自数据层配置） ==================== */

/** 严重程度三档（顺序由轻到重） */
export const VIOLATION_SEVERITY_OPTIONS: { value: ViolationSeverity; label: string }[] =
  KNOWN_VIOLATION_SEVERITIES.map((severity) => ({
    value: severity,
    label: VIOLATION_SEVERITY_LABELS[severity],
  }))

/** 系统预设事件选项（扁平清单，不再按分类分组） */
export const VIOLATION_SYSTEM_PRESET_OPTIONS: { value: string; label: string }[] =
  VIOLATION_PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))

/**
 * 违纪事件选择列表：系统预设 → 自定义预设 → 「＋ 自定义事件…」。
 *
 * 系统与自定义都不加分类分组；自定义排在后半段，选中时表单会显示「默认严重程度」提示。
 * **展示名称用预设原始 label**，不加前缀、不改写。
 */
export function buildViolationEventOptions(
  customPresets: readonly ViolationCustomPreset[],
): { value: string; label: string }[] {
  return [
    ...VIOLATION_SYSTEM_PRESET_OPTIONS,
    ...customPresets.map((preset) => ({ value: preset.id, label: preset.label })),
    { value: VIOLATION_CUSTOM_EVENT_SENTINEL, label: '＋ 自定义事件…' },
  ]
}

/** 时间段八种（"第 X 节课"与"自定义"的附加字段由表单单独处理） */
export const VIOLATION_TIME_SLOT_OPTIONS: {
  value: ViolationTimeSlotKind
  label: string
}[] = KNOWN_VIOLATION_TIME_SLOT_KINDS.map((kind) => ({
  value: kind,
  label: VIOLATION_TIME_SLOT_LABELS[kind],
}))

/** 课表节次（复用 `COURSE_PERIODS`，不新建第二套时段） */
export const VIOLATION_PERIOD_OPTIONS: { value: CoursePeriodId; label: string }[] =
  COURSE_PERIODS.map((period) => ({ value: period.id, label: period.label }))

/** 系统预设的默认严重程度（找不到 → 一般违纪，仍允许教师改本次记录） */
export function defaultSeverityOfPresetId(presetId: string | undefined): ViolationSeverity {
  const preset = VIOLATION_PRESETS.find((item) => item.id === presetId)
  return preset?.defaultSeverity ?? 'minor'
}

/** 系统预设文案（找不到时用行为文本兜底；UI 展示用） */
export function presetLabelOf(presetId: string | undefined, fallback: string): string {
  return VIOLATION_PRESETS.find((item) => item.id === presetId)?.label ?? fallback
}

/** 严重程度 → 徽标色调（**同时必须显示文字**，不能只靠颜色） */
export function severityBadgeVariant(
  severity: ViolationSeverity,
): 'neutral' | 'warning' | 'danger' {
  if (severity === 'severe') return 'danger'
  if (severity === 'moderate') return 'warning'
  return 'neutral'
}

/* ==================== 时间段 / 课表联动 ==================== */

/**
 * 日期键 → 星期几（`YYYY-MM-DD`；非法日期返回 undefined）。
 * 复用 `utils/date.ts` 的唯一星期口径；这里只补"非法日期"这一层判断。
 */
export function weekdayOfDateKey(dateKey: string): Weekday | undefined {
  return isDateKey(dateKey) ? weekdayOfValidDateKey(dateKey) : undefined
}

/**
 * 在课表里找「某天某节」的科目（**只用于预填，取不到允许手填**）。
 *
 * `lessons` 由调用方从 `useTimetableStore()` 取（可能已含周次换课叠加层），
 * 这里保持纯函数，便于测试。
 */
export function findTimetableSubject(
  lessons: readonly Lesson[],
  weekday: Weekday,
  periodId: CoursePeriodId,
): string | undefined {
  const lesson = lessons.find((item) => item.weekday === weekday && item.periodId === periodId)
  const subject = lesson?.subject?.trim()
  return subject ? subject : undefined
}

/** 某一时刻（日期 + 第 X 节）对应的科目预填 */
export function suggestSubjectFor(
  lessons: readonly Lesson[],
  dateKey: string,
  periodId: CoursePeriodId,
): string | undefined {
  const weekday = weekdayOfDateKey(dateKey)
  if (!weekday) return undefined
  return findTimetableSubject(lessons, weekday, periodId)
}

/**
 * 切换时间段类型时的字段清理：只保留该类型有意义的字段。
 * 例如从「第 X 节课」切到「早上」，必须清掉 periodId/subject/customTimeText，
 * 否则会存下"早上 · 数学"这种自相矛盾的组合（数据层 normalize 也会剔，但表单先清更清楚）。
 */
export interface ViolationTimeSlotDraft {
  timeSlotKind: ViolationTimeSlotKind
  periodId?: CoursePeriodId
  periodLabel?: string
  subject?: string
  customTimeText?: string
}

export function timeSlotDraftForKind(
  kind: ViolationTimeSlotKind,
  current: ViolationTimeSlotDraft = { timeSlotKind: kind },
): ViolationTimeSlotDraft {
  if (kind === 'period') {
    return {
      timeSlotKind: kind,
      ...(current.periodId ? { periodId: current.periodId } : {}),
      ...(current.periodLabel ? { periodLabel: current.periodLabel } : {}),
      ...(current.subject ? { subject: current.subject } : {}),
    }
  }
  if (kind === 'custom') {
    return {
      timeSlotKind: kind,
      ...(current.customTimeText ? { customTimeText: current.customTimeText } : {}),
    }
  }
  return { timeSlotKind: kind }
}

/* ==================== 学生选择器（按次数排序 / 搜索 / 快捷选择） ==================== */

export interface ViolationPickerRow {
  student: Student
  /** 累计违纪次数（来自数据层派生，UI 不另算） */
  count: number
  /** 展示名（重名带身份证尾号） */
  displayName: string
  genderLabel: string
  /** 宿舍文案（未分配 →「未分配」） */
  dormitoryLabel: string
}

export interface ViolationPickerOptions {
  keyword?: string
  /** 性别筛选（`null` / 不传 = 不筛；快捷"全选男生"是**选择动作**，不是筛选） */
  gender?: Gender | null
  nameCounts?: ReadonlyMap<string, number>
}

const ZH_COLLATOR = new Intl.Collator('zh-Hans-CN', { sensitivity: 'variant', numeric: true })

function matchesPickerKeyword(student: Student, keyword: string): boolean {
  if (!keyword) return true
  const haystack = [student.name, student.studentNo, student.idCardSuffix ?? '']
    .join(' ')
    .toLowerCase()
  return haystack.includes(keyword)
}

/**
 * 选择器行数据：默认**按累计违纪次数降序 → 姓名升序 → id 兜底**。
 * 学生由调用方传入（通常是在读名册；已软删除学生不给新增违纪）。
 */
export function buildViolationPickerRows(
  students: readonly Student[],
  counts: ReadonlyMap<string, number>,
  options: ViolationPickerOptions = {},
): ViolationPickerRow[] {
  const keyword = (options.keyword ?? '').trim().toLowerCase()
  const nameCounts = options.nameCounts ?? new Map(students.map((student) => [student.name, 1]))
  const rows = students
    .filter((student) => (options.gender ? student.gender === options.gender : true))
    .filter((student) => matchesPickerKeyword(student, keyword))
    .map((student) => ({
      student,
      count: counts.get(student.id) ?? 0,
      displayName: formatStudentShortName(student, nameCounts),
      genderLabel: student.gender === 'male' ? '男' : '女',
      dormitoryLabel: student.dormitory?.trim() ? student.dormitory : '未分配',
    }))

  rows.sort((left, right) => {
    if (left.count !== right.count) return right.count - left.count
    const byName = ZH_COLLATOR.compare(left.student.name, right.student.name)
    if (byName !== 0) return byName
    if (left.student.id === right.student.id) return 0
    return left.student.id < right.student.id ? -1 : 1
  })
  return rows
}

/** 宿舍快捷选择项（实际出现过的宿舍 + 未分配；带人数，便于教师判断） */
export interface DormitoryQuickOption {
  /** 空串表示「未分配」 */
  value: string
  label: string
  count: number
}

export function buildDormitoryQuickOptions(students: readonly Student[]): DormitoryQuickOption[] {
  const counts = new Map<string, number>()
  let unassigned = 0
  for (const student of students) {
    const dormitory = student.dormitory?.trim() ?? ''
    if (!dormitory) {
      unassigned += 1
      continue
    }
    counts.set(dormitory, (counts.get(dormitory) ?? 0) + 1)
  }
  const options: DormitoryQuickOption[] = [{ value: '', label: '未分配宿舍', count: unassigned }]
  for (const [dormitory, count] of [...counts.entries()].sort((a, b) =>
    ZH_COLLATOR.compare(a[0], b[0]),
  )) {
    options.push({ value: dormitory, label: dormitory, count })
  }
  return options
}

/* ==================== 选择集合（与筛选组合使用） ==================== */

/** 全选给定学生（**只加不删**，可与已选组合） */
export function addStudentsToSelection(
  selection: ReadonlySet<string>,
  students: readonly Student[],
): Set<string> {
  const next = new Set(selection)
  for (const student of students) next.add(student.id)
  return next
}

/** 按性别一键加入（全选男生 / 全选女生） */
export function addStudentsByGender(
  selection: ReadonlySet<string>,
  students: readonly Student[],
  gender: Gender,
): Set<string> {
  return addStudentsToSelection(
    selection,
    students.filter((student) => student.gender === gender),
  )
}

/** 按宿舍一键加入（空串 = 未分配宿舍） */
export function addStudentsByDormitory(
  selection: ReadonlySet<string>,
  students: readonly Student[],
  dormitory: string,
): Set<string> {
  return addStudentsToSelection(
    selection,
    students.filter((student) => (student.dormitory?.trim() ?? '') === dormitory),
  )
}

/** 单个勾选 / 取消 */
export function toggleStudentSelection(
  selection: ReadonlySet<string>,
  studentId: string,
): Set<string> {
  const next = new Set(selection)
  if (next.has(studentId)) next.delete(studentId)
  else next.add(studentId)
  return next
}

/** 清空 */
export function clearStudentSelection(): Set<string> {
  return new Set<string>()
}

/* ==================== 列表筛选 ==================== */

/** 列表筛选条件（与 Store 的 `listEvents` 参数一一对应；v3.8.1 起没有分类筛选） */
export interface ViolationListFilterState {
  keyword: string
  severity: ViolationSeverity | 'all'
}

export const DEFAULT_VIOLATION_LIST_FILTER: ViolationListFilterState = {
  keyword: '',
  severity: 'all',
}

/** 把 UI 筛选状态翻译成 Store 查询参数（唯一一份换算，不在页面里手拼） */
export function toViolationQuery(state: ViolationListFilterState): {
  keyword?: string
  severities?: ViolationSeverity[]
} {
  const keyword = state.keyword.trim()
  return {
    ...(keyword ? { keyword } : {}),
    ...(state.severity !== 'all' ? { severities: [state.severity] } : {}),
  }
}

/** 筛选是否处于非默认状态（空状态文案据此区分"没数据"与"筛没了"） */
export function isViolationFilterActive(state: ViolationListFilterState): boolean {
  return state.keyword.trim() !== '' || state.severity !== 'all'
}
