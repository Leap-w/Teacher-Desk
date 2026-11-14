/**
 * 照片数据层自检替身（Phase 1B）。
 *
 * 照片 Store 的三个外部依赖都走运行时注册表，所以在 node 测试里可以整体替换：
 * - 本地媒体库（IndexedDB）→ 内存 `MediaStorePort`（可注入写入/读取失败）；
 * - 图片处理（canvas）→ 假处理器（记录调用、可注入失败）；
 * - 云端文件通道 → 假 `PhotoCloudPort`（记录上传/签名请求、可注入失败、可切"在线/离线"）。
 *
 * 这样测的是 **Store 的真实编排**（先本地后元数据、失败补偿、状态派生、逻辑删除、补传），
 * 而不是只断言"某个函数被调用"。
 */
import {
  MediaStoreError,
  setMediaStore,
  type MediaBinaryBundle,
  type MediaStorePort,
} from '@/services/mediaStore'
import {
  setPhotoProcessorForTesting,
  type PhotoThumbnailGenerator,
  type ProcessedPhoto,
  type PhotoProcessor,
} from '@/services/imagePipeline'
import { PhotoCloudError, setPhotoCloud, type PhotoCloudPort } from '@/services/photoCloud'

/* ==================== 内存媒体库 ==================== */

export interface MemoryMediaStore extends MediaStorePort {
  readonly files: Map<string, MediaBinaryBundle>
  readonly removedIds: string[]
  /** 下一次 `save` 抛这个错误（抛完自动清空） */
  failNextSave?: MediaStoreError
  /** 所有读取都失败（模拟 IndexedDB 读取异常） */
  failReads: boolean
  /** `listIds` 失败（模拟库不可用） */
  failList: boolean
}

export function createMemoryMediaStore(): MemoryMediaStore {
  const files = new Map<string, MediaBinaryBundle>()
  const removedIds: string[] = []
  const store: MemoryMediaStore = {
    files,
    removedIds,
    failNextSave: undefined,
    failReads: false,
    failList: false,

    async save(photoId, media) {
      if (store.failNextSave) {
        const error = store.failNextSave
        store.failNextSave = undefined
        throw error
      }
      files.set(photoId, media)
    },
    async readFull(photoId) {
      if (store.failReads) throw new MediaStoreError('read-failed', '模拟读取失败')
      return files.get(photoId)?.full
    },
    async readThumb(photoId) {
      if (store.failReads) throw new MediaStoreError('read-failed', '模拟读取失败')
      return files.get(photoId)?.thumb
    },
    async remove(photoId) {
      removedIds.push(photoId)
      files.delete(photoId)
    },
    async listIds() {
      if (store.failList) throw new MediaStoreError('unavailable', '模拟照片库不可用')
      return [...files.keys()]
    },
  }
  return store
}

/* ==================== 假图片处理器 ==================== */

export interface FakeImageOptions {
  width?: number
  height?: number
  fullBytes?: number
  thumbBytes?: number
  /** 处理直接失败（模拟解码失败 / HEIC / 环境不支持） */
  failWith?: Error
  /** 缩略图生成失败 */
  failThumbnailWith?: Error
}

export interface FakeImageDoubles {
  processor: PhotoProcessor
  thumbnailer: PhotoThumbnailGenerator
  /** 处理器被调用的次数（每次记录输入字节数） */
  processedInputs: number[]
  thumbnailInputs: number[]
}

function bytesBlob(bytes: number, type = 'image/jpeg'): Blob {
  return new Blob([new Uint8Array(bytes)], { type })
}

export function createFakeImageDoubles(options: FakeImageOptions = {}): FakeImageDoubles {
  const processedInputs: number[] = []
  const thumbnailInputs: number[] = []
  const width = options.width ?? 1600
  const height = options.height ?? 1200
  const fullBytes = options.fullBytes ?? 1024
  const thumbBytes = options.thumbBytes ?? 128

  const processor: PhotoProcessor = async (file: Blob): Promise<ProcessedPhoto> => {
    processedInputs.push(file.size)
    if (options.failWith) throw options.failWith
    const full = bytesBlob(fullBytes)
    return {
      full,
      thumb: bytesBlob(thumbBytes),
      width,
      height,
      mimeType: 'image/jpeg',
      size: full.size,
    }
  }

  const thumbnailer: PhotoThumbnailGenerator = async (image: Blob): Promise<Blob> => {
    thumbnailInputs.push(image.size)
    if (options.failThumbnailWith) throw options.failThumbnailWith
    return bytesBlob(thumbBytes)
  }

  return { processor, thumbnailer, processedInputs, thumbnailInputs }
}

/* ==================== 假云端通道 ==================== */

export interface FakePhotoCloud extends PhotoCloudPort {
  readonly uploads: { storagePath: string; mimeType: string; size: number }[]
  readonly signedUrlRequests: string[]
  readonly downloadRequests: string[]
  readonly files: Map<string, Blob>
  setAvailable(available: boolean): void
  failNextUpload?: Error
  failNextDownload?: Error
  failNextSignedUrl?: Error
  failExists?: boolean
}

export function createFakePhotoCloud(options: { available?: boolean } = {}): FakePhotoCloud {
  let available = options.available ?? true
  let signedUrlSeq = 0
  const uploads: { storagePath: string; mimeType: string; size: number }[] = []
  const signedUrlRequests: string[] = []
  const downloadRequests: string[] = []
  const files = new Map<string, Blob>()

  const cloud: FakePhotoCloud = {
    uploads,
    signedUrlRequests,
    downloadRequests,
    files,
    failNextUpload: undefined,
    failNextDownload: undefined,
    failNextSignedUrl: undefined,
    failExists: false,

    setAvailable(next) {
      available = next
    },
    isAvailable() {
      return available
    },
    async upload(storagePath, content, mimeType) {
      if (cloud.failNextUpload) {
        const error = cloud.failNextUpload
        cloud.failNextUpload = undefined
        throw error
      }
      uploads.push({ storagePath, mimeType, size: content.size })
      const fileId = `cloud://fake-env/${storagePath}`
      files.set(fileId, content)
      return { fileId }
    },
    async createSignedUrl(fileId) {
      if (cloud.failNextSignedUrl) {
        const error = cloud.failNextSignedUrl
        cloud.failNextSignedUrl = undefined
        throw error
      }
      signedUrlRequests.push(fileId)
      signedUrlSeq += 1
      // 每次都签发**新** URL：验证「过期后重新获取」而不是缓存旧地址
      return `https://signed.example.test/${encodeURIComponent(fileId)}?sign=${signedUrlSeq}`
    },
    async download(fileId) {
      if (cloud.failNextDownload) {
        const error = cloud.failNextDownload
        cloud.failNextDownload = undefined
        throw error
      }
      downloadRequests.push(fileId)
      const blob = files.get(fileId)
      if (!blob) throw new PhotoCloudError('download-failed', '云端找不到这个照片文件。')
      return blob
    },
    async exists(fileId) {
      if (cloud.failExists) throw new PhotoCloudError('check-failed', '检查云端照片失败')
      return files.has(fileId)
    },
  }
  return cloud
}

/* ==================== 安装 / 复位 ==================== */

export interface PhotoTestDoubles {
  media: MemoryMediaStore
  image: FakeImageDoubles
  cloud: FakePhotoCloud
}

export interface InstallPhotoDoublesOptions {
  image?: FakeImageOptions
  cloud?: { available?: boolean }
}

/** 装上三套替身（**在创建照片 Store 之前**调用） */
export function installPhotoTestDoubles(
  options: InstallPhotoDoublesOptions = {},
): PhotoTestDoubles {
  const media = createMemoryMediaStore()
  const image = createFakeImageDoubles(options.image)
  const cloud = createFakePhotoCloud(options.cloud)
  setMediaStore(media)
  setPhotoProcessorForTesting(image.processor, image.thumbnailer)
  setPhotoCloud(cloud)
  return { media, image, cloud }
}

/** 复位成生产实现（每个用例结束后调用，测试之间不串味） */
export function resetPhotoTestDoubles(): void {
  setMediaStore(null)
  setPhotoProcessorForTesting(null)
  setPhotoCloud(null)
}
