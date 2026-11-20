/**
 * 单文件 HTML 导出的界面入口（v3.9.0）。
 *
 * 页面只需调用 exportPortalHtml()：本 composable 读取各 store 的当前数据、
 * 把当前证件照读成内联 data URL、投影成 Portal 数据快照、拼装成单个 HTML 并下载。
 * 全程只读现有数据，不写盘、不改任何 store、不访问网络、不触碰同步机制。
 *
 * 分层：这是「汇聚多个 store + 触发下载」的界面能力，放 composables 层，
 * 页面不直接认识 utils/portalHtml 的细节，也不直接读照片字节。
 */
import { useStudentStore } from '@/stores/student'
import { useTimetableStore } from '@/stores/timetable'
import { useSeatStore } from '@/stores/seat'
import { useStudentPhotoStore } from '@/stores/studentPhoto'
import { PORTAL_JS, PORTAL_CSS } from '@/utils/portalHtml/portalAssets'
import {
  buildPortalSnapshot,
  inferClassName,
  type InlinePhotoInput,
} from '@/utils/portalHtml/portalSnapshot'
import { buildPortalHtml } from '@/utils/portalHtml/buildPortalHtml'
import { formatDateKey } from '@/utils/date'

export interface PortalExportResult {
  ok: boolean
  filename: string
  studentCount: number
  photoCount: number
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

export function usePortalExport() {
  async function exportPortalHtml(): Promise<PortalExportResult> {
    const studentStore = useStudentStore()
    const timetableStore = useTimetableStore()
    const seatStore = useSeatStore()
    const photoStore = useStudentPhotoStore()

    const students = studentStore.activeStudents
    const lessons = timetableStore.lessons
    const seats = seatStore.currentSeats
    const className = inferClassName(lessons)

    // 当前证件照 → 内联 data URL。单张失败只跳过该张，不阻塞整次导出。
    const inlinePhotos: InlinePhotoInput[] = []
    for (const student of students) {
      const photo = photoStore.currentIdPhoto(student.id)
      if (!photo || photo.deletedAt) continue
      try {
        const blob = await photoStore.getPhotoThumbnail(photo.id)
        const dataUrl = await blobToDataUrl(blob)
        inlinePhotos.push({
          studentId: student.id,
          studentName: student.name,
          dataUrl,
        })
      } catch {
        // 照片缺失 / 本机媒体不可用时跳过，页面照片墙会少这一格，但数据本身完整。
      }
    }

    const now = new Date()
    const data = buildPortalSnapshot({
      students,
      lessons,
      seats,
      photos: inlinePhotos,
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
      photoCount: data.photos.length,
    }
  }

  return { exportPortalHtml }
}
