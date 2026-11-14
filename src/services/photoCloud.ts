/**
 * 照片云端通道（v3.8.0 · Phase 1B）。
 *
 * ## 职责边界
 *
 * 只做「照片文件」的四件事：**上传 / 签发临时 URL / 下载 / 存在性判断**。
 * 不碰元数据、不碰同步（元数据由 `stores/studentPhoto.ts` + 现有同步机制负责），
 * 也**不做云端物理删除**——本阶段逻辑删除，云端文件保留（没有跨设备删除确认机制）。
 *
 * ## 私有存储
 *
 * 使用传统模式 `app.storage.from()`（CloudBase 桶为私有：仅创建者与管理员可读写），
 * 读取统一走 `createSignedUrl(fileID, 3600)`；**签名 URL 只在运行时使用**，
 * 绝不持久化、绝不写日志、绝不进入元数据 / JSON 备份。
 *
 * ## 可注入
 *
 * `createCloudbasePhotoCloud({ fileApi, isReady, isConfigured })` 允许测试注入假文件端口，
 * 从而验证上传/下载/签名/权限错误/断网等分支，而不用连真实云端。
 */
import { PHOTO_SIGNED_URL_EXPIRES_IN } from '@/config/photo'
import { getCloudFileApi, isCloudConfigured, type CloudFileApi } from '@/services/cloudbase'
import { isCloudReady } from '@/services/cloudSync'

export type PhotoCloudErrorCode =
  | 'unavailable'
  | 'permission-denied'
  | 'upload-failed'
  | 'download-failed'
  | 'signed-url-failed'
  | 'check-failed'

/** 照片云端错误（`code` 供上层分类提示；message 可直接展示，不含签名 URL） */
export class PhotoCloudError extends Error {
  readonly code: PhotoCloudErrorCode

  constructor(code: PhotoCloudErrorCode, message: string) {
    super(message)
    this.name = 'PhotoCloudError'
    this.code = code
  }
}

/** 照片云端端口 */
export interface PhotoCloudPort {
  /**
   * 当前是否**具备上传条件**：环境已配置 + 已登录（现有会话检查）。
   * 注意：它不代表某张照片已经在云端——那要看元数据里的 `fileId`。
   */
  isAvailable(): boolean
  /** 上传照片，返回 CloudBase fileID */
  upload(storagePath: string, content: Blob, mimeType: string): Promise<{ fileId: string }>
  /** 签发临时访问地址（≤1 小时，调用方不得持久化） */
  createSignedUrl(fileId: string): Promise<string>
  /** 下载云端照片内容 */
  download(fileId: string): Promise<Blob>
  /** 云端文件是否仍可访问 */
  exists(fileId: string): Promise<boolean>
}

export interface CloudbasePhotoCloudOptions {
  /** 注入文件端口（测试用）；缺省 = `services/cloudbase.ts` 的 `getCloudFileApi()` */
  fileApi?: CloudFileApi
  /** 注入「是否已登录就绪」（测试用）；缺省 = `cloudSync.isCloudReady` */
  isReady?: () => boolean
  /** 注入「环境是否配置」（测试用）；缺省 = `cloudbase.isCloudConfigured` */
  isConfigured?: () => boolean
}

function sanitizeErrorDetail(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  const withoutUrl = raw.replace(/https?:\/\/\S+/gi, '[url]')
  return withoutUrl.length > 160 ? `${withoutUrl.slice(0, 160)}…` : withoutUrl
}

function isPermissionError(error: unknown): boolean {
  const code =
    (error as { code?: unknown } | null)?.code ??
    (error as { errorCode?: unknown } | null)?.errorCode
  const text = `${String(code ?? '')} ${sanitizeErrorDetail(error)}`
  return /permission|denied|forbidden|unauthor|STORAGE_EXCEED_AUTHORITY|AUTH|403/i.test(text)
}

function isNotFoundError(error: unknown): boolean {
  const text = sanitizeErrorDetail(error)
  return /not\s*exist|nonexist|not\s*found|no\s*such|不存在|404/i.test(text)
}

function mapCloudError(
  fallbackCode: PhotoCloudErrorCode,
  fallbackMessage: string,
  error: unknown,
): PhotoCloudError {
  if (error instanceof PhotoCloudError) return error
  if (isPermissionError(error)) {
    return new PhotoCloudError(
      'permission-denied',
      `${fallbackMessage}：云端拒绝了这次访问（权限不足，或登录状态已失效）。`,
    )
  }
  if (isNotFoundError(error)) {
    return new PhotoCloudError('check-failed', `${fallbackMessage}：云端找不到这个照片文件。`)
  }
  const detail = sanitizeErrorDetail(error)
  return new PhotoCloudError(
    fallbackCode,
    detail ? `${fallbackMessage}：${detail}` : fallbackMessage,
  )
}

/**
 * 生产实现（传统模式云存储）。
 * 上传 / 下载 / 签名全部经由 `cloudbase.ts`（全应用唯一 import SDK 的地方）。
 */
export function createCloudbasePhotoCloud(
  options: CloudbasePhotoCloudOptions = {},
): PhotoCloudPort {
  const fileApi = (): CloudFileApi => options.fileApi ?? getCloudFileApi()
  const configured = options.isConfigured ?? isCloudConfigured
  const ready = options.isReady ?? isCloudReady

  return {
    isAvailable() {
      try {
        return configured() && ready()
      } catch {
        // 探测会话本身抛错（断网 / SDK 异常）时按「不可用」处理，上传队列留到下次
        return false
      }
    },

    async upload(storagePath, content, mimeType) {
      if (!configured()) {
        throw new PhotoCloudError('unavailable', '没有配置云环境，照片先保存在本机。')
      }
      if (!ready()) {
        throw new PhotoCloudError('unavailable', '还没有登录云端，照片先保存在本机。')
      }
      try {
        return await fileApi().upload(storagePath, content, mimeType)
      } catch (error) {
        throw mapCloudError('upload-failed', '上传照片到云端失败', error)
      }
    },

    async createSignedUrl(fileId) {
      try {
        return await fileApi().createSignedUrl(fileId, PHOTO_SIGNED_URL_EXPIRES_IN)
      } catch (error) {
        throw mapCloudError('signed-url-failed', '获取照片访问地址失败', error)
      }
    },

    async download(fileId) {
      try {
        return await fileApi().download(fileId)
      } catch (error) {
        throw mapCloudError('download-failed', '下载云端照片失败', error)
      }
    },

    async exists(fileId) {
      try {
        return await fileApi().exists(fileId)
      } catch (error) {
        throw mapCloudError('check-failed', '检查云端照片失败', error)
      }
    },
  }
}

/** 生产默认实现 */
export const cloudbasePhotoCloud: PhotoCloudPort = createCloudbasePhotoCloud()

/** 运行时活动端口（测试可整体替换；与 `mediaStore` 同一注册表手法） */
let activePhotoCloud: PhotoCloudPort | null = null

export function setPhotoCloud(port: PhotoCloudPort | null): void {
  activePhotoCloud = port
}

export function getPhotoCloud(): PhotoCloudPort {
  return activePhotoCloud ?? cloudbasePhotoCloud
}
