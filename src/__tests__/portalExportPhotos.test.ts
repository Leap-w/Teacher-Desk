import { describe, expect, it } from 'vitest'

import {
  collectPortalPhotos,
  describePortalPhotoFailures,
  PORTAL_PHOTO_FAILURE_LABELS,
  type CollectPortalPhotosPorts,
  type PortalPhotoCandidate,
} from '@/utils/portalHtml/collectPortalPhotos'
import { PhotoCloudError } from '@/services/photoCloud'

/** 真实 Blob → data URL：node 没有 FileReader，用 Node 的 arrayBuffer 做等价转换。 */
async function realDataUrl(blob: Blob): Promise<string> {
  const bytes = Buffer.from(await blob.arrayBuffer())
  return `data:${blob.type || 'image/jpeg'};base64,${bytes.toString('base64')}`
}

function realImageBlob(label: string, mime = 'image/jpeg'): Blob {
  return new Blob([Buffer.from(`REAL_IMAGE_BYTES_${label}`, 'utf8')], { type: mime })
}

const students = [
  { id: 's1', name: '张三' },
  { id: 's2', name: '李四' },
]

function photo(overrides: Partial<PortalPhotoCandidate> = {}): PortalPhotoCandidate {
  return {
    id: 'p1',
    studentId: 's1',
    studentName: '张三',
    category: 'id-photo',
    fileId: 'cloud://p1',
    mimeType: 'image/jpeg',
    updatedAt: '2026-11-20T10:00:00.000Z',
    ...overrides,
  }
}

function ports(overrides: Partial<CollectPortalPhotosPorts> = {}): CollectPortalPhotosPorts {
  return {
    readLocal: async () => null,
    readCloud: async () => realImageBlob('cloud'),
    cloudAvailable: () => true,
    // 默认不做真实缩放：node 没有 Canvas。真实规则由 usePortalExport 注入 Canvas 管线。
    prepare: async (blob) => blob,
    toDataUrl: realDataUrl,
    ...overrides,
  }
}

describe('单文件导出 · 本地/云端照片收集', () => {
  it('① 本地照片：命中本机字节，不发云端请求', async () => {
    let cloudCalls = 0
    const result = await collectPortalPhotos(
      [photo()],
      students,
      ports({
        readLocal: async () => realImageBlob('local'),
        readCloud: async () => {
          cloudCalls += 1
          return realImageBlob('cloud')
        },
      }),
    )
    expect(result.photos).toHaveLength(1)
    expect(
      Buffer.from(result.photos[0]!.dataUrl.split(',')[1]!, 'base64').toString('utf8'),
    ).toContain('REAL_IMAGE_BYTES_local')
    expect(result.stats).toMatchObject({ localCount: 1, cloudCount: 0, failedCount: 0 })
    expect(cloudCalls).toBe(0)
  })

  it('② 云端照片：本地没有，走真实文件端口拿到内存 Blob 后内嵌', async () => {
    const result = await collectPortalPhotos([photo()], students, ports())
    expect(
      Buffer.from(result.photos[0]!.dataUrl.split(',')[1]!, 'base64').toString('utf8'),
    ).toContain('REAL_IMAGE_BYTES_cloud')
    expect(result.stats.cloudCount).toBe(1)
    expect(result.stats.localCount).toBe(0)
  })

  it('③ 本地 + 云端 + 生活照混合：来源与分类都正确', async () => {
    const result = await collectPortalPhotos(
      [
        photo({ id: 'p1', studentId: 's1', category: 'id-photo', isCurrentIdPhoto: true }),
        photo({ id: 'p2', studentId: 's1', category: 'life-photo' }),
        photo({ id: 'p3', studentId: 's2', category: 'id-photo' }),
      ],
      students,
      ports({
        readLocal: async (id) => (id === 'p1' ? realImageBlob('local') : null),
      }),
    )
    expect(result.photos).toHaveLength(3)
    expect(result.photos.map((p) => p.category)).toEqual(['id-photo', 'id-photo', 'life-photo'])
    expect(result.stats).toMatchObject({
      metadataCount: 3,
      embeddedCount: 3,
      localCount: 1,
      cloudCount: 2,
      failedCount: 0,
    })
  })

  it('④ 单张下载失败：保留其它照片，失败张数与原因分类上报', async () => {
    const result = await collectPortalPhotos(
      [photo({ id: 'p1' }), photo({ id: 'p2', studentId: 's2', fileId: 'cloud://p2' })],
      students,
      ports({
        readCloud: async (fileId) => {
          if (fileId.endsWith('p1')) throw new PhotoCloudError('download-failed', '模拟单张失败')
          return realImageBlob('ok')
        },
      }),
    )
    expect(result.photos).toHaveLength(1)
    expect(result.stats).toMatchObject({ embeddedCount: 1, failedCount: 1 })
    expect(result.stats.reasons['cloud-download-failed']).toBe(1)
  })

  it('⑤ 全部照片下载失败：0 张内嵌、失败数等于元数据数', async () => {
    const result = await collectPortalPhotos(
      [photo({ id: 'p1' }), photo({ id: 'p2', studentId: 's2' })],
      students,
      ports({
        readCloud: async () => {
          throw new PhotoCloudError('download-failed', '断网')
        },
      }),
    )
    expect(result.photos).toHaveLength(0)
    expect(result.stats).toMatchObject({ embeddedCount: 0, failedCount: 2 })
    expect(result.stats.reasons['cloud-download-failed']).toBe(2)
  })

  it('⑥ 未登录 / 认证失效：不发起下载，按 cloud-unavailable 分类', async () => {
    let calls = 0
    const result = await collectPortalPhotos(
      [photo()],
      students,
      ports({
        cloudAvailable: () => false,
        readCloud: async () => {
          calls += 1
          return realImageBlob('x')
        },
      }),
    )
    expect(calls).toBe(0)
    expect(result.photos).toHaveLength(0)
    expect(result.stats.reasons['cloud-unavailable']).toBe(1)
  })

  it('⑦ 网络中断：权限/下载失败被分类，不暴露错误原文', async () => {
    const result = await collectPortalPhotos(
      [photo()],
      students,
      ports({
        readCloud: async () => {
          throw new Error('https://secret.example/token=abc network down')
        },
      }),
    )
    expect(result.photos).toHaveLength(0)
    expect(result.stats.reasons['cloud-download-failed']).toBe(1)
    expect(JSON.stringify(result.stats)).not.toContain('secret.example')
    expect(JSON.stringify(result.stats)).not.toContain('token')
  })

  it('⑧ 重复导出：同一组输入两次结果一致，无缓存污染', async () => {
    const input = [photo()]
    const first = await collectPortalPhotos(input, students, ports())
    const second = await collectPortalPhotos(input, students, ports())
    expect(second.photos).toEqual(first.photos)
    expect(second.stats).toEqual(first.stats)
  })

  it('⑨ 导出中取消：抛 AbortError，不返回任何照片', async () => {
    const controller = new AbortController()
    const pending = collectPortalPhotos(
      [photo()],
      students,
      ports({
        readCloud: async () => {
          controller.abort()
          return realImageBlob('late')
        },
        signal: controller.signal,
      }),
    )
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('⑩ 无云端备份的本地缺失照片：明确记为 no-cloud-backup', async () => {
    const result = await collectPortalPhotos([photo({ fileId: undefined })], students, ports())
    expect(result.photos).toHaveLength(0)
    expect(result.stats.reasons['no-cloud-backup']).toBe(1)
  })

  it('本地读取异常时自动回退云端，不误判为失败', async () => {
    const result = await collectPortalPhotos(
      [photo()],
      students,
      ports({
        readLocal: async () => {
          throw new Error('IDB unavailable')
        },
      }),
    )
    expect(
      Buffer.from(result.photos[0]!.dataUrl.split(',')[1]!, 'base64').toString('utf8'),
    ).toContain('REAL_IMAGE_BYTES_cloud')
    expect(result.stats.cloudCount).toBe(1)
  })

  it('云端 Blob 无 MIME 时用元数据标注，不伪造内容', async () => {
    const result = await collectPortalPhotos(
      [photo({ mimeType: 'image/png' })],
      students,
      ports({
        readCloud: async () => new Blob([Buffer.from('abc')]),
      }),
    )
    expect(result.photos[0]?.dataUrl.startsWith('data:image/png;')).toBe(true)
  })

  it('非在读学生的照片被排除，不进入 HTML', async () => {
    const result = await collectPortalPhotos([photo({ studentId: 'deleted' })], students, ports())
    expect(result.photos).toHaveLength(0)
    expect(result.stats.metadataCount).toBe(0)
  })
})

describe('单文件导出 · 照片统一缩放（内存处理）', () => {
  it('本地与云端字节都过同一个 prepare，且顺序是「取字节 → 缩放 → 编码」', async () => {
    const calls: string[] = []
    const result = await collectPortalPhotos(
      [
        photo({ id: 'p1', studentId: 's1' }), // 本地命中
        photo({ id: 'p2', studentId: 's2' }), // 云端命中
      ],
      students,
      ports({
        readLocal: async (id) => {
          calls.push(`read:${id}`)
          return id === 'p1' ? realImageBlob('local') : null
        },
        readCloud: async () => {
          calls.push('cloud')
          return realImageBlob('cloud')
        },
        prepare: async (blob) => {
          // 用内容区分来源，确认两条来源走的是同一个端口
          const text = Buffer.from(await blob.arrayBuffer()).toString('utf8')
          calls.push(`prepare:${text.includes('local') ? 'local' : 'cloud'}`)
          return new Blob([Buffer.from(`${text}_resized`)], { type: 'image/jpeg' })
        },
        toDataUrl: async (blob) => {
          calls.push('encode')
          return realDataUrl(blob)
        },
      }),
    )
    expect(calls).toEqual([
      'read:p1',
      'prepare:local',
      'encode',
      'read:p2',
      'cloud',
      'prepare:cloud',
      'encode',
    ])
    // 内联的是缩放后的字节，不是原始字节
    for (const item of result.photos) {
      const text = Buffer.from(item.dataUrl.split(',')[1]!, 'base64').toString('utf8')
      expect(text).toContain('_resized')
    }
    expect(result.stats).toMatchObject({ embeddedCount: 2, failedCount: 0 })
  })

  it('单张缩放失败：按 image-resize-failed 记账，其它照片照常内嵌', async () => {
    const result = await collectPortalPhotos(
      [photo({ id: 'p1' }), photo({ id: 'p2', studentId: 's2' })],
      students,
      ports({
        readLocal: async (id) => (id === 'p1' ? realImageBlob('broken') : realImageBlob('ok')),
        prepare: async (blob) => {
          const text = Buffer.from(await blob.arrayBuffer()).toString('utf8')
          if (text.includes('broken')) throw new Error('canvas 解码失败')
          return blob
        },
      }),
    )
    expect(result.photos).toHaveLength(1)
    expect(result.stats).toMatchObject({ embeddedCount: 1, failedCount: 1 })
    expect(result.stats.reasons['image-resize-failed']).toBe(1)
  })

  it('缩放返回空 Blob 也算失败，不产出空图', async () => {
    const result = await collectPortalPhotos(
      [photo()],
      students,
      ports({ prepare: async () => null as unknown as Blob }),
    )
    expect(result.photos).toHaveLength(0)
    expect(result.stats.reasons['image-resize-failed']).toBe(1)
  })

  it('进度按真实张数上报：1..N，总数等于待处理元数据数', async () => {
    const seen: Array<[number, number]> = []
    await collectPortalPhotos(
      [
        photo({ id: 'p1', studentId: 's1' }),
        photo({ id: 'p2', studentId: 's2' }),
        photo({ id: 'p3', studentId: 's1', category: 'life-photo' }),
      ],
      students,
      ports({
        readLocal: async (id) => (id === 'p3' ? realImageBlob('local') : null),
        onProgress: (done, total) => seen.push([done, total]),
      }),
    )
    expect(seen).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ])
  })

  it('失败原因有中文文案，界面不会直接显示英文内部码', () => {
    for (const reason of Object.keys(PORTAL_PHOTO_FAILURE_LABELS)) {
      const label = PORTAL_PHOTO_FAILURE_LABELS[reason as keyof typeof PORTAL_PHOTO_FAILURE_LABELS]
      expect(label.length).toBeGreaterThan(0)
      expect(label).not.toBe(reason)
      expect(label).not.toMatch(/^[a-z-]+$/)
    }
    const text = describePortalPhotoFailures({
      'cloud-unavailable': 60,
      'cloud-download-failed': 2,
      'no-cloud-backup': 0,
    })
    expect(text).toBe('未登录云端或云端不可用 60 张、云端下载失败 2 张')
    expect(text).not.toContain('cloud-')
    expect(text).not.toContain('no-cloud-backup')
  })
})
