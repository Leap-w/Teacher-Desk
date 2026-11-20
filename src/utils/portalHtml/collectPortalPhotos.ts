/**
 * 单文件导出用的照片收集器（v3.9.1 云端读取修复）。
 *
 * 输入是 TeacherDesk 的照片元数据 + 三个注入端口（本地读字节 / 云端下载 / Blob→data URL），
 * 输出是可直接内联的 InlinePhotoInput[] 与**逐项统计**。刻意做成纯逻辑：
 * 文件里不 import store / service / SDK，既能被 composable 接上真实链路，也能在 node 里测到
 * 本地命中、云端命中、单张失败、全部失败、未登录、断网、取消这些分支。
 *
 * 纪律：
 * - 本地字节优先；本地没有才用 fileId 走调用方注入的云端下载（真实实现 = photoCloud.download，
 *   只返回内存 Blob，不写 IndexedDB）。
 * - **拿到字节后一律过 `prepare` 端口**（真实实现 = Canvas 等比缩放到最长边 ≤640）：
 *   本地与云端走同一条规则，导出的照片尺寸/画质一致，HTML 体积可控。
 * - 逐张顺序处理，data URL 拿到即释放 Blob 引用；不把 fileId / token 放进任何输出。
 * - 失败绝不静默：每张都记原因分类，调用方据此向用户提示（对外文案见 `PORTAL_PHOTO_FAILURE_LABELS`）。
 * - 进度按**真实完成张数**上报，不做定时动画。
 */
import type { InlinePhotoInput } from './portalSnapshot'

/** 收集器只需要这些照片字段（都是展示用元数据，不含凭据）。 */
export interface PortalPhotoCandidate {
  id: string
  studentId: string
  studentName: string
  category: 'id-photo' | 'life-photo'
  /** 云端备份标识；**不会**进入导出 HTML，只用于调用下载端口。 */
  fileId?: string
  /** 元数据里的 MIME；云端 Blob 没带类型时据此标注，不伪造内容。 */
  mimeType?: string
  updatedAt: string
  isCurrentIdPhoto?: boolean
}

/** 当前在读学生（只取 id / name；姓名用于 data URL 的展示标签）。 */
export interface PortalPhotoStudent {
  id: string
  name: string
}

export interface CollectPortalPhotosPorts {
  /** 只读本地媒体库：原图优先（统一缩放的输入更接近原貌），其次缩略图；找不到返回 null。 */
  readLocal: (photoId: string) => Promise<Blob | null>
  /** 云端下载：真实实现为 getPhotoCloud().download(fileId)，返回内存 Blob，不写盘。 */
  readCloud: (fileId: string) => Promise<Blob>
  /** 云端是否具备下载条件（配置 + 登录态）；否时不发起下载。 */
  cloudAvailable: () => boolean
  /**
   * 统一出图：把任意来源的字节解码 → 等比缩放到最长边 ≤640 → 重新编码。
   * 本地与云端**必须**用同一个实现，否则导出的照片会一半清楚一半糊。
   * 真实实现在 `usePortalExport` 里（复用 imagePipeline 的 Canvas 管线，处理完即释放）。
   */
  prepare: (blob: Blob) => Promise<Blob>
  /** Blob → data URL；注入以便 node 测试用真实 Blob 的 arrayBuffer 生成。 */
  toDataUrl: (blob: Blob) => Promise<string>
  /** 用户取消 / 页面卸载时中止；每张前后都检查。 */
  signal?: AbortSignal
  /** 真实进度：`done` = 已经开始处理的张数（1 起），`total` = 待处理总张数。 */
  onProgress?: (done: number, total: number) => void
}

/** 失败原因分类（对外只给这些固定值，不带文件标识 / 错误原文 / 凭据）。 */
export type PortalPhotoFailureReason =
  | 'no-cloud-backup'
  | 'cloud-unavailable'
  | 'cloud-permission-denied'
  | 'cloud-not-found'
  | 'cloud-download-failed'
  | 'local-read-failed'
  | 'image-resize-failed'
  | 'invalid-image-bytes'
  | 'data-url-failed'

/**
 * 给教师看的失败文案：**界面不许直接显示英文枚举**（v3.9.1）。
 * 键是内部码（日志 / 测试用），值是能看懂的句子；不带文件标识与错误原文。
 */
export const PORTAL_PHOTO_FAILURE_LABELS: Readonly<Record<PortalPhotoFailureReason, string>> = {
  'no-cloud-backup': '本机和云端都没有这张照片',
  'cloud-unavailable': '未登录云端或云端不可用',
  'cloud-permission-denied': '云端拒绝访问（登录状态可能已失效）',
  'cloud-not-found': '云端找不到这张照片',
  'cloud-download-failed': '云端下载失败',
  'local-read-failed': '本机照片读取失败',
  'image-resize-failed': '图片压缩失败',
  'invalid-image-bytes': '图片内容无效',
  'data-url-failed': '图片编码失败',
}

/** 把内部失败原因拼成一句中文（按张数降序，最多列全部），供 toast 使用。 */
export function describePortalPhotoFailures(
  reasons: Partial<Record<PortalPhotoFailureReason, number>>,
): string {
  return Object.entries(reasons)
    .filter((entry): entry is [PortalPhotoFailureReason, number] => (entry[1] ?? 0) > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${PORTAL_PHOTO_FAILURE_LABELS[reason] ?? reason} ${count} 张`)
    .join('、')
}

export interface PortalPhotoStats {
  /** 有效照片元数据总数（去重后的候选数）。 */
  metadataCount: number
  /** 成功内联总数。 */
  embeddedCount: number
  /** 其中本机字节命中数。 */
  localCount: number
  /** 其中云端下载命中数。 */
  cloudCount: number
  /** 失败总数。 */
  failedCount: number
  /** 各失败原因的张数（没有失败时为空对象）。 */
  reasons: Partial<Record<PortalPhotoFailureReason, number>>
}

export interface CollectPortalPhotosResult {
  photos: InlinePhotoInput[]
  stats: PortalPhotoStats
}

/** 把 SDK / 服务端错误收敛成固定分类；绝不把原始 message 带出去（可能含 URL 或凭据）。 */
function reasonOfCloudError(error: unknown): PortalPhotoFailureReason {
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'permission-denied' || code === 'unavailable') return 'cloud-permission-denied'
  if (code === 'check-failed') return 'cloud-not-found'
  if (code === 'download-failed') return 'cloud-download-failed'
  return 'cloud-download-failed'
}

/** Blob 没带 image/* 类型时用元数据 MIME 标注；字节不变，不凭空造内容。 */
function withImageType(blob: Blob, fallbackMime: string | undefined): Blob {
  if (blob.type.toLowerCase().startsWith('image/')) return blob
  if (blob.size === 0) return blob
  const type = fallbackMime?.toLowerCase().startsWith('image/') ? fallbackMime : 'image/jpeg'
  return new Blob([blob], { type })
}

function addReason(stats: PortalPhotoStats, reason: PortalPhotoFailureReason): void {
  stats.failedCount += 1
  stats.reasons[reason] = (stats.reasons[reason] ?? 0) + 1
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('导出已取消', 'AbortError')
  }
}

/**
 * 顺序收集：本地 → 云端 → 统一缩放 → data URL。单张失败不影响其它照片。
 * 同一学生多张照片按「当前证件照 → 其它证件照 → 生活照」排序，与 v3.9.1 口径一致。
 *
 * 为什么顺序而不是并发：①64 张并发解码会让手机浏览器瞬时吃掉几百 MB；
 * ②顺序处理才能给出「第 x/y 张」的真实进度；③`prepare` 里的 Canvas 每次只活一张，用完即弃。
 */
export async function collectPortalPhotos(
  candidates: readonly PortalPhotoCandidate[],
  students: readonly PortalPhotoStudent[],
  ports: CollectPortalPhotosPorts,
): Promise<CollectPortalPhotosResult> {
  const activeNames = new Map(students.map((student) => [student.id, student.name]))
  const seen = new Set<string>()
  const ordered = [...candidates]
    .filter((photo) => activeNames.has(photo.studentId))
    .sort((a, b) => {
      const rank = (photo: PortalPhotoCandidate) =>
        photo.isCurrentIdPhoto ? 2 : photo.category === 'id-photo' ? 1 : 0
      return rank(b) - rank(a) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)
    })
    .filter((photo) => {
      if (seen.has(photo.id)) return false
      seen.add(photo.id)
      return true
    })

  const stats: PortalPhotoStats = {
    metadataCount: ordered.length,
    embeddedCount: 0,
    localCount: 0,
    cloudCount: 0,
    failedCount: 0,
    reasons: {},
  }
  const photos: InlinePhotoInput[] = []

  const total = ordered.length
  for (const [index, photo] of ordered.entries()) {
    throwIfAborted(ports.signal)
    // 真实进度：进入这一张就报「正在处理第 index+1 张」，不做定时动画。
    ports.onProgress?.(index + 1, total)
    let blob: Blob | null = null
    let source: 'local' | 'cloud' | null = null

    // ① 本地字节优先（只读，不触发下载 / 不写 IndexedDB）。
    try {
      blob = await ports.readLocal(photo.id)
      if (blob) source = 'local'
    } catch {
      // 本机读取异常不能判定为"没照片"：落到云端重试，最后才记失败。
      blob = null
    }
    throwIfAborted(ports.signal)

    // ② 本地没有 → 走现有 CloudBase 下载端口，只拿内存 Blob。
    if (!blob) {
      if (!photo.fileId) {
        addReason(stats, 'no-cloud-backup')
        continue
      }
      if (!ports.cloudAvailable()) {
        addReason(stats, 'cloud-unavailable')
        continue
      }
      try {
        blob = await ports.readCloud(photo.fileId)
      } catch (error) {
        addReason(stats, reasonOfCloudError(error))
        continue
      }
      if (!blob) {
        addReason(stats, 'cloud-download-failed')
        continue
      }
      source = 'cloud'
    }
    throwIfAborted(ports.signal)

    // ③ 统一出图：本地与云端字节走同一条缩放规则（最长边 ≤640）。
    //    失败只影响这一张，按 image-resize-failed 记账，不中断后面的照片。
    let prepared: Blob | null
    try {
      prepared = await ports.prepare(blob)
    } catch {
      blob = null
      addReason(stats, 'image-resize-failed')
      continue
    }
    blob = null
    if (!prepared) {
      addReason(stats, 'image-resize-failed')
      continue
    }
    throwIfAborted(ports.signal)

    // ④ 校验字节并转 data URL；一张完成即释放 blob 引用。
    const typed = withImageType(prepared, photo.mimeType)
    if (typed.size === 0 || !typed.type.toLowerCase().startsWith('image/')) {
      addReason(stats, 'invalid-image-bytes')
      prepared = null
      continue
    }
    let dataUrl: string
    try {
      dataUrl = await ports.toDataUrl(typed)
    } catch {
      addReason(stats, 'data-url-failed')
      prepared = null
      continue
    }
    prepared = null
    if (!dataUrl.startsWith('data:image/')) {
      addReason(stats, 'invalid-image-bytes')
      continue
    }

    photos.push({
      photoId: photo.id,
      studentId: photo.studentId,
      studentName: activeNames.get(photo.studentId) ?? photo.studentName,
      category: photo.category,
      dataUrl,
    })
    stats.embeddedCount += 1
    if (source === 'local') stats.localCount += 1
    else stats.cloudCount += 1
  }

  throwIfAborted(ports.signal)
  return { photos, stats }
}
