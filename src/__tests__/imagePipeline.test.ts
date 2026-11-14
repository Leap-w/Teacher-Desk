/**
 * 图片处理管线自检（Phase 1B）。
 *
 * node 环境没有 canvas，所以解码/编码走**注入的假环境**，但测的是真实管线编排：
 * 缩放尺寸、质量参数、透明背景铺底、宽高比、失败分类、HEIC 提示、重编码（非透传）。
 */
import { describe, expect, it } from 'vitest'

import { PHOTO_PROCESSING } from '@/config/photo'
import {
  computeTargetSize,
  createPhotoThumbnail,
  HEIC_CONVERSION_MESSAGE,
  isHeicPhotoFile,
  PhotoProcessingError,
  processPhotoFile,
  validatePhotoFile,
  type DecodedPhotoSource,
  type PhotoEncodeRequest,
  type PhotoImageEnvironment,
} from '@/services/imagePipeline'

function jpegOf(size = 1024): Blob {
  return new Blob([new Uint8Array(size)], { type: 'image/jpeg' })
}

interface FakeEnvOptions {
  width?: number
  height?: number
  decodeError?: Error
  encodeError?: Error
}

function createFakeEnvironment(options: FakeEnvOptions = {}) {
  const requests: PhotoEncodeRequest[] = []
  let decodeCalls = 0
  let closeCalls = 0
  let drawCalls = 0
  const env: PhotoImageEnvironment = {
    async decode(): Promise<DecodedPhotoSource> {
      decodeCalls += 1
      if (options.decodeError) throw options.decodeError
      return {
        width: options.width ?? 4000,
        height: options.height ?? 3000,
        draw() {
          drawCalls += 1
        },
        close() {
          closeCalls += 1
        },
      }
    },
    async encode(request) {
      requests.push(request)
      if (options.encodeError) throw options.encodeError
      // 真实编码器会把解码结果画进画布；这里也调一次，验证管线确实走"重绘 + 重编码"
      request.source.draw({} as CanvasRenderingContext2D, request.width, request.height)
      // 用尺寸造一个可区分的输出 Blob：证明返回的是编码产物，不是输入透传
      return new Blob([new Uint8Array(request.width + request.height)], {
        type: request.mimeType,
      })
    },
  }
  return {
    env,
    requests,
    get decodeCalls() {
      return decodeCalls
    },
    get closeCalls() {
      return closeCalls
    },
    get drawCalls() {
      return drawCalls
    },
  }
}

/* ==================== 文件校验 ==================== */

describe('文件校验与 HEIC 判断', () => {
  it('空文件 / 非图片被拒绝', () => {
    expect(validatePhotoFile({ type: 'image/jpeg', name: 'a.jpg', size: 0 })).toMatchObject({
      ok: false,
      code: 'empty-file',
    })
    expect(validatePhotoFile({ type: 'application/pdf', name: 'a.pdf', size: 100 })).toMatchObject({
      ok: false,
      code: 'not-an-image',
    })
  })

  it('常见图片格式通过（按 MIME 或扩展名）', () => {
    for (const [type, name] of [
      ['image/jpeg', 'a.jpg'],
      ['image/png', 'a.png'],
      ['image/webp', 'a.webp'],
      ['', 'photo.JPEG'],
    ] as const) {
      expect(validatePhotoFile({ type, name, size: 100 })).toEqual({ ok: true })
    }
  })

  it('HEIC 文件可被识别（不预判拒绝，先让解码器试）', () => {
    expect(isHeicPhotoFile({ type: 'image/heic', name: 'a.heic' })).toBe(true)
    expect(isHeicPhotoFile({ type: 'image/heif', name: 'a' })).toBe(true)
    expect(isHeicPhotoFile({ type: 'application/octet-stream', name: 'IMG_1.HEIC' })).toBe(true)
    expect(isHeicPhotoFile({ type: 'image/jpeg', name: 'a.jpg' })).toBe(false)
  })
})

/* ==================== 尺寸计算 ==================== */

describe('computeTargetSize：等比、不放大、不畸形', () => {
  it('横图 / 竖图按最长边缩放并保持比例', () => {
    expect(computeTargetSize(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 })
    expect(computeTargetSize(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 })
    expect(computeTargetSize(4000, 1000, 1600)).toEqual({ width: 1600, height: 400 })
  })

  it('已经小于上限的图不放大', () => {
    expect(computeTargetSize(800, 600, 1600)).toEqual({ width: 800, height: 600 })
    expect(computeTargetSize(320, 1000, 320)).toEqual({ width: 102, height: 320 })
  })

  it('正方形 / 极端比例 / 非法输入', () => {
    expect(computeTargetSize(4000, 4000, 1600)).toEqual({ width: 1600, height: 1600 })
    expect(computeTargetSize(10000, 1, 1600)).toEqual({ width: 1600, height: 1 })
    expect(computeTargetSize(0, 100, 1600)).toEqual({ width: 0, height: 0 })
    expect(computeTargetSize(Number.NaN, 100, 1600)).toEqual({ width: 0, height: 0 })
  })
})

/* ==================== 处理编排 ==================== */

describe('processPhotoFile：重编码、双输出、失败分类', () => {
  it('解码一次 → 编码原图与缩略图（尺寸 / 质量 / 背景都按配置）', async () => {
    const fake = createFakeEnvironment({ width: 4000, height: 3000 })
    const result = await processPhotoFile(jpegOf(2048), PHOTO_PROCESSING, fake.env)

    expect(fake.decodeCalls).toBe(1)
    expect(fake.closeCalls).toBe(1)
    expect(fake.requests).toHaveLength(2)

    const [fullRequest, thumbRequest] = fake.requests
    expect(fullRequest).toMatchObject({
      width: 1600,
      height: 1200,
      mimeType: 'image/jpeg',
      quality: 0.82,
      background: '#ffffff',
    })
    expect(thumbRequest).toMatchObject({
      width: 320,
      height: 240,
      mimeType: 'image/jpeg',
      quality: 0.75,
      background: '#ffffff',
    })
    expect(fake.drawCalls).toBe(2)

    // 返回的是编码产物（重编码 → EXIF/GPS 不会跟着走），不是输入文件透传
    expect(result.full).not.toBeInstanceOf(File)
    expect(result.width).toBe(1600)
    expect(result.height).toBe(1200)
    expect(result.mimeType).toBe('image/jpeg')
    expect(result.size).toBe(result.full.size)
    expect(result.thumb.size).toBeGreaterThan(0)
  })

  it('竖图方向正确（宽高互换但比例不变）', async () => {
    const fake = createFakeEnvironment({ width: 3000, height: 4000 })
    const result = await processPhotoFile(jpegOf(), PHOTO_PROCESSING, fake.env)
    expect(result.width).toBe(1200)
    expect(result.height).toBe(1600)
    expect(fake.requests[1]).toMatchObject({ width: 240, height: 320 })
  })

  it('PNG / WebP 等输入统一输出 JPEG（透明背景铺白，避免变黑）', async () => {
    const fake = createFakeEnvironment({ width: 800, height: 800 })
    const png = new Blob([new Uint8Array(100)], { type: 'image/png' })
    const result = await processPhotoFile(png, PHOTO_PROCESSING, fake.env)
    expect(result.mimeType).toBe('image/jpeg')
    expect(fake.requests.every((request) => request.background === '#ffffff')).toBe(true)
  })

  it('自定义配置生效（参数集中可调）', async () => {
    const fake = createFakeEnvironment({ width: 2000, height: 1000 })
    const options = { ...PHOTO_PROCESSING, fullMaxEdge: 800, fullQuality: 0.6, thumbMaxEdge: 200 }
    await processPhotoFile(jpegOf(), options, fake.env)
    expect(fake.requests[0]).toMatchObject({ width: 800, height: 400, quality: 0.6 })
    expect(fake.requests[1]).toMatchObject({ width: 200, height: 100 })
  })

  it('超大图片按最长边缩放（不抛内存错、不畸形）', async () => {
    const fake = createFakeEnvironment({ width: 12000, height: 9000 })
    const result = await processPhotoFile(jpegOf(), PHOTO_PROCESSING, fake.env)
    expect(result.width).toBe(1600)
    expect(result.height).toBe(1200)
  })

  it('解码失败 → code=decode-failed，且不进入编码', async () => {
    const fake = createFakeEnvironment({ decodeError: new Error('bad image') })
    await expect(processPhotoFile(jpegOf(), PHOTO_PROCESSING, fake.env)).rejects.toMatchObject({
      name: 'PhotoProcessingError',
      code: 'decode-failed',
    })
    expect(fake.requests).toHaveLength(0)
  })

  it('HEIC 解码失败 → code=unsupported-format，并提示先转换格式', async () => {
    const fake = createFakeEnvironment({ decodeError: new Error('heic not supported') })
    const heic = new Blob([new Uint8Array(100)], { type: 'image/heic' })
    const error = (await processPhotoFile(heic, PHOTO_PROCESSING, fake.env).catch(
      (caught: unknown) => caught,
    )) as PhotoProcessingError
    expect(error).toBeInstanceOf(PhotoProcessingError)
    expect(error.code).toBe('unsupported-format')
    expect(error.message).toBe(HEIC_CONVERSION_MESSAGE)
  })

  it('编码失败 → code=encode-failed（绝不把失败伪装成成功图片）', async () => {
    const fake = createFakeEnvironment({ encodeError: new Error('canvas exploded') })
    await expect(processPhotoFile(jpegOf(), PHOTO_PROCESSING, fake.env)).rejects.toMatchObject({
      code: 'encode-failed',
    })
    expect(fake.closeCalls).toBe(1)
  })

  it('环境不可用（编码器抛 environment-unavailable）原样上报', async () => {
    const fake = createFakeEnvironment({
      encodeError: new PhotoProcessingError('environment-unavailable', '当前环境不支持图片编码'),
    })
    await expect(processPhotoFile(jpegOf(), PHOTO_PROCESSING, fake.env)).rejects.toMatchObject({
      code: 'environment-unavailable',
    })
  })

  it('解码尺寸无效（0）→ decode-failed', async () => {
    const fake = createFakeEnvironment({ width: 0, height: 0 })
    await expect(processPhotoFile(jpegOf(), PHOTO_PROCESSING, fake.env)).rejects.toMatchObject({
      code: 'decode-failed',
    })
  })

  it('非图片文件在解码前就被拒绝', async () => {
    const fake = createFakeEnvironment()
    const pdf = new Blob([new Uint8Array(10)], { type: 'application/pdf' })
    await expect(processPhotoFile(pdf, PHOTO_PROCESSING, fake.env)).rejects.toMatchObject({
      code: 'not-an-image',
    })
    expect(fake.decodeCalls).toBe(0)
  })
})

/* ==================== 仅缩略图 ==================== */

describe('createPhotoThumbnail：从云端原图补齐本机缩略图', () => {
  it('只编码缩略图（不再压缩原图）', async () => {
    const fake = createFakeEnvironment({ width: 1600, height: 1200 })
    const thumb = await createPhotoThumbnail(jpegOf(), PHOTO_PROCESSING, fake.env)
    expect(fake.requests).toHaveLength(1)
    expect(fake.requests[0]).toMatchObject({ width: 320, height: 240, quality: 0.75 })
    expect(thumb.size).toBeGreaterThan(0)
    expect(fake.closeCalls).toBe(1)
  })
})
