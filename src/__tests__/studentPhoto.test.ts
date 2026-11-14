/**
 * 照片元数据纯函数自检（Phase 1B）。
 *
 * 覆盖：normalize / 未知字段安全保留 / 当前证件照唯一 / 排序 / 状态派生 / 姓名快照 /
 * 云端路径（不含姓名）。全部不碰浏览器存储，直接在 node 里跑。
 */
import { describe, expect, it, vi } from 'vitest'

import {
  buildPhotoStoragePath,
  currentIdPhotoOf,
  deriveStudentPhotoState,
  ensureSingleCurrentIdPhoto,
  formatStudentPhotoSize,
  isPhotoActive,
  normalizeStudentPhoto,
  photosOfStudent,
  refreshPhotoStudentNames,
  reviveStudentPhotos,
  sortStudentPhotos,
  studentPhotoCategoryLabel,
  totalActivePhotoBytes,
} from '@/utils/studentPhoto'
import type { Student } from '@/types'
import type { StudentPhoto } from '@/types/studentPhoto'

/* ========== 夹具 ========== */

function rawPhoto(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'p-1',
    studentId: 's1',
    studentName: '安琪',
    category: 'id-photo',
    storagePath: 'student-photos/s1/p-1.jpg',
    mimeType: 'image/jpeg',
    width: 1600,
    height: 1200,
    size: 200000,
    uploadedAt: '2026-11-13T01:00:00.000Z',
    updatedAt: '2026-11-13T01:00:00.000Z',
    createdAt: '2026-11-13T01:00:00.000Z',
    ...overrides,
  }
}

function photo(overrides: Record<string, unknown> = {}): StudentPhoto {
  const normalized = normalizeStudentPhoto(rawPhoto(overrides))
  if (!normalized) throw new Error('夹具本身不合法')
  return normalized
}

function student(id: string, name: string, extra: Partial<Student> = {}): Student {
  return { id, name, studentNo: '', gender: 'male', ...extra }
}

/* ==================== normalize ==================== */

describe('normalizeStudentPhoto：读路径健壮化', () => {
  it('完整合法记录原样保留', () => {
    const result = normalizeStudentPhoto(rawPhoto())
    expect(result).toMatchObject({
      id: 'p-1',
      studentId: 's1',
      studentName: '安琪',
      category: 'id-photo',
      storagePath: 'student-photos/s1/p-1.jpg',
      mimeType: 'image/jpeg',
      width: 1600,
      height: 1200,
      size: 200000,
      uploadedAt: '2026-11-13T01:00:00.000Z',
    })
    expect(result?.fileId).toBeUndefined()
    expect(result?.deletedAt).toBeUndefined()
    expect(result?.isCurrentIdPhoto).toBeUndefined()
  })

  it('只缺 id / studentId / 合法分类时才丢弃', () => {
    expect(normalizeStudentPhoto(rawPhoto({ id: '' }))).toBeNull()
    expect(normalizeStudentPhoto(rawPhoto({ id: undefined }))).toBeNull()
    expect(normalizeStudentPhoto(rawPhoto({ studentId: '' }))).toBeNull()
    expect(normalizeStudentPhoto(rawPhoto({ category: 'group-photo' }))).toBeNull()
    expect(normalizeStudentPhoto(null)).toBeNull()
    expect(normalizeStudentPhoto('x')).toBeNull()
    expect(normalizeStudentPhoto([])).toBeNull()
  })

  it('坏时间戳兜底而不是丢记录（照片已经存在，不能因时间格式坏掉变孤儿）', () => {
    const result = normalizeStudentPhoto(
      rawPhoto({ uploadedAt: 'not-a-date', createdAt: 'also-bad', updatedAt: undefined }),
    )!
    expect(Number.isNaN(Date.parse(result.uploadedAt))).toBe(false)
    expect(result.createdAt).toBe(result.uploadedAt)
    expect(result.updatedAt).toBe(result.uploadedAt)
  })

  it('坏尺寸 / 大小兜底为 0；fileId 去空白；删除时间非法则丢弃该字段', () => {
    const result = normalizeStudentPhoto(
      rawPhoto({
        width: 'wide',
        height: -3,
        size: Number.NaN,
        fileId: '  cloud://a  ',
        deletedAt: '???',
      }),
    )!
    expect(result.width).toBe(0)
    expect(result.height).toBe(0)
    expect(result.size).toBe(0)
    expect(result.fileId).toBe('cloud://a')
    expect(result.deletedAt).toBeUndefined()
  })

  it('storagePath 缺失时按 studentId + photoId 确定性派生（不含姓名）', () => {
    const result = normalizeStudentPhoto(rawPhoto({ storagePath: undefined }))!
    expect(result.storagePath).toBe('student-photos/s1/p-1.jpg')
    expect(result.storagePath).not.toContain('安琪')
  })

  it('mimeType 缺失时按路径后缀推断', () => {
    expect(
      normalizeStudentPhoto(rawPhoto({ mimeType: undefined, storagePath: 'a/b.png' }))?.mimeType,
    ).toBe('image/png')
    expect(normalizeStudentPhoto(rawPhoto({ mimeType: 'application/pdf' }))?.mimeType).toBe(
      'image/jpeg',
    )
  })

  it('isCurrentIdPhoto 只对证件照有效，且只认布尔 true', () => {
    expect(normalizeStudentPhoto(rawPhoto({ isCurrentIdPhoto: true }))?.isCurrentIdPhoto).toBe(true)
    expect(
      normalizeStudentPhoto(rawPhoto({ category: 'life-photo', isCurrentIdPhoto: true }))
        ?.isCurrentIdPhoto,
    ).toBeUndefined()
    expect(
      normalizeStudentPhoto(rawPhoto({ isCurrentIdPhoto: 'true' }))?.isCurrentIdPhoto,
    ).toBeUndefined()
  })

  it('未知字段（未来版本）JSON-safe 的保留，二进制 / 签名 URL / Base64 字段剔除', () => {
    const result = normalizeStudentPhoto(
      rawPhoto({
        futureField: 'future',
        futureNested: { keep: 1 },
        blob: new Blob(['x']),
        arrayBuffer: new ArrayBuffer(4),
        base64: 'aGVsbG8=',
        signedUrl: 'https://example.test/x?sign=1',
        tempFileURL: 'https://example.test/y',
        badFn: () => 1,
      }),
    )!
    expect(result).toMatchObject({ futureField: 'future', futureNested: { keep: 1 } })
    for (const key of ['blob', 'arrayBuffer', 'base64', 'signedUrl', 'tempFileURL', 'badFn']) {
      expect(key in result, `${key} 不该被保留`).toBe(false)
    }
    // 可以安全 JSON 序列化（不会把 Blob 序列化成 {} 混进同步 payload）
    expect(() => JSON.stringify(result)).not.toThrow()
    expect(JSON.stringify(result)).not.toContain('data:image')
    expect(JSON.stringify(result)).not.toContain('signed.example')
  })

  it('未知字段在「事件 → 草稿 → 再 normalize」往返中保持不丢', () => {
    const once = normalizeStudentPhoto(rawPhoto({ futureFlag: 42 }))!
    const twice = normalizeStudentPhoto(once)!
    expect((twice as StudentPhoto & Record<string, unknown>).futureFlag).toBe(42)
  })
})

/* ==================== revive / 当前证件照唯一 ==================== */

describe('reviveStudentPhotos：去重与当前证件照收敛', () => {
  it('重复 id 只保留首条，并告警', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const revived = reviveStudentPhotos([
      rawPhoto({ id: 'dup', uploadedAt: '2026-11-01T00:00:00.000Z' }),
      rawPhoto({ id: 'dup', uploadedAt: '2026-11-02T00:00:00.000Z' }),
    ])
    expect(revived).toHaveLength(1)
    expect(revived[0]?.uploadedAt).toBe('2026-11-01T00:00:00.000Z')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('丢弃非法记录、保留合法记录（混合脏数据）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const revived = reviveStudentPhotos([
      rawPhoto({ id: 'ok-1' }),
      null,
      { id: 'bad', studentId: '', category: 'id-photo' },
      'nope',
      rawPhoto({ id: 'ok-2', category: 'life-photo' }),
    ])
    expect(revived.map((item) => item.id)).toEqual(['ok-1', 'ok-2'])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('每生最多一张当前证件照：多条时保留「最后指定」的那条', () => {
    const revived = reviveStudentPhotos([
      rawPhoto({ id: 'old', isCurrentIdPhoto: true, updatedAt: '2026-11-01T00:00:00.000Z' }),
      rawPhoto({ id: 'new', isCurrentIdPhoto: true, updatedAt: '2026-11-05T00:00:00.000Z' }),
    ])
    expect(revived.find((item) => item.id === 'new')?.isCurrentIdPhoto).toBe(true)
    expect(revived.find((item) => item.id === 'old')?.isCurrentIdPhoto).toBeUndefined()
  })

  it('不同学生各自可以有自己的当前证件照', () => {
    const revived = reviveStudentPhotos([
      rawPhoto({ id: 'a', studentId: 's1', isCurrentIdPhoto: true }),
      rawPhoto({ id: 'b', studentId: 's2', isCurrentIdPhoto: true }),
    ])
    expect(revived.filter((item) => item.isCurrentIdPhoto).map((item) => item.studentId)).toEqual([
      's1',
      's2',
    ])
  })

  it('墓碑上的当前标记、生活照上的当前标记一律清除', () => {
    const photos = ensureSingleCurrentIdPhoto([
      photo({ id: 'deleted', isCurrentIdPhoto: true, deletedAt: '2026-11-10T00:00:00.000Z' }),
      photo({ id: 'life', category: 'life-photo', isCurrentIdPhoto: true }),
    ])
    expect(photos.every((item) => item.isCurrentIdPhoto === undefined)).toBe(true)
  })
})

/* ==================== 排序 / 查询 ==================== */

describe('排序与查询', () => {
  const photos = [
    photo({ id: 'old-life', category: 'life-photo', uploadedAt: '2026-11-01T00:00:00.000Z' }),
    photo({ id: 'new-life', category: 'life-photo', uploadedAt: '2026-11-05T00:00:00.000Z' }),
    photo({ id: 'current', isCurrentIdPhoto: true, uploadedAt: '2026-10-01T00:00:00.000Z' }),
    photo({
      id: 'deleted',
      category: 'life-photo',
      uploadedAt: '2026-10-01T00:00:00.000Z',
      deletedAt: '2026-11-09T00:00:00.000Z',
    }),
  ]

  it('当前证件照优先 → 上传时间倒序 → id 兜底', () => {
    expect(sortStudentPhotos(photos).map((item) => item.id)).toEqual([
      'current',
      'new-life',
      'old-life',
      'deleted',
    ])
  })

  it('photosOfStudent 只返回有效照片、可按分类过滤', () => {
    expect(photosOfStudent(photos, 's1').map((item) => item.id)).toEqual([
      'current',
      'new-life',
      'old-life',
    ])
    expect(photosOfStudent(photos, 's1', 'id-photo').map((item) => item.id)).toEqual(['current'])
    expect(photosOfStudent(photos, 's2')).toEqual([])
  })

  it('currentIdPhotoOf 不返回已删除的当前证件照', () => {
    const tombstoneCurrent = [
      photo({ id: 'gone', isCurrentIdPhoto: true, deletedAt: '2026-11-10T00:00:00.000Z' }),
    ]
    expect(currentIdPhotoOf(tombstoneCurrent, 's1')).toBeUndefined()
  })

  it('有效照片字节数不含墓碑', () => {
    expect(totalActivePhotoBytes(photos)).toBe(200000 * 3)
  })

  it('排序不修改入参', () => {
    const before = photos.map((item) => item.id)
    sortStudentPhotos(photos)
    expect(photos.map((item) => item.id)).toEqual(before)
  })
})

/* ==================== 状态派生 ==================== */

describe('deriveStudentPhotoState：状态靠真实数据派生', () => {
  it('六种状态各自成立', () => {
    const active = photo()
    expect(deriveStudentPhotoState(active, { hasLocal: true })).toBe('local-only')
    expect(deriveStudentPhotoState(active, { hasLocal: true, uploading: true })).toBe('uploading')
    expect(deriveStudentPhotoState(active, { hasLocal: false })).toBe('missing')
    expect(deriveStudentPhotoState(active, { hasLocal: true })).toBe('local-only')
    const withFile = photo({ fileId: 'cloud://x' })
    expect(deriveStudentPhotoState(withFile, { hasLocal: true })).toBe('ready')
    expect(deriveStudentPhotoState(withFile, { hasLocal: false })).toBe('remote-only')
    const deleted = photo({ deletedAt: '2026-11-10T00:00:00.000Z', fileId: 'cloud://x' })
    expect(deriveStudentPhotoState(deleted, { hasLocal: true })).toBe('deleted')
  })

  it('uploading 优先于 local-only（上传中也是"本机有图"）', () => {
    expect(deriveStudentPhotoState(photo(), { hasLocal: true, uploading: true })).toBe('uploading')
  })
})

/* ==================== 姓名快照 ==================== */

describe('refreshPhotoStudentNames：关联只认 studentId、绝不丢记录', () => {
  it('学生改名后快照刷新，记录保持关联', () => {
    const records = [photo({ studentId: 's1', studentName: '旧名字' })]
    const refreshed = refreshPhotoStudentNames(records, [student('s1', '新名字')])
    expect(refreshed[0]?.studentName).toBe('新名字')
    expect(refreshed[0]?.studentId).toBe('s1')
  })

  it('学生软删除后：记录保留、快照冻结', () => {
    const records = [photo({ studentId: 's1', studentName: '安琪' })]
    const refreshed = refreshPhotoStudentNames(records, [
      student('s1', '安琪', { deletedAt: '2026-11-01T00:00:00.000Z' }),
    ])
    expect(refreshed).toHaveLength(1)
    expect(refreshed[0]?.studentName).toBe('安琪')
  })

  it('学生从档案里彻底消失时保留原快照（绝不丢照片归属）', () => {
    const records = [photo({ studentId: 'gone', studentName: '转学同学' })]
    const refreshed = refreshPhotoStudentNames(records, [student('s1', '别人')])
    expect(refreshed).toHaveLength(1)
    expect(refreshed[0]?.studentName).toBe('转学同学')
  })

  it('重名学生快照带身份证尾号（全站消歧规则）', () => {
    const records = [photo({ studentId: 's1', studentName: '安琪' })]
    const refreshed = refreshPhotoStudentNames(records, [
      student('s1', '安琪', { idCardSuffix: '1111' }),
      student('s2', '安琪', { idCardSuffix: '2222' }),
    ])
    expect(refreshed[0]?.studentName).toBe('安琪（1111）')
  })

  it('无变化时返回原数组引用（避免无谓写盘）', () => {
    const records = [photo({ studentId: 's1', studentName: '安琪' })]
    expect(refreshPhotoStudentNames(records, [student('s1', '安琪')])).toBe(records)
  })
})

/* ==================== 路径 / 展示小件 ==================== */

describe('云端路径与展示小件', () => {
  it('路径只由稳定 ID 构成，不含学生姓名', () => {
    const path = buildPhotoStoragePath('s1', 'p-1', 'image/jpeg')
    expect(path).toBe('student-photos/s1/p-1.jpg')
    expect(path).not.toContain('安琪')
    expect(buildPhotoStoragePath('s1', 'p-2', 'image/png')).toBe('student-photos/s1/p-2.png')
    expect(buildPhotoStoragePath('s1', 'p-3', 'image/webp')).toBe('student-photos/s1/p-3.webp')
  })

  it('路径里的非法字符被清掉（防路径注入）', () => {
    expect(buildPhotoStoragePath('s/../1', 'p 1', 'image/jpeg')).toBe('student-photos/s1/p1.jpg')
  })

  it('体积 / 分类文案 / 有效性', () => {
    expect(formatStudentPhotoSize(0)).toBe('0 KB')
    expect(formatStudentPhotoSize(512)).toBe('1 KB')
    expect(formatStudentPhotoSize(2 * 1024 * 1024)).toBe('2.0 MB')
    expect(studentPhotoCategoryLabel('id-photo')).toBe('证件照')
    expect(studentPhotoCategoryLabel('life-photo')).toBe('生活照')
    expect(studentPhotoCategoryLabel('unknown')).toBe('照片')
    expect(isPhotoActive(photo())).toBe(true)
    expect(isPhotoActive(photo({ deletedAt: '2026-11-10T00:00:00.000Z' }))).toBe(false)
  })
})
