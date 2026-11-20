/** Public, read-only shapes used by the pages. No sensitive fields by design. */
export interface ClassInfo {
  name: string
  grade: string
  welcome: string
  lastUpdated: string
  studentCount: number
}

export interface Student {
  id: string
  name: string
  gender?: '男' | '女'
  dorm?: string
  duty?: string
  bio?: string
  color?: string
}

export interface Period {
  id: number
  name: string
  start: string
  end: string
}

export interface CourseItem {
  periodId: number
  subject: string
  teacher?: string
  /** '代课' | '调课' — 由 TeacherDesk `Lesson.type` 派生，普通课没有这个字段。 */
  changeLabel?: string
}

export interface DayCourses {
  /** 1 = Monday … 7 = Sunday */
  weekday: number
  label: string
  short: string
  items: CourseItem[]
}

export interface Classroom {
  name: string
  rows: number
  cols: number
  blocks: readonly [number, number, number]
  podiumLabel: string
}

export interface Seat {
  row: number
  col: number
  studentId: string | null
}

/** A fictional student-ID placeholder. No real photo or identity data. */
export interface Photo {
  id: string
  title: string
  studentId: string
  /** 证件照 / 生活照；导出快照据实标记，不把生活照冒充证件照。 */
  category?: 'id-photo' | 'life-photo'
  ratio: number
  url: string
  color: string
  available?: boolean
}

/** 四个模块各自的更新时间（已格式化；空串 = 该模块没有可信时间）。 */
export interface ModuleUpdatedAt {
  schedule: string
  students: string
  seats: string
  photos: string
}

/**
 * The only interface pages are allowed to read from.
 * Swap this implementation for an API-backed one later; pages never import demo data directly.
 */
export interface PortalDataSource {
  readonly mode: 'demo' | 'api'
  readonly classInfo: ClassInfo
  readonly updatedAt: ModuleUpdatedAt
  readonly students: readonly Student[]
  readonly periods: readonly Period[]
  readonly week: readonly DayCourses[]
  readonly classroom: Classroom
  readonly seats: readonly Seat[]
  readonly photos: readonly Photo[]
  studentById(id: string): Student | undefined
  photoUrl(photo: Photo): string
}
