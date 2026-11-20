/**
 * 单文件 HTML 导出的数据映射（v3.9.0）——纯函数，不读 store / 不碰 DOM，可在 node 里测试。
 *
 * 职责：把 TeacherDesk 的领域数据投影成 Class Portal 的数据契约（PortalApiData），
 * 映射口径与 Portal 云函数 `projections.ts` / 前端 `apiSource.ts` 保持一致：
 * - 课表只保留目标班级、时段 id 从 CoursePeriodId 映射到 1..10；
 * - 座位固定空位 / 非活跃学生的 studentId 置空；
 * - 照片只取当前证件照，字节已由调用方转成 data URL 内联。
 *
 * 这里刻意不 import Portal 项目源码（两个工程独立），而是在本文件复刻其数据形状；
 * 界面资源由 portalAssets.ts 固化。改 Portal 契约时要同步这里。
 */
import { COURSE_PERIODS, type CoursePeriodId, type Lesson } from '@/types/timetable'
import { DEFAULT_CLASSROOM_CONFIG } from '@/types/classroom'
import type { Student } from '@/types'
import type { Seat } from '@/types/seat'

/** 与 Portal `data/types.ts` 等价的只读数据形状（无敏感字段）。 */
export interface PortalStudent {
  id: string
  name: string
  gender?: '男' | '女'
  dorm?: string
  color?: string
}
export interface PortalPeriod {
  id: number
  name: string
  start: string
  end: string
}
export interface PortalCourseItem {
  periodId: number
  subject: string
  teacher?: string
  changeLabel?: '代课' | '调课'
}
export interface PortalDayCourses {
  weekday: number
  label: string
  short: string
  items: PortalCourseItem[]
}
export interface PortalPhoto {
  id: string
  title: string
  studentId: string
  ratio: number
  url: string
  color: string
  available?: boolean
}
export interface PortalSnapshotData {
  classInfo: {
    name: string
    grade: string
    welcome: string
    lastUpdated: string
    studentCount: number
  }
  updatedAt: { schedule: string; students: string; seats: string; photos: string }
  students: PortalStudent[]
  periods: PortalPeriod[]
  week: PortalDayCourses[]
  classroom: {
    name: string
    rows: number
    cols: number
    blocks: readonly [number, number, number]
    podiumLabel: string
  }
  seats: Array<{ row: number; col: number; studentId: string | null }>
  photos: PortalPhoto[]
}

/** 调用方提供的、已读出字节的内联照片。 */
export interface InlinePhotoInput {
  studentId: string
  studentName: string
  dataUrl: string
}

export interface BuildSnapshotInput {
  students: readonly Student[]
  lessons: readonly Lesson[]
  seats: readonly Seat[]
  photos: readonly InlinePhotoInput[]
  /** 目标班级（Lesson.className 完全一致）；课表只保留这个班。 */
  className: string
  /** 快照生成时刻，用于「数据更新至」。 */
  generatedAt: Date
}

const WEEKDAYS: ReadonlyArray<{ weekday: number; label: string; short: string }> = [
  { weekday: 1, label: '星期一', short: '周一' },
  { weekday: 2, label: '星期二', short: '周二' },
  { weekday: 3, label: '星期三', short: '周三' },
  { weekday: 4, label: '星期四', short: '周四' },
  { weekday: 5, label: '星期五', short: '周五' },
  { weekday: 6, label: '星期六', short: '周六' },
  { weekday: 7, label: '星期日', short: '周日' },
]

/** CoursePeriodId → 门户时段序号（1..10），以 COURSE_PERIODS.order 为唯一来源。 */
const PERIOD_NUMBER: Record<CoursePeriodId, number> = Object.fromEntries(
  COURSE_PERIODS.map((period) => [period.id, period.order]),
) as Record<CoursePeriodId, number>

function colorFor(value: string): string {
  let hash = 0
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  const palette = ['#2F8F83', '#4B7F9E', '#8A6F9E', '#B07A56', '#5F8F6B', '#A46B6B']
  return palette[hash % palette.length] ?? '#2F8F83'
}

/** 本地日历日时间（与项目其它处一致，不用 toISOString，避免 UTC 偏移）。 */
export function formatLocalDateTime(date: Date): string {
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function changeLabelOf(type: Lesson['type']): PortalCourseItem['changeLabel'] {
  if (type === 'substitute') return '代课'
  if (type === 'adjusted') return '调课'
  return undefined
}

/**
 * 推断课表过滤用的目标班级：优先显式传入，否则取课表里出现次数最多的 className。
 * 班主任本地课表通常本人班级占多数，这样无论数据是「高一9班」还是「9班」都能正确选出。
 */
export function inferClassName(lessons: readonly Lesson[], explicit = ''): string {
  const value = explicit.trim()
  if (value) return value
  const counts = new Map<string, number>()
  for (const lesson of lessons) {
    const name = (lesson.className ?? '').trim()
    if (!name) continue
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  let best = ''
  let bestCount = 0
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name
      bestCount = count
    }
  }
  return best
}

export function buildPortalSnapshot(input: BuildSnapshotInput): PortalSnapshotData {
  const activeStudents = input.students.filter((student) => !student.deletedAt)
  const activeIds = new Set(activeStudents.map((student) => student.id))
  const className = input.className.trim()

  const students: PortalStudent[] = activeStudents.map((student) => ({
    id: student.id,
    name: student.name,
    ...(student.gender === 'male'
      ? { gender: '男' as const }
      : student.gender === 'female'
        ? { gender: '女' as const }
        : {}),
    ...(student.dormitory ? { dorm: student.dormitory } : {}),
    color: colorFor(student.id),
  }))

  const periods: PortalPeriod[] = COURSE_PERIODS.map((period) => ({
    id: period.order,
    name: period.label,
    start: period.startTime,
    end: period.endTime,
  }))

  const week: PortalDayCourses[] = WEEKDAYS.map((day) => {
    const items: PortalCourseItem[] = []
    for (const lesson of input.lessons) {
      const lessonClass = (lesson.className ?? '').trim()
      if (className && lessonClass !== className) continue
      if (Number(lesson.weekday) !== day.weekday) continue
      const periodId = PERIOD_NUMBER[lesson.periodId]
      if (!periodId || !lesson.subject) continue
      const changeLabel = changeLabelOf(lesson.type)
      items.push({
        periodId,
        subject: lesson.subject,
        ...(lesson.teacher ? { teacher: lesson.teacher } : {}),
        ...(changeLabel ? { changeLabel } : {}),
      })
    }
    items.sort((a, b) => a.periodId - b.periodId)
    return { weekday: day.weekday, label: day.label, short: day.short, items }
  })

  const seats = input.seats.map((seat) => ({
    row: seat.row,
    col: seat.col,
    studentId: seat.studentId && activeIds.has(seat.studentId) ? seat.studentId : null,
  }))

  const photos: PortalPhoto[] = input.photos
    .filter((photo) => activeIds.has(photo.studentId) && photo.dataUrl)
    .map((photo) => ({
      id: photo.studentId,
      title: photo.studentName,
      studentId: photo.studentId,
      ratio: 3 / 4,
      url: photo.dataUrl,
      color: colorFor(photo.studentId),
      available: true,
    }))
    .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))

  const stamp = formatLocalDateTime(input.generatedAt)
  const displayName = DEFAULT_CLASSROOM_CONFIG.name

  return {
    classInfo: {
      name: displayName,
      grade: '高一',
      welcome: '欢迎回到班级门户',
      lastUpdated: stamp,
      studentCount: activeStudents.length,
    },
    updatedAt: { schedule: stamp, students: stamp, seats: stamp, photos: stamp },
    students,
    periods,
    week,
    classroom: {
      name: displayName,
      rows: DEFAULT_CLASSROOM_CONFIG.rows,
      cols: DEFAULT_CLASSROOM_CONFIG.cols,
      blocks: DEFAULT_CLASSROOM_CONFIG.blocks,
      podiumLabel: '讲台',
    },
    seats,
    photos,
  }
}
