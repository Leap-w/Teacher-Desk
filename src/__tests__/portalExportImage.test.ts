/**
 * 导出照片的尺寸规则（v3.9.1）。
 *
 * 规则本身很短，但必须锁住三件事，否则很容易在后续改动里破功：
 * ① 最长边 640、质量 0.8 是**唯一来源**（config/photo.ts），不在别处再写死一份数字；
 * ② 等比缩放、**不放大**（小于 640 的原图保持原样）；
 * ③ 本地与云端照片由**同一个 prepare 端口**处理，不会出现「本机读缩略图、云端读原图」两条路。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import { describe, expect, it } from 'vitest'

import { computeTargetSize } from '@/services/imagePipeline'
import { EXPORT_PHOTO_MAX_EDGE, EXPORT_PHOTO_QUALITY } from '@/config/photo'

describe('导出照片 · 尺寸规则', () => {
  it('统一规格：最长边 640、JPEG 质量 0.8', () => {
    expect(EXPORT_PHOTO_MAX_EDGE).toBe(640)
    expect(EXPORT_PHOTO_QUALITY).toBeCloseTo(0.8, 5)
  })

  it('等比缩放到最长边 640（横图 / 竖图都按长边算）', () => {
    expect(computeTargetSize(1600, 1200, EXPORT_PHOTO_MAX_EDGE)).toEqual({
      width: 640,
      height: 480,
    })
    expect(computeTargetSize(1200, 1600, EXPORT_PHOTO_MAX_EDGE)).toEqual({
      width: 480,
      height: 640,
    })
    expect(computeTargetSize(2400, 3200, EXPORT_PHOTO_MAX_EDGE)).toEqual({
      width: 480,
      height: 640,
    })
  })

  it('小于 640 的原图不放大（320px 本地缩略图仍是 320px，但不会被糊化）', () => {
    expect(computeTargetSize(320, 240, EXPORT_PHOTO_MAX_EDGE)).toEqual({ width: 320, height: 240 })
    expect(computeTargetSize(640, 640, EXPORT_PHOTO_MAX_EDGE)).toEqual({ width: 640, height: 640 })
  })
})

/** 源码级断言先剥注释：注释里提到关键词会误伤。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function readRepoFile(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8')
}

describe('导出照片 · 实现纪律（源码级）', () => {
  const code = stripComments(readRepoFile('src/composables/usePortalExport.ts'))

  it('本地与云端共用同一个 prepare 端口，尺寸来自 config，不在页面里写死数字', () => {
    expect(code).toContain('prepare: prepareExportPhoto')
    expect(code).toContain('EXPORT_PHOTO_MAX_EDGE')
    expect(code).toContain('EXPORT_PHOTO_QUALITY')
    expect(code).not.toMatch(/thumbMaxEdge:\s*\d/)
    expect(code).not.toMatch(/thumbQuality:\s*0?\.\d/)
  })

  it('本地字节原图优先（先 readFull 再 readThumb），与云端原图同一输入规格', () => {
    const full = code.indexOf('readFull')
    const thumb = code.indexOf('readThumb')
    expect(full).toBeGreaterThan(-1)
    expect(thumb).toBeGreaterThan(full)
  })

  it('只读云端字节：不调用会落盘的 downloadPhotoToLocal / 不写媒体库', () => {
    expect(code).not.toContain('downloadPhotoToLocal')
    expect(code).not.toContain('.save(')
    expect(code).not.toContain('setItem')
  })
})
