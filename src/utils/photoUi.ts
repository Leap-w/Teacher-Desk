/**
 * 学生照片 UI 的纯逻辑（v3.8.0 · Phase 2）。
 *
 * 组件只做渲染；照片状态文案、照片墙行、大图浏览顺序、批量上传编排这些逻辑放这里，
 * 可在 node 测试里直接跑。**不重新实现图片处理 / 云端上传 / 状态派生**——全部来自 Phase 1B。
 */
import { sortStudentPhotos } from '@/utils/studentPhoto'
import { formatDateKey } from '@/utils/date'
import type { Student } from '@/types'
import type {
  StudentPhoto,
  StudentPhotoCategory,
  StudentPhotoMediaState,
} from '@/types/studentPhoto'

/* ==================== 状态文案（普通教师能看懂） ==================== */

export type PhotoStatusTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral'

export interface PhotoStatusView {
  /** `upload-failed` 是 UI 叠加态：数据层状态仍是 local-only，但有明确的失败原因 */
  kind: StudentPhotoMediaState | 'upload-failed'
  label: string
  tone: PhotoStatusTone
  description: string
}

/** 数据层派生状态 → 界面文案（**remote-only 不是"缺失"**） */
export const PHOTO_STATE_VIEW: Record<StudentPhotoMediaState, PhotoStatusView> = {
  ready: {
    kind: 'ready',
    label: '本机与云端可用',
    tone: 'success',
    description: '照片在本机，云端也有备份。',
  },
  'local-only': {
    kind: 'local-only',
    label: '仅本机保存',
    tone: 'warning',
    description: '照片保存在这台设备上，还没有上传到云端。联网并登录后会自动补传。',
  },
  'remote-only': {
    kind: 'remote-only',
    label: '仅云端保存',
    tone: 'info',
    description: '照片已在云端，本机还没有缓存；查看时会自动下载。',
  },
  uploading: {
    kind: 'uploading',
    label: '正在上传…',
    tone: 'info',
    description: '正在把照片上传到云端，请稍候。',
  },
  missing: {
    kind: 'missing',
    label: '照片缺失',
    tone: 'danger',
    description: '本机和云端都找不到这张照片的文件，可能已被清理或未同步完成。',
  },
  deleted: {
    kind: 'deleted',
    label: '已删除',
    tone: 'neutral',
    description: '这张照片已标记删除，不再作为正常照片展示。',
  },
}

/**
 * 显示用状态：在数据层状态之上叠加"上传失败"。
 * 只有 `local-only` + 有失败原因时才算上传失败——不能把"没传过"说成"传失败"。
 */
export function photoStatusView(
  state: StudentPhotoMediaState,
  lastError?: string,
): PhotoStatusView {
  if (state === 'local-only' && lastError) {
    return {
      kind: 'upload-failed',
      label: '上传失败（已存本机）',
      tone: 'danger',
      description: `照片已安全保存在本机，但上传云端失败：${lastError}。可以稍后重试。`,
    }
  }
  return PHOTO_STATE_VIEW[state]
}

/**
 * 备份提示（需求明确要求展示；不要让教师误以为「导出了 JSON 就等于照片也备份了」）。
 * v3.8.1 起另有「完整备份（含照片）」ZIP 入口，因此这里同时给出两条路的分工。
 */
export const PHOTO_BACKUP_NOTICE =
  '学生照片默认保存在本机。普通 JSON 备份仅包含照片信息、不包含照片文件；需要把照片文件一起备份时，请到「我的 → 数据与同步 → 导出完整备份（含照片）」，更换设备或恢复数据后可从该 ZIP 恢复照片文件。'

/**
 * 是否应该给这张照片提供「上传到云端」入口（v3.8.1 Phase 1.1）。
 *
 * 只针对 `local-only`：本机有图、云端没有。`upload-failed` 已有「重试上传」入口，
 * `ready` / `remote-only` / `uploading` 都不需要。恢复出来的无 `fileId` 照片正是
 * `local-only`——没有这个入口时，教师会看到「仅本机保存」却无任何可点的补救动作。
 *
 * **不新建自动上传队列**：按钮调用既有 `photoStore.queuePhotoUpload()`，
 * 仍是原来的 outbox + flush 链路。
 */
export function canUploadLocalPhoto(state: StudentPhotoMediaState): boolean {
  return state === 'local-only'
}

/* ==================== 分类 / 时间 ==================== */

export type PhotoCategoryFilter = StudentPhotoCategory | 'all'

export const PHOTO_CATEGORY_FILTER_OPTIONS: { value: PhotoCategoryFilter; label: string }[] = [
  { value: 'id-photo', label: '证件照' },
  { value: 'life-photo', label: '生活照' },
  { value: 'all', label: '全部照片' },
]

export function photoCategoryText(category: StudentPhotoCategory): string {
  return category === 'id-photo' ? '证件照' : '生活照'
}

/** 按"证件照 / 生活照 / 全部"取某学生的有效照片（已按展示顺序排好） */
export function filterStudentPhotos(
  photos: readonly StudentPhoto[],
  filter: PhotoCategoryFilter,
): StudentPhoto[] {
  const matched =
    filter === 'all' ? [...photos] : photos.filter((photo) => photo.category === filter)
  return sortStudentPhotos(matched)
}

/**
 * 上传时间文案（`YYYY-MM-DD HH:mm`，本地时区）。
 * 元数据里存 ISO/UTC；这里只在展示层转本地时间，**不写回数据**。
 */
export function formatPhotoUploadedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const day = formatDateKey(date)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${day} ${hours}:${minutes}`
}

/* ==================== 班级照片墙 ==================== */

export interface ClassPhotoWallRow {
  student: Student
  /** 当前证件照（没有就是 undefined → 显示统一占位，**绝不拿生活照顶替**） */
  currentPhoto?: StudentPhoto
  /** 该学生有效照片总数（含证件照 / 生活照） */
  photoCount: number
}

/**
 * 班级照片墙行：每名在读学生一行/一卡。
 *
 * 规则：
 * - 只用传入的 `students`（调用方传在读名册，已软删除学生不在其中）；
 * - 优先当前证件照；没有就是占位，**不自动从生活照挑一张**冒充证件照；
 * - 顺序保持传入名册顺序（学生档案的既有顺序），不额外打乱。
 */
export function buildClassPhotoWall(
  students: readonly Student[],
  photos: readonly StudentPhoto[],
): ClassPhotoWallRow[] {
  return students.map((student) => {
    const own = photos.filter((photo) => photo.studentId === student.id && !photo.deletedAt)
    const currentPhoto = own.find(
      (photo) => photo.category === 'id-photo' && photo.isCurrentIdPhoto === true,
    )
    return { student, currentPhoto, photoCount: own.length }
  })
}

/* ==================== 大图查看 ==================== */

/** 大图浏览顺序（当前证件照优先 → 上传时间倒序，与照片墙一致） */
export function buildPhotoViewerSequence(photos: readonly StudentPhoto[]): StudentPhoto[] {
  return sortStudentPhotos(photos.filter((photo) => !photo.deletedAt))
}

export function photoViewerIndexOf(sequence: readonly StudentPhoto[], photoId: string): number {
  return sequence.findIndex((photo) => photo.id === photoId)
}

/**
 * 上一张 / 下一张（首尾循环；空序列返回 undefined）。
 * `delta = -1` 上一张，`delta = 1` 下一张。
 */
export function stepPhotoViewer(
  sequence: readonly StudentPhoto[],
  currentId: string,
  delta: number,
): string | undefined {
  if (sequence.length === 0) return undefined
  const index = photoViewerIndexOf(sequence, currentId)
  if (index === -1) return sequence[0]?.id
  const nextIndex = (index + delta + sequence.length) % sequence.length
  return sequence[nextIndex]?.id
}

/* ==================== 批量上传编排 ==================== */

export interface PhotoUploadItem {
  fileName: string
  file: Blob
}

export interface PhotoUploadItemResult {
  fileName: string
  ok: boolean
  photoId?: string
  /** 失败原因（已可展示） */
  error?: string
}

export interface PhotoUploadBatchResult {
  results: PhotoUploadItemResult[]
  /** 是否因为取消而没有处理剩余文件 */
  cancelled: boolean
}

export interface PhotoUploadBatchOptions {
  /** 每开始一张前检查；返回 true 则停止（已成功的不会回滚） */
  shouldCancel?: () => boolean
  /** 进度回调（已处理数 / 总数），供界面显示进度 */
  onProgress?: (done: number, total: number) => void
}

/**
 * 顺序批量上传（一次一张，手机上更稳）。
 *
 * 关键行为：
 * - **一张失败不影响其它张**（逐张记结果，不中断）；
 * - 取消只取消"尚未开始"的文件，**已经成功的照片不丢**；
 * - 每张都走调用方给的 `uploadOne`（内部使用 Phase 1B 的 `store.addPhoto`，
 *   不在这里重写图片处理 / 上传逻辑）。
 */
export async function runPhotoUploadBatch(
  items: readonly PhotoUploadItem[],
  uploadOne: (item: PhotoUploadItem) => Promise<{ photoId: string }>,
  options: PhotoUploadBatchOptions = {},
): Promise<PhotoUploadBatchResult> {
  const results: PhotoUploadItemResult[] = []
  let cancelled = false
  for (let index = 0; index < items.length; index += 1) {
    if (options.shouldCancel?.()) {
      cancelled = true
      break
    }
    const item = items[index]!
    options.onProgress?.(index, items.length)
    try {
      const { photoId } = await uploadOne(item)
      results.push({ fileName: item.fileName, ok: true, photoId })
    } catch (error) {
      results.push({
        fileName: item.fileName,
        ok: false,
        error: error instanceof Error && error.message ? error.message : '上传失败',
      })
    }
  }
  options.onProgress?.(results.length, items.length)
  return { results, cancelled }
}

/** 批量上传结果汇总（界面反馈 + 测试断言） */
export function summarizePhotoUploadBatch(result: PhotoUploadBatchResult): {
  success: number
  failed: number
  cancelled: boolean
  failedFiles: { fileName: string; error?: string }[]
} {
  const success = result.results.filter((item) => item.ok).length
  const failedFiles = result.results
    .filter((item) => !item.ok)
    .map((item) => ({ fileName: item.fileName, error: item.error }))
  return {
    success,
    failed: failedFiles.length,
    cancelled: result.cancelled,
    failedFiles,
  }
}

/* ==================== 其他小件 ==================== */

/** 从文件列表构建上传项（保留原始文件名，供失败反馈显示） */
export function toPhotoUploadItems(files: readonly File[]): PhotoUploadItem[] {
  return files.map((file) => ({ fileName: file.name, file }))
}

/** 照片是否为当前证件照（UI 判断集中一处） */
export function isCurrentIdPhoto(photo: StudentPhoto): boolean {
  return photo.category === 'id-photo' && photo.isCurrentIdPhoto === true && !photo.deletedAt
}

/** 某学生照片数量摘要：「证件照 2 · 生活照 5」 */
export function photoCountSummary(photos: readonly StudentPhoto[]): string {
  const active = photos.filter((photo) => !photo.deletedAt)
  const idPhotos = active.filter((photo) => photo.category === 'id-photo').length
  const lifePhotos = active.filter((photo) => photo.category === 'life-photo').length
  return `证件照 ${idPhotos} · 生活照 ${lifePhotos}`
}
