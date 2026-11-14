/**
 * 图片处理管线（v3.8.0 · Phase 1B）。
 *
 * 统一做三件事：**解码 → 等比缩放 → 重编码**（原图 + 缩略图）。
 *
 * ## 关键点
 *
 * - **重编码而不是透传**：canvas 重编码会顺带剥掉 EXIF / GPS 等元数据（隐私要求），
 *   也保证输出格式统一、体积可控。因此输出 Blob 一定是编码器的产物，绝不是输入文件本身。
 * - **透明背景**：输出 JPEG 时先铺 `background`（默认白色），否则透明 PNG 的透明区会变黑。
 * - **HEIC**：不假装支持。`createImageBitmap` / `<img>` 解码失败时，若是 HEIC/HEIF，
 *   给出"请先转换为 JPEG/PNG"的明确提示。
 * - **可注入环境**：解码 / 编码全部走 `PhotoImageEnvironment`，node 测试可注入假环境，
 *   从而验证尺寸、质量、方向、比例、背景、失败路径（项目不引入 jsdom / canvas 依赖）。
 */
import { PHOTO_PROCESSING, type PhotoProcessingOptions } from '@/config/photo'

export type PhotoProcessingErrorCode =
  | 'not-an-image'
  | 'empty-file'
  | 'unsupported-format'
  | 'decode-failed'
  | 'encode-failed'
  | 'environment-unavailable'
  | 'invalid-source'

/** 图片处理错误（`code` 供上层分类提示；message 可直接展示） */
export class PhotoProcessingError extends Error {
  readonly code: PhotoProcessingErrorCode

  constructor(code: PhotoProcessingErrorCode, message: string) {
    super(message)
    this.name = 'PhotoProcessingError'
    this.code = code
  }
}

/** 解码后的图片源：只暴露尺寸 + 绘制能力（不把 DOM 类型泄漏到调用方） */
export interface DecodedPhotoSource {
  readonly width: number
  readonly height: number
  draw(
    context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    width: number,
    height: number,
  ): void
  /** 释放底层资源（ImageBitmap.close / objectURL revoke） */
  close?(): void
}

/** 一次编码请求（含尺寸与背景色，便于测试断言） */
export interface PhotoEncodeRequest {
  source: DecodedPhotoSource
  width: number
  height: number
  mimeType: string
  quality: number
  background: string
}

/** 图片处理环境（生产 = 浏览器 canvas；测试 = 假实现） */
export interface PhotoImageEnvironment {
  decode(file: Blob): Promise<DecodedPhotoSource>
  encode(request: PhotoEncodeRequest): Promise<Blob>
}

/** 处理结果（原图 + 缩略图 + 原图度量） */
export interface ProcessedPhoto {
  full: Blob
  thumb: Blob
  width: number
  height: number
  mimeType: string
  size: number
}

/* ========== 文件校验 ========== */

/** HEIC 解码失败时的统一提示（不假装支持） */
export const HEIC_CONVERSION_MESSAGE =
  '当前浏览器无法处理 HEIC/HEIF 格式的照片。请先在系统相册中转换为 JPEG 或 PNG，再重新上传。'

export type PhotoFileValidation =
  { ok: true } | { ok: false; code: PhotoProcessingErrorCode; message: string }

/** 是否为 HEIC/HEIF（按 MIME 或扩展名；不能只看 MIME，部分浏览器 type 为空） */
export function isHeicPhotoFile(file: { type?: string; name?: string }): boolean {
  const mime = (file.type ?? '').toLowerCase()
  if (mime === 'image/heic' || mime === 'image/heif') return true
  const name = (file.name ?? '').toLowerCase()
  return /\.(heic|heif)$/.test(name)
}

/**
 * 上传前的基础校验：空文件、明显不是图片的文件直接拒绝。
 * 这里**不预判 HEIC**——先让解码器试；失败时再给"请转换格式"的提示
 * （Safari 等环境确实能解码 HEIC，一刀切拒绝反而误伤）。
 */
export function validatePhotoFile(file: {
  type?: string
  name?: string
  size?: number
}): PhotoFileValidation {
  if (!file || typeof file.size !== 'number' || file.size <= 0) {
    return {
      ok: false,
      code: 'empty-file',
      message: '这个文件是空的或读不出来，请重新选择一张照片。',
    }
  }
  const mime = (file.type ?? '').toLowerCase()
  const name = (file.name ?? '').toLowerCase()
  const hasImageMime = mime.startsWith('image/')
  const hasImageExtension = /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif|tiff?)$/.test(name)
  if (!hasImageMime && !hasImageExtension) {
    return {
      ok: false,
      code: 'not-an-image',
      message: '请选择图片文件（支持 JPEG / PNG / WebP 等常见图片格式）。',
    }
  }
  return { ok: true }
}

/* ========== 尺寸计算 ========== */

/**
 * 等比缩放到最长边不超过 `maxEdge`（**不放大**，不改变宽高比）。
 * 返回整数像素；极端输入返回 1px 兜底（由后续编码器给出真实结果）。
 */
export function computeTargetSize(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const safeWidth = Number.isFinite(width) && width > 0 ? Math.round(width) : 0
  const safeHeight = Number.isFinite(height) && height > 0 ? Math.round(height) : 0
  if (safeWidth <= 0 || safeHeight <= 0) return { width: 0, height: 0 }
  const limit = Number.isFinite(maxEdge) && maxEdge > 0 ? Math.round(maxEdge) : 0
  if (limit <= 0) return { width: safeWidth, height: safeHeight }
  const longEdge = Math.max(safeWidth, safeHeight)
  if (longEdge <= limit) return { width: safeWidth, height: safeHeight }
  const scale = limit / longEdge
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  }
}

/* ========== 浏览器实现 ========== */

function environmentUnavailable(message: string): PhotoProcessingError {
  return new PhotoProcessingError('environment-unavailable', message)
}

function toProcessingError(
  code: PhotoProcessingErrorCode,
  fallbackMessage: string,
  error: unknown,
): PhotoProcessingError {
  if (error instanceof PhotoProcessingError) return error
  const detail = error instanceof Error && error.message ? `（${error.message}）` : ''
  return new PhotoProcessingError(code, `${fallbackMessage}${detail}`)
}

function decodeWithImageElement(file: Blob): Promise<DecodedPhotoSource> {
  return new Promise<DecodedPhotoSource>((resolve, reject) => {
    if (typeof document === 'undefined' || typeof URL === 'undefined') {
      reject(environmentUnavailable('当前环境不支持图片解码'))
      return
    }
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      resolve({
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
        draw(context, width, height) {
          context.drawImage(image, 0, 0, width, height)
        },
        close() {
          URL.revokeObjectURL(objectUrl)
        },
      })
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(
        new PhotoProcessingError('decode-failed', '图片解码失败，文件可能已损坏或格式不受支持。'),
      )
    }
    image.src = objectUrl
  })
}

async function decodePhotoBlob(file: Blob): Promise<DecodedPhotoSource> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file)
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw(context, width, height) {
        context.drawImage(bitmap, 0, 0, width, height)
      },
      close() {
        bitmap.close()
      },
    }
  }
  return decodeWithImageElement(file)
}

function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas | null {
  if (typeof OffscreenCanvas === 'function') {
    try {
      return new OffscreenCanvas(width, height)
    } catch {
      // 某些环境声明了构造器却不让用，落到 DOM canvas
    }
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
  }
  return null
}

async function canvasToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  mimeType: string,
  quality: number,
): Promise<Blob | null> {
  if ('convertToBlob' in canvas && typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: mimeType, quality })
  }
  return new Promise<Blob | null>((resolve) => {
    ;(canvas as HTMLCanvasElement).toBlob((blob) => resolve(blob), mimeType, quality)
  })
}

async function encodeWithCanvas(request: PhotoEncodeRequest): Promise<Blob> {
  if (!(request.width > 0) || !(request.height > 0)) {
    throw new PhotoProcessingError('encode-failed', '图片尺寸无效，无法生成照片文件。')
  }
  const canvas = createCanvas(request.width, request.height)
  if (!canvas) {
    throw environmentUnavailable('当前环境不支持图片编码（缺少 Canvas）')
  }
  const context = canvas.getContext('2d') as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!context) {
    throw environmentUnavailable('当前环境不支持图片编码（无法取得画布上下文）')
  }
  // 先铺背景色：透明 PNG 转 JPEG 时，透明区不铺底会变成黑色
  context.fillStyle = request.background
  context.fillRect(0, 0, request.width, request.height)
  request.source.draw(context, request.width, request.height)
  const blob = await canvasToBlob(canvas, request.mimeType, request.quality)
  if (!blob) {
    throw new PhotoProcessingError('encode-failed', '图片编码失败，请重试或换一张照片。')
  }
  return blob
}

/** 生产环境实现（浏览器 canvas；重编码顺带剥离 EXIF/GPS） */
export const browserPhotoEnvironment: PhotoImageEnvironment = {
  decode: decodePhotoBlob,
  encode: encodeWithCanvas,
}

/* ========== 处理入口 ========== */

async function decodeOrThrow(
  file: Blob,
  environment: PhotoImageEnvironment,
): Promise<DecodedPhotoSource> {
  try {
    const source = await environment.decode(file)
    if (!(source.width > 0) || !(source.height > 0)) {
      source.close?.()
      throw new PhotoProcessingError('decode-failed', '图片尺寸无效，文件可能已损坏。')
    }
    return source
  } catch (error) {
    // 环境不支持解码（无 canvas / 无 Image）与服务端错误的分类不同，原样上报
    if (error instanceof PhotoProcessingError && error.code === 'environment-unavailable') {
      throw error
    }
    if (isHeicPhotoFile(file)) {
      throw new PhotoProcessingError('unsupported-format', HEIC_CONVERSION_MESSAGE)
    }
    throw toProcessingError('decode-failed', '图片解码失败，文件可能已损坏或格式不受支持。', error)
  }
}

/**
 * 处理一张照片：解码一次 → 编码原图（长边 ≤1600 / q0.82）→ 编码缩略图（长边 ≤320 / q0.75）。
 * 任何一步失败都抛 `PhotoProcessingError`，**绝不把失败伪装成成功图片**。
 */
export async function processPhotoFile(
  file: Blob,
  options: Readonly<PhotoProcessingOptions> = PHOTO_PROCESSING,
  environment: PhotoImageEnvironment = browserPhotoEnvironment,
): Promise<ProcessedPhoto> {
  const validation = validatePhotoFile(file as Blob & { name?: string })
  if (!validation.ok) throw new PhotoProcessingError(validation.code, validation.message)

  const source = await decodeOrThrow(file, environment)
  try {
    const fullSize = computeTargetSize(source.width, source.height, options.fullMaxEdge)
    let full: Blob
    try {
      full = await environment.encode({
        source,
        width: fullSize.width,
        height: fullSize.height,
        mimeType: options.outputMimeType,
        quality: options.fullQuality,
        background: options.background,
      })
    } catch (error) {
      throw toProcessingError('encode-failed', '图片处理失败，请重试或换一张照片。', error)
    }

    const thumbSize = computeTargetSize(source.width, source.height, options.thumbMaxEdge)
    let thumb: Blob
    try {
      thumb = await environment.encode({
        source,
        width: thumbSize.width,
        height: thumbSize.height,
        mimeType: options.outputMimeType,
        quality: options.thumbQuality,
        background: options.background,
      })
    } catch (error) {
      throw toProcessingError('encode-failed', '缩略图生成失败，请重试或换一张照片。', error)
    }

    return {
      full,
      thumb,
      width: fullSize.width,
      height: fullSize.height,
      mimeType: options.outputMimeType,
      size: full.size,
    }
  } finally {
    source.close?.()
  }
}

/**
 * 只生成缩略图（从云端下载回来的原图已经在 1600px 以内，不需要再次压缩原图）。
 * 用于「另一台设备只有云端文件」时补齐本地缩略图。
 */
export async function createPhotoThumbnail(
  fullImage: Blob,
  options: Readonly<PhotoProcessingOptions> = PHOTO_PROCESSING,
  environment: PhotoImageEnvironment = browserPhotoEnvironment,
): Promise<Blob> {
  const source = await decodeOrThrow(fullImage, environment)
  try {
    const thumbSize = computeTargetSize(source.width, source.height, options.thumbMaxEdge)
    try {
      return await environment.encode({
        source,
        width: thumbSize.width,
        height: thumbSize.height,
        mimeType: options.outputMimeType,
        quality: options.thumbQuality,
        background: options.background,
      })
    } catch (error) {
      throw toProcessingError('encode-failed', '缩略图生成失败，请重试。', error)
    }
  } finally {
    source.close?.()
  }
}

/* ========== 运行时注册表（测试可替换） ========== */

export type PhotoProcessor = (
  file: Blob,
  options?: Readonly<PhotoProcessingOptions>,
  environment?: PhotoImageEnvironment,
) => Promise<ProcessedPhoto>

export type PhotoThumbnailGenerator = (
  image: Blob,
  options?: Readonly<PhotoProcessingOptions>,
  environment?: PhotoImageEnvironment,
) => Promise<Blob>

let activeProcessor: PhotoProcessor = processPhotoFile
let activeThumbnailer: PhotoThumbnailGenerator = createPhotoThumbnail

/** 取当前图片处理器（生产 = `processPhotoFile`；测试可替换） */
export function getPhotoProcessor(): PhotoProcessor {
  return activeProcessor
}

/** 取当前缩略图生成器 */
export function getPhotoThumbnailGenerator(): PhotoThumbnailGenerator {
  return activeThumbnailer
}

/**
 * **仅测试用**：替换图片处理器 / 缩略图生成器（node 环境没有 canvas）。
 * 传 `null` 恢复生产实现。
 */
export function setPhotoProcessorForTesting(
  processor: PhotoProcessor | null,
  thumbnailer: PhotoThumbnailGenerator | null = null,
): void {
  activeProcessor = processor ?? processPhotoFile
  activeThumbnailer = thumbnailer ?? createPhotoThumbnail
}
