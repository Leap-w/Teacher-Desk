/**
 * 学生照片元数据工具（v3.8.0 · Phase 1B 数据层）。
 *
 * 只做**纯逻辑**：normalize / 校验 / 排序 / 状态派生 / 路径与快照维护。
 * 不碰 IndexedDB、不碰 localStorage、不碰 SDK，因此可在 node 测试环境直接跑。
 *
 * ## 三条关键取舍
 *
 * ① **未知字段安全保留**（跨版本兼容）：未来版本可能给照片加字段。读取时把不认识的
 *    **JSON-safe** 字段原样带在对象上（`{ ...extras, ...已知字段 }`），写盘时自然保留；
 *    但对二进制/敏感类字段（Blob / Base64 / 签名 URL 等）一律剔除——`Blob` 进了
 *    元数据会破坏同步 payload，签名 URL 进了元数据会过期后变成脏数据。
 * ② **坏记录丢弃、好记录绝不因个别字段坏掉而丢**：id / studentId / category 缺失才丢弃；
 *    `uploadedAt` / `width` 等坏值用安全默认值兜底（照片已经存在，不能因为时间戳格式
 *    坏了就把整条记录丢掉——那会让本地图片变成无主孤儿）。
 * ③ **当前证件照每生至多一条**：`revive` 时收敛（多条的取"最后指定"的那一条：
 *    `updatedAt` 最新 → `uploadedAt` 最新 → id 最小），其余清除标记。
 */
import { PHOTO_PROCESSING, PHOTO_STORAGE_ROOT } from '@/config/photo'
import { buildNameCounts, formatStudentShortName } from '@/utils/student'
import { isPlainObject } from '@/utils/object'
import type { Student } from '@/types'
import {
  KNOWN_STUDENT_PHOTO_CATEGORIES,
  STUDENT_PHOTO_CATEGORY_LABELS,
  type StudentPhoto,
  type StudentPhotoCategory,
  type StudentPhotoMediaState,
} from '@/types/studentPhoto'

/** 分类中文文案（UI / 备份 / 日志共用） */
export { STUDENT_PHOTO_CATEGORY_LABELS }

/** 全部合法分类（由 `types` 单一定义，这里只转发） */
export const KNOWN_PHOTO_CATEGORIES = KNOWN_STUDENT_PHOTO_CATEGORIES

export function isStudentPhotoCategory(value: unknown): value is StudentPhotoCategory {
  return typeof value === 'string' && (KNOWN_PHOTO_CATEGORIES as readonly string[]).includes(value)
}

/* ========== 小工具 ========== */

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** ISO 时间串：能被 `Date.parse` 认出的非空字符串（统一用 ISO/UTC，展示层再转本地时区） */
function isoOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return Number.isNaN(Date.parse(trimmed)) ? undefined : trimmed
}

function positiveIntOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

/** MIME → 文件扩展名（只用于路径与兜底推断；输出统一 jpeg） */
export function photoExtensionForMimeType(mimeType: string): 'jpg' | 'png' | 'webp' {
  const normalized = mimeType.toLowerCase()
  if (normalized === 'image/png') return 'png'
  if (normalized === 'image/webp') return 'webp'
  return 'jpg'
}

function guessMimeTypeFromPath(path: string): string | undefined {
  const lower = path.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  return undefined
}

/**
 * 云端对象路径（**不含学生姓名**）：
 * `student-photos/<studentId>/<photoId>.jpg`。
 * 只用稳定 ID（UUID），因此不会因改名而漂移，也不会暴露学生身份。
 */
export function buildPhotoStoragePath(
  studentId: string,
  photoId: string,
  mimeType: string = PHOTO_PROCESSING.outputMimeType,
): string {
  const safeStudentId = studentId.replace(/[^a-zA-Z0-9_-]/g, '')
  const safePhotoId = photoId.replace(/[^a-zA-Z0-9_-]/g, '')
  const extension = photoExtensionForMimeType(mimeType)
  return `${PHOTO_STORAGE_ROOT}/${safeStudentId}/${safePhotoId}.${extension}`
}

/* ========== 未知字段（跨版本）安全保留 ========== */

/** 明确不能出现在元数据里的字段名（二进制 / 签名 URL / dataURL） */
const UNSAFE_EXTRA_KEY =
  /(blob|arraybuffer|base64|dataurl|signedurl|tempfileurl|downloadurl|filecontent|binary|objecturl)/i

/** JSON-safe：原始值、纯对象、纯数组；Blob / ArrayBuffer / Date / 函数一律不算 */
function isJsonSafeValue(value: unknown, depth = 0): boolean {
  if (value === null) return true
  const kind = typeof value
  if (kind === 'string' || kind === 'number' || kind === 'boolean') return true
  if (kind !== 'object') return false
  if (depth >= 4) return false
  if (Array.isArray(value)) return value.every((item) => isJsonSafeValue(item, depth + 1))
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  return Object.values(value as Record<string, unknown>).every((item) =>
    isJsonSafeValue(item, depth + 1),
  )
}

/** 已知字段名（不进入 extras；其余字段视作未知字段） */
const KNOWN_PHOTO_KEYS = new Set<string>([
  'id',
  'studentId',
  'studentName',
  'category',
  'isCurrentIdPhoto',
  'fileId',
  'storagePath',
  'mimeType',
  'width',
  'height',
  'size',
  'uploadedAt',
  'updatedAt',
  'createdAt',
  'deletedAt',
])

/**
 * 提取「未知但可安全保留」的字段。
 * 命中二进制 / 签名 URL 关键词的键、或值不是 JSON-safe 的，直接丢掉（不报错）。
 */
function safeExtraFields(raw: Record<string, unknown>): Record<string, unknown> {
  const extras: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (KNOWN_PHOTO_KEYS.has(key)) continue
    if (UNSAFE_EXTRA_KEY.test(key)) continue
    if (!isJsonSafeValue(value)) continue
    extras[key] = value
  }
  return extras
}

/* ========== normalize / revive ========== */

/**
 * 单条健壮化（load / 跨标签页同步 / 云端采纳 / 备份导入共用这一份）。
 *
 * **丢弃条件**只有三个：不是对象、缺 `id`、缺 `studentId`、分类不合法。
 * 其余字段一律安全兜底——一张照片的记录已经存在时，丢记录比留一条带兜底值的记录更糟
 * （本地/云端图片会变成无主孤儿）。
 */
export function normalizeStudentPhoto(raw: unknown): StudentPhoto | null {
  if (!isPlainObject(raw)) return null

  const id = textOf(raw.id)
  if (!id) return null
  const studentId = textOf(raw.studentId)
  if (!studentId) return null
  const category = raw.category
  if (!isStudentPhotoCategory(category)) return null

  const uploadedAt = isoOf(raw.uploadedAt) ?? isoOf(raw.createdAt) ?? new Date().toISOString()
  const createdAt = isoOf(raw.createdAt) ?? uploadedAt
  const updatedAt = isoOf(raw.updatedAt) ?? uploadedAt
  const deletedAt = isoOf(raw.deletedAt)

  const storagePath = textOf(raw.storagePath)
  const mimeType =
    (typeof raw.mimeType === 'string' && raw.mimeType.trim().startsWith('image/')
      ? raw.mimeType.trim()
      : undefined) ??
    guessMimeTypeFromPath(storagePath) ??
    PHOTO_PROCESSING.outputMimeType

  const photo: StudentPhoto = {
    ...safeExtraFields(raw),
    id,
    studentId,
    studentName: textOf(raw.studentName),
    category,
    storagePath: storagePath || buildPhotoStoragePath(studentId, id, mimeType),
    mimeType,
    width: positiveIntOf(raw.width),
    height: positiveIntOf(raw.height),
    size: positiveIntOf(raw.size),
    uploadedAt,
    updatedAt,
    createdAt,
    ...(deletedAt ? { deletedAt } : {}),
  }

  const fileId = textOf(raw.fileId)
  if (fileId) photo.fileId = fileId
  // 当前证件照只对证件照有意义；数字/字符串 `true` 之类不可信值一律不算
  if (category === 'id-photo' && raw.isCurrentIdPhoto === true) photo.isCurrentIdPhoto = true

  return photo
}

/**
 * 当前证件照收敛：每名学生**至多一条**。
 *
 * 多条时的裁决规则（确定性）：`updatedAt` 最新 → `uploadedAt` 最新 → id 字典序最小。
 * 已删除记录 / 生活照上的标记一律清除（墓碑不参与"当前证件照"语义）。
 */
export function ensureSingleCurrentIdPhoto(records: StudentPhoto[]): StudentPhoto[] {
  const winners = new Map<string, StudentPhoto>()
  for (const photo of records) {
    if (photo.deletedAt) continue
    if (photo.category !== 'id-photo') continue
    if (photo.isCurrentIdPhoto !== true) continue
    const current = winners.get(photo.studentId)
    if (!current || isLaterDesignation(photo, current)) winners.set(photo.studentId, photo)
  }

  let changed = false
  const next = records.map((photo) => {
    const shouldKeep =
      !photo.deletedAt &&
      photo.category === 'id-photo' &&
      photo.isCurrentIdPhoto === true &&
      winners.get(photo.studentId)?.id === photo.id
    if (photo.isCurrentIdPhoto !== true) return photo
    if (shouldKeep) return photo
    changed = true
    const copy: StudentPhoto = { ...photo }
    delete copy.isCurrentIdPhoto
    return copy
  })
  return changed ? next : records
}

function isLaterDesignation(candidate: StudentPhoto, current: StudentPhoto): boolean {
  if (candidate.updatedAt !== current.updatedAt) {
    return candidate.updatedAt > current.updatedAt
  }
  if (candidate.uploadedAt !== current.uploadedAt) {
    return candidate.uploadedAt > current.uploadedAt
  }
  return candidate.id < current.id
}

/**
 * 把盘上的原始数组规范成照片元数据：
 * - 逐条 normalize；id 重复只留首条（重复会让 IndexedDB 键与 v-for key 冲突）；
 * - 最终收敛「当前证件照唯一」；
 * - 丢弃 / 收敛都只告警，**不动盘上原文**。
 */
export function reviveStudentPhotos(raw: unknown[]): StudentPhoto[] {
  const seenIds = new Set<string>()
  const photos: StudentPhoto[] = []
  for (const item of raw) {
    const photo = normalizeStudentPhoto(item)
    if (!photo) continue
    if (seenIds.has(photo.id)) continue
    seenIds.add(photo.id)
    photos.push(photo)
  }
  if (photos.length < raw.length) {
    console.warn(`[photo] 丢弃 ${raw.length - photos.length} 条不合法的照片元数据（缓存原文保留）`)
  }
  return ensureSingleCurrentIdPhoto(photos)
}

/* ========== 查询 / 排序 ========== */

/** 是否有效（未逻辑删除） */
export function isPhotoActive(photo: StudentPhoto): boolean {
  return !photo.deletedAt
}

/**
 * 照片展示排序（**返回新数组，不改入参**）：
 * 1. 当前证件照优先；
 * 2. 其余按上传时间倒序（新上传在前）；
 * 3. 最后用 id 兜底，保证顺序确定、刷新不变。
 */
export function sortStudentPhotos(photos: readonly StudentPhoto[]): StudentPhoto[] {
  return [...photos].sort((a, b) => {
    const aCurrent = a.isCurrentIdPhoto === true ? 1 : 0
    const bCurrent = b.isCurrentIdPhoto === true ? 1 : 0
    if (aCurrent !== bCurrent) return bCurrent - aCurrent
    if (a.uploadedAt !== b.uploadedAt) return a.uploadedAt < b.uploadedAt ? 1 : -1
    if (a.id === b.id) return 0
    return a.id < b.id ? -1 : 1
  })
}

/** 某名学生的有效照片（可按分类过滤），已按展示顺序排好 */
export function photosOfStudent(
  photos: readonly StudentPhoto[],
  studentId: string,
  category?: StudentPhotoCategory,
): StudentPhoto[] {
  return sortStudentPhotos(
    photos.filter(
      (photo) =>
        photo.studentId === studentId &&
        isPhotoActive(photo) &&
        (category ? photo.category === category : true),
    ),
  )
}

/** 某名学生当前的证件照（没有则 undefined） */
export function currentIdPhotoOf(
  photos: readonly StudentPhoto[],
  studentId: string,
): StudentPhoto | undefined {
  return photos.find(
    (photo) =>
      photo.studentId === studentId &&
      photo.category === 'id-photo' &&
      photo.isCurrentIdPhoto === true &&
      isPhotoActive(photo),
  )
}

/** 有效照片的总字节数（后续 UI 的容量提示用；不落盘、不强制限制） */
export function totalActivePhotoBytes(photos: readonly StudentPhoto[]): number {
  return photos.reduce((sum, photo) => (isPhotoActive(photo) ? sum + photo.size : sum), 0)
}

/* ========== 状态派生 ========== */

/** 派生状态输入（全部来自真实读取 / 运行时结果，不来自持久化布尔值） */
export interface PhotoPresenceInput {
  /** 本机 IndexedDB 里确实有原图 */
  hasLocal: boolean
  /** 本机是否正在上传这张照片 */
  uploading?: boolean
}

/**
 * 状态派生（顺序即优先级）：
 * 已删除 → uploading → 本地+云端 → 本地 → 云端 → 都没有。
 *
 * 关键：**只凭元数据推不出二进制存在**。`fileId` 只代表云端有过一份，
 * `hasLocal` 必须来自 IndexedDB 的实际读取结果。
 */
export function deriveStudentPhotoState(
  photo: StudentPhoto,
  presence: PhotoPresenceInput,
): StudentPhotoMediaState {
  if (photo.deletedAt) return 'deleted'
  if (presence.uploading) return 'uploading'
  if (presence.hasLocal) return photo.fileId ? 'ready' : 'local-only'
  return photo.fileId ? 'remote-only' : 'missing'
}

/* ========== 姓名快照刷新 ========== */

/**
 * 姓名快照刷新（**绝不丢记录**版）。
 *
 * 为什么不用 `refreshStudentNames`：那个公共件在「学生查无且快照为空」时会丢弃记录，
 * 而照片元数据丢了就再也找不回图片归属；这里对查无学生的情况**保留原快照**，最坏只是
 * 姓名旧一点。学生软删除后仍在 `students` 数组里，快照因此冻结在删除那一刻。
 */
export function refreshPhotoStudentNames(
  photos: StudentPhoto[],
  students: Student[],
): StudentPhoto[] {
  if (photos.length === 0) return photos
  const byId = new Map(students.map((student) => [student.id, student]))
  const nameCounts = buildNameCounts(students.filter((student) => !student.deletedAt))
  let changed = false
  const next = photos.map((photo) => {
    const student = byId.get(photo.studentId)
    if (!student) return photo
    const name = formatStudentShortName(student, nameCounts)
    if (!name || name === photo.studentName) return photo
    changed = true
    // 展开保留未知字段（跨版本安全）
    return { ...photo, studentName: name }
  })
  return changed ? next : photos
}

/** 体积文案（照片墙 / 容量提示共用；后续 UI 可用） */
export function formatStudentPhotoSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 分类文案（未知分类兜底，不抛错） */
export function studentPhotoCategoryLabel(category: unknown): string {
  return isStudentPhotoCategory(category) ? STUDENT_PHOTO_CATEGORY_LABELS[category] : '照片'
}
