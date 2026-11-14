/**
 * 照片完整备份（ZIP 容器）自检（v3.8.1 · Phase 1）。
 *
 * 覆盖四个层面：
 * 1. **导出**：ZIP 结构（backup.json / 清单 / 照片文件）、photoId 关联、清单状态分类
 *    （成功 / 缺失 / 云端不可用 / 下载失败 / 格式不支持 / 已删除）、产物可复现；
 * 2. **导入校验**：结构、关联、长度、CRC、图片签名、清单汇总任何一项不符都**拒绝**；
 * 3. **恢复写盘**：先照片后数据；照片失败不写数据、数据失败回滚本次新增照片；
 *    原有数据在失败时保持原样；
 * 4. **边界**：旧 JSON 备份照常可导入；JSON 里绝不出现照片二进制。
 */
import { describe, expect, it } from 'vitest'

import { BACKUP_KIND, planMerge } from '@/utils/backup'
import {
  PHOTO_ARCHIVE_BACKUP_ENTRY,
  PHOTO_ARCHIVE_KIND,
  PHOTO_ARCHIVE_MANIFEST_ENTRY,
  PHOTO_ARCHIVE_PHOTO_DIR,
  PHOTO_ARCHIVE_README_ENTRY,
  buildPhotoArchive,
  imageMimeOfBytes,
  parsePhotoArchive,
  photoArchiveProblems,
  photoArchiveStatusLabel,
  restorePhotoArchive,
  type PhotoArchiveBuildInput,
  type PhotoArchiveContents,
  type PhotoArchiveManifest,
} from '@/utils/photoArchive'
import { decodeZipStore, encodeZipStore } from '@/utils/zip'
import { STUDENT_PHOTO_KEY } from '@/utils/backup'
import type { StoragePort } from '@/services/storage'
import type { StudentPhoto } from '@/types/studentPhoto'

/* ==================== 夹具 ==================== */

const STUDENTS_KEY = 'teacherdesk:students'

const JPEG_PREFIX = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]
const PNG_PREFIX = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function imageBlob(kind: 'jpeg' | 'png', size = 64): Blob {
  const bytes = new Uint8Array(size)
  const prefix = kind === 'jpeg' ? JPEG_PREFIX : PNG_PREFIX
  bytes.set(prefix)
  for (let index = prefix.length; index < size; index += 1) bytes[index] = index % 251
  return new Blob([bytes], { type: kind === 'jpeg' ? 'image/jpeg' : 'image/png' })
}

function photo(id: string, overrides: Partial<StudentPhoto> = {}): StudentPhoto {
  return {
    id,
    studentId: 's1',
    studentName: '安琪',
    category: 'id-photo',
    storagePath: `student-photos/s1/${id}.jpg`,
    mimeType: 'image/jpeg',
    width: 100,
    height: 120,
    size: 64,
    uploadedAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    createdAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  }
}

/** 与 `createBackup` 同构的 JSON 备份文本（只保留本测试用到的两块） */
function backupJson(photos: readonly StudentPhoto[]): string {
  return JSON.stringify({
    app: 'TeacherDesk',
    kind: BACKUP_KIND,
    schemaVersion: 1,
    appVersion: '3.8.1',
    exportedAt: '2026-11-14T00:00:00.000Z',
    data: {
      [STUDENTS_KEY]: [{ id: 's1', name: '安琪', studentNo: '', gender: 'male' }],
      [STUDENT_PHOTO_KEY]: photos.map((item) => ({ ...item })),
    },
  })
}

function buildInput(
  photos: readonly StudentPhoto[],
  resolveBinary: PhotoArchiveBuildInput['resolveBinary'],
): PhotoArchiveBuildInput {
  return {
    backupJson: backupJson(photos),
    appVersion: '3.8.1',
    exportedAt: '2026-11-14T00:00:00.000Z',
    photos,
    resolveBinary,
  }
}

function okResult(result: ReturnType<typeof parsePhotoArchive>): PhotoArchiveContents {
  if (!result.ok) throw new Error(`预期解析成功，实际失败：${result.error}`)
  return result.contents
}

function failMessage(result: ReturnType<typeof parsePhotoArchive>): string {
  if (result.ok) throw new Error('预期解析失败，实际成功')
  return result.error
}

/** 解出 ZIP 条目 → 修改某几个 → 重新打包（模拟被篡改 / 缺文件的备份） */
function rebuild(zip: Uint8Array, mutate: (entries: Map<string, Uint8Array>) => void): Uint8Array {
  const entries = new Map(decodeZipStore(zip).map((item) => [item.name, item.data] as const))
  mutate(entries)
  return encodeZipStore([...entries].map(([name, data]) => ({ name, data })))
}

function entryText(entries: Map<string, Uint8Array>, name: string): string {
  const bytes = entries.get(name)
  if (!bytes) throw new Error(`缺少条目 ${name}`)
  return new TextDecoder().decode(bytes)
}

function replaceEntryText(entries: Map<string, Uint8Array>, name: string, text: string): void {
  entries.set(name, new TextEncoder().encode(text))
}

class FakeStorage implements StoragePort {
  readonly map = new Map<string, string>()
  failNextWrite = false
  writes = 0

  read(key: string): string | null {
    return this.map.get(key) ?? null
  }

  write(key: string, value: string): void {
    if (this.failNextWrite) {
      this.failNextWrite = false
      throw new Error('模拟存储写满')
    }
    this.writes += 1
    this.map.set(key, value)
  }

  remove(key: string): void {
    this.map.delete(key)
  }

  list(): string[] {
    return [...this.map.keys()]
  }
}

/* ==================== 导出 ==================== */

describe('导出：ZIP 结构与 photoId 关联', () => {
  const photos = [
    photo('p1'),
    photo('p2', {
      category: 'life-photo',
      mimeType: 'image/png',
      storagePath: 'student-photos/s1/p2.png',
    }),
    photo('p3'),
  ]
  const resolver: PhotoArchiveBuildInput['resolveBinary'] = async (item) => {
    if (item.id === 'p1') return { ok: true, blob: imageBlob('jpeg') }
    if (item.id === 'p2') return { ok: true, blob: imageBlob('png') }
    return { ok: false, status: 'missing-local', reason: '本机与云端都没有' }
  }

  it('ZIP 含 backup.json / 清单 / README 与照片文件，照片名以 photoId 命名', async () => {
    const result = await buildPhotoArchive(buildInput(photos, resolver))
    const entries = decodeZipStore(result.zipBytes)
    const names = entries.map((item) => item.name)
    expect(names).toContain(PHOTO_ARCHIVE_BACKUP_ENTRY)
    expect(names).toContain(PHOTO_ARCHIVE_MANIFEST_ENTRY)
    expect(names).toContain(PHOTO_ARCHIVE_README_ENTRY)
    expect(names).toContain(`${PHOTO_ARCHIVE_PHOTO_DIR}/p1.jpg`)
    expect(names).toContain(`${PHOTO_ARCHIVE_PHOTO_DIR}/p2.png`)
    expect(names).not.toContain(`${PHOTO_ARCHIVE_PHOTO_DIR}/p3.jpg`)

    const manifest = JSON.parse(
      new TextDecoder().decode(
        entries.find((item) => item.name === PHOTO_ARCHIVE_MANIFEST_ENTRY)!.data,
      ),
    ) as PhotoArchiveManifest
    expect(manifest.kind).toBe(PHOTO_ARCHIVE_KIND)
    expect(manifest.totals).toEqual({
      photos: 3,
      included: 2,
      missing: 1,
      failed: 0,
      unavailable: 0,
      deleted: 0,
    })
    const p1 = manifest.photos.find((item) => item.photoId === 'p1')!
    expect(p1.status).toBe('included')
    expect(p1.studentId).toBe('s1')
    expect(p1.crc32).toBeTypeOf('number')
  })

  it('清单如实区分缺失 / 云端不可用 / 下载失败 / 格式不支持 / 已删除', async () => {
    const input = buildInput(
      [
        photo('ok'),
        photo('missing'),
        photo('unavailable', { fileId: 'cloud://x' }),
        photo('failed', { fileId: 'cloud://y' }),
        photo('bad', { mimeType: 'image/jpeg' }),
        photo('deleted', { deletedAt: '2026-11-02T00:00:00.000Z' }),
      ],
      async (item) => {
        if (item.id === 'ok') return { ok: true, blob: imageBlob('jpeg') }
        if (item.id === 'missing') return { ok: false, status: 'missing-local', reason: '没有文件' }
        if (item.id === 'unavailable') {
          return { ok: false, status: 'remote-unavailable', reason: '未登录' }
        }
        if (item.id === 'failed') return { ok: false, status: 'download-failed', reason: '断网' }
        // 取到了内容但不是图片
        return { ok: true, blob: new Blob([new Uint8Array([1, 2, 3, 4, 5])]) }
      },
    )
    const result = await buildPhotoArchive(input)
    const byId = new Map(result.manifest.photos.map((item) => [item.photoId, item]))
    expect(byId.get('ok')?.status).toBe('included')
    expect(byId.get('missing')?.status).toBe('missing-local')
    expect(byId.get('unavailable')?.status).toBe('remote-unavailable')
    expect(byId.get('failed')?.status).toBe('download-failed')
    expect(byId.get('bad')?.status).toBe('invalid-binary')
    expect(byId.get('deleted')?.status).toBe('deleted')
    expect(result.manifest.totals).toEqual({
      photos: 6,
      included: 1,
      missing: 1,
      failed: 2,
      unavailable: 1,
      deleted: 1,
    })
    // 未进 ZIP 的照片必须能在「问题清单」里被界面读到
    expect(
      photoArchiveProblems(result.manifest)
        .map((item) => item.photoId)
        .sort(),
    ).toEqual(['bad', 'failed', 'missing', 'unavailable'])
    expect(photoArchiveStatusLabel('remote-unavailable')).toContain('云端不可用')
  })

  it('导出可复现：同一输入两次打包字节一致', async () => {
    const first = await buildPhotoArchive(buildInput(photos, resolver))
    const second = await buildPhotoArchive(buildInput(photos, resolver))
    expect(new Uint8Array(await first.blob.arrayBuffer())).toEqual(
      new Uint8Array(await second.blob.arrayBuffer()),
    )
  })

  it('JSON 备份里绝不出现照片二进制 / Base64 / dataURL', async () => {
    const result = await buildPhotoArchive(buildInput(photos, resolver))
    const entries = new Map(decodeZipStore(result.zipBytes).map((item) => [item.name, item.data]))
    const json = entryText(entries, PHOTO_ARCHIVE_BACKUP_ENTRY)
    expect(json).not.toContain('base64')
    expect(json).not.toContain('data:image')
    expect(json).not.toContain('signedUrl')
  })
})

/* ==================== 导入校验 ==================== */

describe('导入：结构 / 关联 / 完整性校验', () => {
  const photos = [photo('p1'), photo('p2')]
  const resolver: PhotoArchiveBuildInput['resolveBinary'] = async () => ({
    ok: true,
    blob: imageBlob('jpeg'),
  })
  const build = () => buildPhotoArchive(buildInput(photos, resolver))

  it('合规 ZIP 解析成功，照片按 photoId 与元数据对应', async () => {
    const archive = await build()
    const contents = okResult(parsePhotoArchive(archive.zipBytes))
    expect(contents.photos.map((item) => item.photoId).sort()).toEqual(['p1', 'p2'])
    expect(contents.photos.every((item) => item.mimeType === 'image/jpeg')).toBe(true)
    expect(contents.backup.kind).toBe(BACKUP_KIND)
    expect(contents.manifest.totals.included).toBe(2)
    expect(contents.warnings).toEqual([])
  })

  it('非 ZIP 字节：直接拒绝', () => {
    expect(failMessage(parsePhotoArchive(new TextEncoder().encode('hello')))).toContain('ZIP')
  })

  it('缺少 backup.json / 缺少照片清单：拒绝', async () => {
    const archive = await build()
    const withoutBackup = rebuild(archive.zipBytes, (entries) =>
      entries.delete(PHOTO_ARCHIVE_BACKUP_ENTRY),
    )
    expect(failMessage(parsePhotoArchive(withoutBackup))).toContain('backup.json')
    const withoutManifest = rebuild(archive.zipBytes, (entries) =>
      entries.delete(PHOTO_ARCHIVE_MANIFEST_ENTRY),
    )
    expect(failMessage(parsePhotoArchive(withoutManifest))).toContain('照片清单')
  })

  it('照片与元数据关联不一致：拒绝', async () => {
    const archive = await build()
    const tampered = rebuild(archive.zipBytes, (entries) => {
      const manifest = JSON.parse(
        entryText(entries, PHOTO_ARCHIVE_MANIFEST_ENTRY),
      ) as PhotoArchiveManifest
      manifest.photos[0]!.studentId = 's2'
      replaceEntryText(entries, PHOTO_ARCHIVE_MANIFEST_ENTRY, JSON.stringify(manifest))
    })
    expect(failMessage(parsePhotoArchive(tampered))).toContain('学生关联')
  })

  it('ZIP 里缺一张已声明包含的照片：拒绝', async () => {
    const archive = await build()
    const tampered = rebuild(archive.zipBytes, (entries) => entries.delete('photos/p1.jpg'))
    expect(failMessage(parsePhotoArchive(tampered))).toContain('缺少照片文件')
  })

  it('清单大小 / CRC / 图片类型与文件不符：拒绝', async () => {
    const archive = await build()
    const sizeTampered = rebuild(archive.zipBytes, (entries) => {
      const manifest = JSON.parse(
        entryText(entries, PHOTO_ARCHIVE_MANIFEST_ENTRY),
      ) as PhotoArchiveManifest
      manifest.photos[0]!.bytes = (manifest.photos[0]!.bytes ?? 0) + 1
      replaceEntryText(entries, PHOTO_ARCHIVE_MANIFEST_ENTRY, JSON.stringify(manifest))
    })
    expect(failMessage(parsePhotoArchive(sizeTampered))).toContain('大小')

    const crcTampered = rebuild(archive.zipBytes, (entries) => {
      const manifest = JSON.parse(
        entryText(entries, PHOTO_ARCHIVE_MANIFEST_ENTRY),
      ) as PhotoArchiveManifest
      manifest.photos[0]!.crc32 = (manifest.photos[0]!.crc32 ?? 0) ^ 0xffff
      replaceEntryText(entries, PHOTO_ARCHIVE_MANIFEST_ENTRY, JSON.stringify(manifest))
    })
    expect(failMessage(parsePhotoArchive(crcTampered))).toContain('校验失败')
  })

  it('清单汇总与明细对不上：拒绝', async () => {
    const archive = await build()
    const tampered = rebuild(archive.zipBytes, (entries) => {
      const manifest = JSON.parse(
        entryText(entries, PHOTO_ARCHIVE_MANIFEST_ENTRY),
      ) as PhotoArchiveManifest
      manifest.totals.included = 99
      replaceEntryText(entries, PHOTO_ARCHIVE_MANIFEST_ENTRY, JSON.stringify(manifest))
    })
    expect(failMessage(parsePhotoArchive(tampered))).toContain('汇总')
  })

  it('更新版本的清单：拒绝并提示升级', async () => {
    const archive = await build()
    const tampered = rebuild(archive.zipBytes, (entries) => {
      const manifest = JSON.parse(
        entryText(entries, PHOTO_ARCHIVE_MANIFEST_ENTRY),
      ) as PhotoArchiveManifest
      manifest.version = 99
      replaceEntryText(entries, PHOTO_ARCHIVE_MANIFEST_ENTRY, JSON.stringify(manifest))
    })
    expect(failMessage(parsePhotoArchive(tampered))).toContain('升级')
  })

  it('照片清单 photoId 重复：拒绝（否则覆盖 / 回滚快照的归属无法判断）', async () => {
    const archive = await build()
    const tampered = rebuild(archive.zipBytes, (entries) => {
      const manifest = JSON.parse(
        entryText(entries, PHOTO_ARCHIVE_MANIFEST_ENTRY),
      ) as PhotoArchiveManifest
      manifest.photos.push({ ...manifest.photos[0]! })
      replaceEntryText(entries, PHOTO_ARCHIVE_MANIFEST_ENTRY, JSON.stringify(manifest))
    })
    expect(failMessage(parsePhotoArchive(tampered))).toContain('photoId 重复')
  })

  it('backup.json 不是本应用备份：拒绝', async () => {
    const archive = await build()
    const tampered = rebuild(archive.zipBytes, (entries) =>
      replaceEntryText(entries, PHOTO_ARCHIVE_BACKUP_ENTRY, '{"kind":"other"}'),
    )
    expect(failMessage(parsePhotoArchive(tampered))).toContain('数据备份无效')
  })
})

/* ==================== 恢复写盘 ==================== */

describe('恢复：先照片后数据，失败可回滚', () => {
  const photos = [photo('p1'), photo('p2')]
  const resolver: PhotoArchiveBuildInput['resolveBinary'] = async () => ({
    ok: true,
    blob: imageBlob('jpeg'),
  })

  async function builtContents(): Promise<PhotoArchiveContents> {
    const archive = await buildPhotoArchive(buildInput(photos, resolver))
    return okResult(parsePhotoArchive(archive.zipBytes))
  }

  /** 与 Toolbox 一致：基于「当前盘上数据」算合并计划（而非空的 current） */
  function writesFor(storage: FakeStorage, contents: PhotoArchiveContents): Record<string, string> {
    const current: Record<string, unknown[]> = {}
    for (const key of Object.keys(contents.backup.data)) {
      const raw = storage.read(key)
      if (raw === null) continue
      try {
        const parsed: unknown = JSON.parse(raw)
        if (Array.isArray(parsed)) current[key] = parsed
      } catch {
        // 盘上损坏的键不参与合并（与 readModules 的 broken 口径一致）
      }
    }
    return planMerge(current, contents.backup, []).writes
  }

  /** 假媒体库：按 id 保存原图 + 缩略图，支持逐项注入失败 */
  type FakeMedia = Map<string, { full: Blob; thumb: Blob }>

  function zipThumbFor(photoId: string, full: Blob): Blob {
    // 与真实管线一样：缩略图由原图生成；这里用可区分的内容模拟
    return new Blob([`zip-thumb:${photoId}:${full.size}`])
  }

  function mediaDeps(initial: FakeMedia = new Map()) {
    const files: FakeMedia = new Map(initial)
    const removed: string[] = []
    const restored: string[] = []
    let failSaveFor: string | null = null
    let failSnapshotFor: string | null = null
    let failRestoreFor: string | null = null
    let failRemoveFor: string | null = null
    return {
      files,
      removed,
      restored,
      deps: {
        readPhotoSnapshot: async (photoId: string) => {
          if (failSnapshotFor === photoId) throw new Error('模拟读取原图快照失败')
          const existing = files.get(photoId)
          return existing ? { full: existing.full, thumb: existing.thumb } : null
        },
        savePhoto: async (photoId: string, blob: Blob) => {
          if (failSaveFor === photoId) throw new Error('模拟 IndexedDB 写满')
          files.set(photoId, { full: blob, thumb: zipThumbFor(photoId, blob) })
        },
        restorePhotoSnapshot: async (photoId: string, snapshot: { full: Blob; thumb: Blob }) => {
          if (failRestoreFor === photoId) throw new Error('模拟写回原图失败')
          restored.push(photoId)
          files.set(photoId, { full: snapshot.full, thumb: snapshot.thumb })
        },
        removePhoto: async (photoId: string) => {
          if (failRemoveFor === photoId) throw new Error('模拟删除本次新建失败')
          removed.push(photoId)
          files.delete(photoId)
        },
      },
      failSaveFor(id: string) {
        failSaveFor = id
      },
      failSnapshotFor(id: string) {
        failSnapshotFor = id
      },
      failRestoreFor(id: string) {
        failRestoreFor = id
      },
      failRemoveFor(id: string) {
        failRemoveFor = id
      },
    }
  }

  /** 本机原有媒体（与 ZIP 内容不同：原图更长、缩略图是另一种图片） */
  function originalMedia(): { full: Blob; thumb: Blob } {
    return { full: imageBlob('jpeg', 200), thumb: imageBlob('png', 32) }
  }

  async function bytesOf(blob: Blob): Promise<number[]> {
    return [...new Uint8Array(await blob.arrayBuffer())]
  }

  it('成功：照片写入本机，业务数据写盘，返回恢复数量', async () => {
    const contents = await builtContents()
    const storage = new FakeStorage()
    storage.map.set(STUDENTS_KEY, JSON.stringify([{ id: 'old', name: '旧学生' }]))
    const writes = writesFor(storage, contents)
    const media = mediaDeps()
    const outcome = await restorePhotoArchive(contents, {
      storage,
      writes,
      ...media.deps,
    })
    expect(outcome).toMatchObject({
      ok: true,
      restoredPhotos: 2,
      overwrittenPhotos: 0,
    })
    expect(media.files.has('p1')).toBe(true)
    expect(media.files.has('p2')).toBe(true)
    // 合并保留本机独有记录 + 追加备份里的学生
    const students = JSON.parse(storage.map.get(STUDENTS_KEY)!) as { id: string }[]
    expect(students.map((item) => item.id)).toEqual(['old', 's1'])
  })

  it('照片阶段失败：不写业务数据，本次新建照片被清理', async () => {
    const contents = await builtContents()
    const storage = new FakeStorage()
    const original = '[{"id":"old","name":"旧学生"}]'
    storage.map.set(STUDENTS_KEY, original)
    const writes = writesFor(storage, contents)
    const media = mediaDeps()
    media.failSaveFor('p2')
    const outcome = await restorePhotoArchive(contents, {
      storage,
      writes,
      ...media.deps,
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.phase).toBe('photos')
    expect(outcome.rolledBackPhotos).toBe(true)
    expect(outcome.photoRollbackFailures).toEqual([])
    expect(outcome.rolledBackData).toBe(true)
    expect(storage.map.get(STUDENTS_KEY)).toBe(original)
    expect(media.files.has('p1')).toBe(false)
    expect(media.removed).toContain('p1')
  })

  it('数据阶段失败：业务数据回滚，本次新建照片被清理，原有照片保留', async () => {
    const contents = await builtContents()
    const storage = new FakeStorage()
    const original = '[{"id":"old","name":"旧学生"}]'
    storage.map.set(STUDENTS_KEY, original)
    const writes = writesFor(storage, contents)
    storage.failNextWrite = true
    // 模拟本机已有一张 p1（失败回滚时不能删掉它）
    const existing: FakeMedia = new Map([['p1', originalMedia()]])
    const media = mediaDeps(existing)
    const outcome = await restorePhotoArchive(contents, {
      storage,
      writes,
      ...media.deps,
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.phase).toBe('data')
    expect(outcome.rolledBackPhotos).toBe(true)
    expect(outcome.rolledBackData).toBe(true)
    expect(storage.map.get(STUDENTS_KEY)).toBe(original)
    // p1 原本就存在 → 必须还原成**覆盖前**的原图 + 缩略图；p2 是本次新建 → 删除
    expect(await bytesOf(media.files.get('p1')!.full)).toEqual(
      await bytesOf(existing.get('p1')!.full),
    )
    expect(await bytesOf(media.files.get('p1')!.thumb)).toEqual(
      await bytesOf(existing.get('p1')!.thumb),
    )
    expect(media.files.has('p2')).toBe(false)
  })

  it('同 photoId 且内容不同：成功后以 ZIP 版本为准，元数据也以备份为准', async () => {
    const contents = await builtContents()
    const storage = new FakeStorage()
    storage.map.set(
      STUDENTS_KEY,
      JSON.stringify([{ id: 's1', name: '本机旧名', studentNo: '', gender: 'male' }]),
    )
    const existing: FakeMedia = new Map([['p1', originalMedia()]])
    const media = mediaDeps(existing)
    const writes = writesFor(storage, contents)
    const outcome = await restorePhotoArchive(contents, { storage, writes, ...media.deps })
    expect(outcome).toMatchObject({ ok: true, overwrittenPhotos: 1 })
    // 媒体换成 ZIP 版本（原图来自 contents）
    const zipPhoto = contents.photos.find((item) => item.photoId === 'p1')!
    expect(await bytesOf(media.files.get('p1')!.full)).toEqual(await bytesOf(zipPhoto.blob))
    expect(await bytesOf(media.files.get('p1')!.thumb)).not.toEqual(
      await bytesOf(existing.get('p1')!.thumb),
    )
    // 元数据也以备份为准
    const students = JSON.parse(storage.map.get(STUDENTS_KEY)!) as { id: string; name: string }[]
    expect(students).toEqual([{ id: 's1', name: '安琪', studentNo: '', gender: 'male' }])
    // 照片元数据与 photoId 关联保持一致（不会被二进制覆盖搞乱归属）
    const metadata = JSON.parse(storage.map.get(STUDENT_PHOTO_KEY)!) as {
      id: string
      studentId: string
    }[]
    expect(metadata.map((item) => item.id).sort()).toEqual(['p1', 'p2'])
    expect(metadata.every((item) => item.studentId === 's1')).toBe(true)
  })

  it('覆盖前先留快照：照片阶段中途失败时，被覆盖的原图 / 缩略图原样还原', async () => {
    const contents = await builtContents()
    const storage = new FakeStorage()
    const originalStore = '[{"id":"old","name":"旧学生"}]'
    storage.map.set(STUDENTS_KEY, originalStore)
    const existing: FakeMedia = new Map([['p1', originalMedia()]])
    const media = mediaDeps(existing)
    media.failSaveFor('p2') // p1 已覆盖成功后，p2 写失败
    const writes = writesFor(storage, contents)
    const outcome = await restorePhotoArchive(contents, { storage, writes, ...media.deps })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.phase).toBe('photos')
    expect(outcome.rolledBackPhotos).toBe(true)
    expect(outcome.photoRollbackFailures).toEqual([])
    expect(media.restored).toContain('p1')
    expect(await bytesOf(media.files.get('p1')!.full)).toEqual(
      await bytesOf(existing.get('p1')!.full),
    )
    expect(await bytesOf(media.files.get('p1')!.thumb)).toEqual(
      await bytesOf(existing.get('p1')!.thumb),
    )
    expect(storage.map.get(STUDENTS_KEY)).toBe(originalStore)
  })

  it('读取快照失败：这张照片一个字节都不动，之前的写入正常回滚', async () => {
    const contents = await builtContents()
    const storage = new FakeStorage()
    const existing: FakeMedia = new Map([['p1', originalMedia()]])
    const media = mediaDeps(existing)
    media.failSnapshotFor('p2')
    const writes = writesFor(storage, contents)
    const outcome = await restorePhotoArchive(contents, { storage, writes, ...media.deps })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.phase).toBe('photos')
    expect(outcome.rolledBackPhotos).toBe(true)
    // p1 已覆盖 → 还原；p2 在读取快照阶段失败 → 从未写入，保持原样（本机本来也没有）
    expect(await bytesOf(media.files.get('p1')!.full)).toEqual(
      await bytesOf(existing.get('p1')!.full),
    )
    expect(media.files.has('p2')).toBe(false)
  })

  it('回滚本身失败：精确报告未恢复的文件（而不是笼统失败）', async () => {
    const contents = await builtContents()
    const storage = new FakeStorage()
    const existing: FakeMedia = new Map([['p1', originalMedia()]])
    const media = mediaDeps(existing)
    media.failSaveFor('p2') // 触发照片阶段失败
    media.failRestoreFor('p1') // 且 p1 的原图写回也失败
    const writes = writesFor(storage, contents)
    const outcome = await restorePhotoArchive(contents, { storage, writes, ...media.deps })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.rolledBackPhotos).toBe(false)
    expect(outcome.photoRollbackFailures).toEqual([
      { photoId: 'p1', action: 'restore-overwritten', error: '模拟写回原图失败' },
    ])
    // 未能还原的 p1 保持 ZIP 版本（这是必须如实报告的状态）
    const zipPhoto = contents.photos.find((item) => item.photoId === 'p1')!
    expect(await bytesOf(media.files.get('p1')!.full)).toEqual(await bytesOf(zipPhoto.blob))
  })

  it('回滚删除失败：精确报告未能删除的本次新建照片', async () => {
    const contents = await builtContents()
    const storage = new FakeStorage()
    const media = mediaDeps()
    media.failSaveFor('p2')
    media.failRemoveFor('p1') // p1 已写入，回滚删除失败
    const writes = writesFor(storage, contents)
    const outcome = await restorePhotoArchive(contents, { storage, writes, ...media.deps })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.rolledBackPhotos).toBe(false)
    expect(outcome.photoRollbackFailures).toEqual([
      { photoId: 'p1', action: 'remove-new', error: '模拟删除本次新建失败' },
    ])
    expect(media.files.has('p1')).toBe(true)
  })

  it('旧 JSON 备份（无照片块）仍能走同一套照片归档解析：照片数 0', async () => {
    const archive = await buildPhotoArchive({
      backupJson: JSON.stringify({
        app: 'TeacherDesk',
        kind: BACKUP_KIND,
        schemaVersion: 1,
        appVersion: '3.7.8',
        exportedAt: '2026-10-01T00:00:00.000Z',
        data: { [STUDENTS_KEY]: [{ id: 's1', name: '安琪', studentNo: '', gender: 'male' }] },
      }),
      appVersion: '3.8.1',
      exportedAt: '2026-11-14T00:00:00.000Z',
      photos: [],
      resolveBinary: async () => ({ ok: false, status: 'missing-local', reason: '没有照片' }),
    })
    const contents = okResult(parsePhotoArchive(archive.zipBytes))
    expect(contents.photos).toEqual([])
    expect(contents.manifest.totals.photos).toBe(0)
    const storage = new FakeStorage()
    const writes = planMerge({}, contents.backup, []).writes
    const outcome = await restorePhotoArchive(contents, {
      storage,
      writes,
      readPhotoSnapshot: async () => null,
      savePhoto: async () => undefined,
      restorePhotoSnapshot: async () => undefined,
      removePhoto: async () => undefined,
    })
    expect(outcome).toMatchObject({ ok: true, restoredPhotos: 0, overwrittenPhotos: 0 })
    expect(storage.map.has(STUDENTS_KEY)).toBe(true)
  })
})

/* ==================== 其它 ==================== */

describe('图片签名与导出输入类型', () => {
  it('按文件头识别 JPEG / PNG / WebP，认不出返回 undefined', () => {
    expect(imageMimeOfBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(imageMimeOfBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'image/png',
    )
    const webp = new Uint8Array(12)
    webp.set([0x52, 0x49, 0x46, 0x46], 0)
    webp.set([0x57, 0x45, 0x42, 0x50], 8)
    expect(imageMimeOfBytes(webp)).toBe('image/webp')
    expect(imageMimeOfBytes(new Uint8Array([1, 2, 3, 4]))).toBeUndefined()
  })

  it('导出输入的类型不影响结果：缺失照片不会伪造文件', async () => {
    const result = await buildPhotoArchive(
      buildInput([photo('only-missing')], async () => ({
        ok: false,
        status: 'missing-local',
        reason: '没有',
      })),
    )
    expect(result.manifest.totals.included).toBe(0)
    expect(result.manifest.totals.missing).toBe(1)
    expect(decodeZipStore(result.zipBytes).map((item) => item.name)).not.toContain(
      'photos/only-missing.jpg',
    )
  })
})
