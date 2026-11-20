/**
 * 班级门户展示页的**唯一**数据源（并入 TeacherDesk 后的精简版）。
 *
 * 原独立 Portal 项目在这里有 demo / api（fetch /api、鉴权）两条路径；本项目只用于
 * 单文件 HTML 导出，数据在生成时由 TeacherDesk 写入 window.__PORTAL_SNAPSHOT__。
 * 因此这里只保留静态快照一条路径：不发网络请求、没有登录态、没有演示数据。
 *
 * 页面组件只认 `portalData`（与合并前完全相同的接口），不关心数据从哪来。
 */
import type {
  ClassInfo,
  Classroom,
  DayCourses,
  ModuleUpdatedAt,
  Period,
  Photo,
  PortalDataSource,
  Seat,
  Student,
} from './types'

/** 与 TeacherDesk `utils/portalHtml/portalSnapshot.ts` 的 PortalSnapshotData 同形。 */
export interface PortalSnapshot {
  classInfo: ClassInfo
  updatedAt: ModuleUpdatedAt
  students: Student[]
  periods: Period[]
  week: DayCourses[]
  classroom: Classroom
  seats: Seat[]
  photos: Photo[]
}

type SnapshotHost = typeof globalThis & { __PORTAL_SNAPSHOT__?: PortalSnapshot }
const snapshot: PortalSnapshot | undefined = (globalThis as SnapshotHost).__PORTAL_SNAPSHOT__

const emptySnapshot: PortalSnapshot = {
  classInfo: {
    name: '高一9班',
    grade: '高一',
    welcome: '欢迎回到班级门户',
    lastUpdated: '',
    studentCount: 0,
  },
  updatedAt: { schedule: '', students: '', seats: '', photos: '' },
  students: [],
  periods: [],
  week: [],
  classroom: { name: '高一9班', rows: 7, cols: 9, blocks: [3, 3, 3], podiumLabel: '讲台' },
  seats: [],
  photos: [],
}

const data: PortalSnapshot = snapshot ?? emptySnapshot

/** 快照对外一律是只读内容（与合并前导出时的 mode='api' 一致，避免出现「演示版」字样）。 */
export const portalData: PortalDataSource = {
  mode: 'api',
  get classInfo() {
    return data.classInfo
  },
  get updatedAt() {
    return data.updatedAt
  },
  get students() {
    return data.students
  },
  get periods() {
    return data.periods
  },
  get week() {
    return data.week
  },
  get classroom() {
    return data.classroom
  },
  get seats() {
    return data.seats
  },
  get photos() {
    return data.photos
  },
  studentById(id) {
    return data.students.find((student) => student.id === id)
  },
  photoUrl(photo) {
    return photo.url
  },
}

export type { ClassInfo, Classroom, DayCourses, Period, Photo, Seat, Student } from './types'
