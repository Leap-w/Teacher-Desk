/**
 * 单文件 HTML 导出的界面入口。
 *
 * 页面只需调用 exportPortalHtml()：本 composable 读取各 store 的当前数据，
 * 把每名学生的有效照片读成内联 data URL（本机字节优先，缺的走现有 CloudBase
 * 下载端口取内存 Blob），投影成 Portal 数据快照、拼装成单个 HTML 并下载。
 *
 * 照片一律先在本机内存里缩放到最长边 ≤640 再内联（v3.9.1）：本地与云端同一条规则，
 * 避免云端 1600px 原图把 HTML 撑到 10MB+，也避免同一面照片墙一半清楚一半糊。
 *
 * 全程只读现有数据：不写 localStorage / IndexedDB、不改 store、不改同步机制。
 * 云端只调用 getPhotoCloud().download() 取字节，不调用会落盘的 downloadPhotoToLocal，
 * 也不把 fileId / token / 签名 URL 放进 HTML。
 *
 * 分层：这是「汇聚多个 store + 触发下载」的界面能力，放 composables 层，
 * 页面不直接认识 utils/portalHtml 的细节，也不直接读照片字节。
 */
import { useStudentStore } from '@/stores/student'
import { useTimetableStore } from '@/stores/timetable'
import { useSeatStore } from '@/stores/seat'
import { useStudentPhotoStore } from '@/stores/studentPhoto'
import { getMediaStore } from '@/services/mediaStore'
import { getPhotoCloud } from '@/services/photoCloud'
import { getPhotoThumbnailGenerator } from '@/services/imagePipeline'
import { EXPORT_PHOTO_MAX_EDGE, EXPORT_PHOTO_QUALITY, PHOTO_PROCESSING } from '@/config/photo'
import { PORTAL_JS, PORTAL_CSS } from '@/utils/portalHtml/portalAssets'
import { buildPortalSnapshot, inferClassName } from '@/utils/portalHtml/portalSnapshot'
import {
  collectPortalPhotos,
  type PortalPhotoCandidate,
  type PortalPhotoStats,
} from '@/utils/portalHtml/collectPortalPhotos'
import { buildPortalHtml } from '@/utils/portalHtml/buildPortalHtml'
import { formatDateKey } from '@/utils/date'

export interface PortalExportResult {
  ok: boolean
  filename: string
  studentCount: number
  photoCount: number
  /** 有效照片元数据数（含下载失败的）。 */
  photoMetaCount: number
  /** 本机字节命中 / 云端下载命中 / 失败数。 */
  localPhotoCount: number
  cloudPhotoCount: number
  failedPhotoCount: number
  /** 失败原因分类（固定枚举，不含文件标识、URL 或凭据）。 */
  failureReasons: PortalPhotoStats['reasons']
  /** HTML 字节数（验收用：确认照片确实膨胀了文件）。 */
  htmlBytes: number
  error?: string
}

/** Blob → data URL（内联进 HTML，导出后文件自包含）。 */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('读取照片失败'))
    reader.readAsDataURL(blob)
  })
}

/**
 * 导出专用出图：复用既有 Canvas 管线（decode → draw → encode → `close()` 释放），
 * 只把参数换成「最长边 ≤640 / q0.8」。
 *
 * 为什么复用而不是新写一套：现有管线已经处理了 EXIF 方向（`createImageBitmap` 与
 * `<img>` 都按 `from-image` 解码）、透明底铺白、`ImageBitmap.close()` / objectURL 回收，
 * 重编码还会顺带剥掉 EXIF/GPS。这里**不写 IndexedDB、不动原图、不碰云端**。
 */
function prepareExportPhoto(blob: Blob): Promise<Blob> {
  return getPhotoThumbnailGenerator()(blob, {
    ...PHOTO_PROCESSING,
    thumbMaxEdge: EXPORT_PHOTO_MAX_EDGE,
    thumbQuality: EXPORT_PHOTO_QUALITY,
  })
}

function filenameStamp(date: Date): string {
  return formatDateKey(date).replace(/-/g, '')
}

/** 触发浏览器下载一个文本字符串为 .html 文件。 */
function downloadHtml(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // 交给浏览器开始下载后再回收，避免个别浏览器取消下载
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export interface PortalExportOptions {
  /** 取消信号：中止后不生成也不下载 HTML。 */
  signal?: AbortSignal
  /** 真实进度回调：`done` 从 1 起，`total` 为待处理照片总张数。 */
  onProgress?: (done: number, total: number) => void
}

export function usePortalExport() {
  async function exportPortalHtml(options: PortalExportOptions = {}): Promise<PortalExportResult> {
    const studentStore = useStudentStore()
    const timetableStore = useTimetableStore()
    const seatStore = useSeatStore()
    const photoStore = useStudentPhotoStore()

    const students = studentStore.activeStudents
    const lessons = timetableStore.lessons
    const seats = seatStore.currentSeats
    const className = inferClassName(lessons)
    const signal = options.signal

    if (signal?.aborted) throw new DOMException('导出已取消', 'AbortError')

    // 只读本地媒体库：原图优先、其次缩略图；不调用 store.getPhotoThumbnail（那条路会落盘）。
    const media = getMediaStore()
    const cloud = getPhotoCloud()
    const candidates: PortalPhotoCandidate[] = photoStore.photos
      .filter((photo) => !photo.deletedAt)
      .map((photo) => ({
        id: photo.id,
        studentId: photo.studentId,
        studentName: photo.studentName,
        category: photo.category,
        ...(photo.fileId ? { fileId: photo.fileId } : {}),
        ...(photo.mimeType ? { mimeType: photo.mimeType } : {}),
        updatedAt: photo.updatedAt,
        ...(photo.isCurrentIdPhoto ? { isCurrentIdPhoto: true } : {}),
      }))

    const collected = await collectPortalPhotos(
      candidates,
      students.map((student) => ({ id: student.id, name: student.name })),
      {
        readLocal: async (photoId) =>
          (await media.readFull(photoId)) ?? (await media.readThumb(photoId)) ?? null,
        readCloud: (fileId) => cloud.download(fileId),
        cloudAvailable: () => cloud.isAvailable(),
        prepare: prepareExportPhoto,
        toDataUrl: blobToDataUrl,
        signal,
        onProgress: options.onProgress,
      },
    )

    if (signal?.aborted) throw new DOMException('导出已取消', 'AbortError')

    const now = new Date()
    const data = buildPortalSnapshot({
      students,
      lessons,
      seats,
      photos: collected.photos,
      className,
      generatedAt: now,
    })

    const html = buildPortalHtml({ data, js: PORTAL_JS, css: PORTAL_CSS })
    const filename = `班级门户-${filenameStamp(now)}.html`
    downloadHtml(html, filename)

    return {
      ok: true,
      filename,
      studentCount: data.students.length,
      photoCount: collected.photos.length,
      photoMetaCount: collected.stats.metadataCount,
      localPhotoCount: collected.stats.localCount,
      cloudPhotoCount: collected.stats.cloudCount,
      failedPhotoCount: collected.stats.failedCount,
      failureReasons: collected.stats.reasons,
      htmlBytes: new Blob([html]).size,
    }
  }

  return { exportPortalHtml }
}
