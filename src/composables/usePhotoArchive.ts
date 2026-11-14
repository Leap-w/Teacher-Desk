/**
 * 照片完整备份的界面接线（v3.8.1 · Phase 1）。
 *
 * 纯逻辑与校验在 `utils/photoArchive.ts`（不碰浏览器），这里只做「生产依赖的组装」：
 * - 元数据：`useStudentPhotoStore()` 的 `photos`（**复用现有照片 Store，不另建数据源**）；
 * - 二进制：本机 `mediaStore`（IndexedDB）优先；本机没有且云端可用时，才走既有 `photoCloud`
 *   下载（与查看大图完全同一条链路，不新造协议）；
 * - 合并写盘：复用 `utils/backup.ts` 的 `planMerge` / `applyWrites`（与 JSON 导入同一套）；
 * - 缩略图：复用图片管线的 `getPhotoThumbnailGenerator()`（与上传同一条链路）。
 *
 * **不改动照片云端同步协议**：上传 / 下载 / 签名都还是 `photoCloud` 那一套；
 * 本模块只把已有能力组合成「导出 / 恢复一个 ZIP」。
 */
import { useBackup } from '@/composables/useBackup'
import { getMediaStore } from '@/services/mediaStore'
import { getPhotoCloud } from '@/services/photoCloud'
import { getPhotoThumbnailGenerator } from '@/services/imagePipeline'
import { useStudentPhotoStore } from '@/stores/studentPhoto'
import { appConfig } from '@/config'
import { createBackup } from '@/utils/backup'
import {
  buildPhotoArchive,
  downloadPhotoArchive,
  photoArchiveFileName,
  parsePhotoArchive,
  restorePhotoArchive,
  type PhotoArchiveBuildResult,
  type PhotoArchiveContents,
  type PhotoArchiveParseResult,
  type PhotoArchiveRestoreResult,
  type PhotoBinaryResolution,
} from '@/utils/photoArchive'

export type PhotoArchiveExportResult =
  { ok: true; result: PhotoArchiveBuildResult; filename: string } | { ok: false; error: string }

function errorMessageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export function usePhotoArchive() {
  const photoStore = useStudentPhotoStore()
  const storage = useBackup()

  /**
   * 取一张照片的二进制（导出用）：
   * 1. 本机 IndexedDB 有 → 直接用；
   * 2. 本机没有、元数据有 `fileId`，且云端已登录/已配置 → 尝试下载（**合法认证机制可用才尝试**）；
   * 3. 其余情况如实分类为缺失 / 云端不可用 / 下载失败，绝不伪造。
   */
  async function resolvePhotoBinary(photo: {
    id: string
    fileId?: string
  }): Promise<PhotoBinaryResolution> {
    try {
      const local = await getMediaStore().readFull(photo.id)
      if (local) return { ok: true, blob: local }
    } catch (error) {
      return {
        ok: false,
        status: 'download-failed',
        reason: `读取本机照片失败：${errorMessageOf(error, '未知原因')}`,
      }
    }

    if (!photo.fileId) {
      return {
        ok: false,
        status: 'missing-local',
        reason: '本机与云端都没有这张照片的文件。',
      }
    }

    const cloud = getPhotoCloud()
    let available = false
    try {
      available = cloud.isAvailable()
    } catch {
      available = false
    }
    if (!available) {
      return {
        ok: false,
        status: 'remote-unavailable',
        reason: '照片只在云端，当前未登录或未配置云端，本次未尝试下载。',
      }
    }

    try {
      const blob = await cloud.download(photo.fileId)
      return { ok: true, blob }
    } catch (error) {
      return {
        ok: false,
        status: 'download-failed',
        reason: `从云端下载失败：${errorMessageOf(error, '未知原因')}`,
      }
    }
  }

  /** 生成完整备份 ZIP（不触发下载；下载由页面决定，便于如实提示失败） */
  async function exportFullBackup(): Promise<PhotoArchiveExportResult> {
    const now = new Date()
    try {
      const jsonBackup = createBackup((key) => storage.read(key), now).backup
      const result = await buildPhotoArchive({
        backupJson: JSON.stringify(jsonBackup, null, 2),
        appVersion: appConfig.version,
        exportedAt: now.toISOString(),
        photos: photoStore.photos,
        resolveBinary: (photo) => resolvePhotoBinary(photo),
      })
      return { ok: true, result, filename: photoArchiveFileName(now) }
    } catch (error) {
      return { ok: false, error: errorMessageOf(error, '生成完整备份失败') }
    }
  }

  /** 解析并校验一份完整备份（浏览器侧读 ArrayBuffer） */
  async function parseArchiveFile(file: Blob): Promise<PhotoArchiveParseResult> {
    try {
      return parsePhotoArchive(await file.arrayBuffer())
    } catch (error) {
      return { ok: false, error: errorMessageOf(error, '读取 ZIP 失败') }
    }
  }

  /**
   * 写回完整备份：先照片、后业务数据；失败时**原样还原被覆盖的原图 / 缩略图**，
   * 并清理本次新建的照片文件。业务数据的合并结果由页面先用 `planMerge` 算好并展示预览
   * （与 JSON 导入同一口径）。
   */
  async function restoreFullBackup(
    contents: PhotoArchiveContents,
    writes: Record<string, string>,
    onProgress?: (done: number, total: number) => void,
  ): Promise<PhotoArchiveRestoreResult> {
    const media = getMediaStore()
    const outcome = await restorePhotoArchive(contents, {
      storage,
      writes,
      onProgress,
      /**
       * 覆盖写入前先留快照：同 photoId 的原图 + 缩略图必须能原样写回。
       * 原图在、缩略图缺（历史脏数据）时现场补一张，保证回滚后仍是一份完整媒体。
       */
      readPhotoSnapshot: async (photoId) => {
        const full = await media.readFull(photoId)
        if (!full) return null
        const thumb = await media.readThumb(photoId)
        if (thumb) return { full, thumb }
        return { full, thumb: await getPhotoThumbnailGenerator()(full) }
      },
      savePhoto: async (photoId, blob) => {
        const thumb = await getPhotoThumbnailGenerator()(blob)
        await media.save(photoId, { full: blob, thumb })
      },
      restorePhotoSnapshot: async (photoId, snapshot) => {
        await media.save(photoId, { full: snapshot.full, thumb: snapshot.thumb })
      },
      removePhoto: async (photoId) => {
        await media.remove(photoId)
      },
    })
    // 不论成功失败，都按本机媒体实际存在性重算 Store 的本地集合：
    // 成功时页面随后整页重载；失败时（弹窗仍开着）也能立刻显示回滚后的真实状态，
    // 不会残留「照片缺失 / 仅云端」这类基于旧集合的假状态。
    await photoStore.refreshLocalPresence()
    return outcome
  }

  /** 页面用：触发下载（返回 false 时页面必须提示失败，不能假装导出成功） */
  function download(result: PhotoArchiveBuildResult, filename: string): boolean {
    return downloadPhotoArchive(result.blob, filename)
  }

  return {
    exportFullBackup,
    parseArchiveFile,
    restoreFullBackup,
    download,
  }
}
