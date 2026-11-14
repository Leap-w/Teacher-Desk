/**
 * 照片完整备份的**生产接线**自检（v3.8.1 · Phase 1）。
 *
 * `utils/photoArchive.ts` 测的是纯逻辑；本文件用真实的 `usePhotoArchive()` + 真实 Store +
 * 假浏览器 / 假媒体库 / 假云端，验证「界面按下去会发生什么」：
 * - 导出：JSON 备份 → ZIP；本机 IndexedDB 有图直接用；本机没有但云端可用才下载；
 *   云端不可用 / 都没有时如实列入缺失，不伪造文件；
 * - 导入：合并计划 + 恢复后照片真的写进本机媒体库、业务数据真的落盘；
 * - 原有 JSON 备份键与同步键不因本功能而改变。
 */
import { nextTick } from 'vue'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installFakeBrowser, type FakeBrowser } from './helpers/env'
import {
  installPhotoTestDoubles,
  resetPhotoTestDoubles,
  type PhotoTestDoubles,
} from './helpers/photoDoubles'
import { appConfig } from '@/config'
import { STUDENT_PHOTOS_KEY } from '@/repositories'
import { useStudentPhotoStore } from '@/stores/studentPhoto'
import { usePhotoArchive } from '@/composables/usePhotoArchive'
import { readModules, planMerge } from '@/utils/backup'
import {
  PHOTO_ARCHIVE_BACKUP_ENTRY,
  PHOTO_ARCHIVE_MANIFEST_ENTRY,
  PHOTO_ARCHIVE_PHOTO_DIR,
} from '@/utils/photoArchive'
import { decodeZipStore } from '@/utils/zip'
import type { StudentPhoto } from '@/types/studentPhoto'

const prefix = appConfig.storageKeyPrefix
const STUDENTS_KEY = `${prefix}:students`

const JPEG_PREFIX = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]

function jpegBlob(size = 64): Blob {
  const bytes = new Uint8Array(size)
  bytes.set(JPEG_PREFIX)
  for (let index = JPEG_PREFIX.length; index < size; index += 1) bytes[index] = index % 251
  return new Blob([bytes], { type: 'image/jpeg' })
}

async function bytesOf(blob: Blob): Promise<number[]> {
  return [...new Uint8Array(await blob.arrayBuffer())]
}

function photoRecord(id: string, overrides: Partial<StudentPhoto> = {}): StudentPhoto {
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

function seedBase(photos: StudentPhoto[]): void {
  browser.localStorage.seed(
    STUDENTS_KEY,
    JSON.stringify([{ id: 's1', name: '安琪', studentNo: '', gender: 'male' }]),
  )
  browser.localStorage.seed(STUDENT_PHOTOS_KEY, JSON.stringify(photos))
}

async function makeStore(): Promise<void> {
  const store = useStudentPhotoStore()
  await nextTick()
  await store.refreshLocalPresence()
  await nextTick()
}

let browser: FakeBrowser
let doubles: PhotoTestDoubles

beforeEach(() => {
  browser = installFakeBrowser()
  doubles = installPhotoTestDoubles({ cloud: { available: true } })
  setActivePinia(createPinia())
})

afterEach(() => {
  resetPhotoTestDoubles()
})

describe('usePhotoArchive 导出（生产接线）', () => {
  it('本机有图直接打包；本机没有但云端可用才下载；ZIP 结构完整', async () => {
    seedBase([
      photoRecord('p-local'),
      photoRecord('p-cloud', { fileId: 'cloud://fake/p-cloud.jpg' }),
    ])
    doubles.media.files.set('p-local', { full: jpegBlob(), thumb: jpegBlob(24) })
    doubles.cloud.files.set('cloud://fake/p-cloud.jpg', jpegBlob(48))
    await makeStore()

    const archive = usePhotoArchive()
    const outcome = await archive.exportFullBackup()
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    const manifest = outcome.result.manifest
    expect(manifest.totals).toMatchObject({ photos: 2, included: 2, missing: 0, failed: 0 })
    expect(doubles.cloud.downloadRequests).toEqual(['cloud://fake/p-cloud.jpg'])

    const names = decodeZipStore(outcome.result.zipBytes).map((item) => item.name)
    expect(names).toContain(PHOTO_ARCHIVE_BACKUP_ENTRY)
    expect(names).toContain(PHOTO_ARCHIVE_MANIFEST_ENTRY)
    expect(names).toContain(`${PHOTO_ARCHIVE_PHOTO_DIR}/p-local.jpg`)
    expect(names).toContain(`${PHOTO_ARCHIVE_PHOTO_DIR}/p-cloud.jpg`)
  })

  it('云端不可用时不尝试下载，缺失照片如实记录且不伪造文件', async () => {
    seedBase([
      photoRecord('p-local'),
      photoRecord('p-missing'),
      photoRecord('p-cloudonly', { fileId: 'cloud://fake/p-cloudonly.jpg' }),
    ])
    doubles.media.files.set('p-local', { full: jpegBlob(), thumb: jpegBlob(24) })
    doubles.cloud.setAvailable(false)
    await makeStore()

    const archive = usePhotoArchive()
    const outcome = await archive.exportFullBackup()
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    const byId = new Map(outcome.result.manifest.photos.map((item) => [item.photoId, item]))
    expect(byId.get('p-local')?.status).toBe('included')
    expect(byId.get('p-missing')?.status).toBe('missing-local')
    expect(byId.get('p-cloudonly')?.status).toBe('remote-unavailable')
    // 未登录 / 未配置时**一次下载请求都不该发**
    expect(doubles.cloud.downloadRequests).toEqual([])
    expect(decodeZipStore(outcome.result.zipBytes).map((item) => item.name)).not.toContain(
      `${PHOTO_ARCHIVE_PHOTO_DIR}/p-cloudonly.jpg`,
    )
  })
})

describe('usePhotoArchive 导入（生产接线）', () => {
  it('导出 → 解析 → 恢复：照片写回本机媒体库，业务数据合并落盘', async () => {
    seedBase([photoRecord('p1'), photoRecord('p2')])
    doubles.media.files.set('p1', { full: jpegBlob(), thumb: jpegBlob(24) })
    doubles.media.files.set('p2', { full: jpegBlob(80), thumb: jpegBlob(24) })
    await makeStore()

    const archive = usePhotoArchive()
    const exported = await archive.exportFullBackup()
    expect(exported.ok).toBe(true)
    if (!exported.ok) return

    // 模拟「换一台设备」：清掉本机照片媒体与照片元数据，只留下从 ZIP 来的文件
    doubles.media.files.clear()
    browser.localStorage.clear()
    browser.localStorage.seed(
      STUDENTS_KEY,
      JSON.stringify([{ id: 's1', name: '安琪', studentNo: '', gender: 'male' }]),
    )

    const parsed = await archive.parseArchiveFile(exported.result.blob)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const current = readModules((key) => browser.localStorage.getItem(key)).values
    const writes = planMerge(current, parsed.contents.backup, []).writes
    const restored = await archive.restoreFullBackup(parsed.contents, writes)
    expect(restored).toMatchObject({ ok: true, restoredPhotos: 2 })

    // 照片真的写进了本机媒体库（原图 + 缩略图）
    expect(await doubles.media.readFull('p1')).toBeInstanceOf(Blob)
    expect(await doubles.media.readThumb('p2')).toBeInstanceOf(Blob)
    // 业务数据真的落盘
    const students = JSON.parse(browser.localStorage.getItem(STUDENTS_KEY)!) as { id: string }[]
    expect(students.map((item) => item.id)).toEqual(['s1'])
    expect(browser.localStorage.getItem(STUDENT_PHOTOS_KEY)).not.toBeNull()
  })

  it('同 photoId 覆盖后业务数据写失败：生产接线用快照还原原图 / 缩略图', async () => {
    seedBase([photoRecord('p1')])
    doubles.media.files.set('p1', { full: jpegBlob(64), thumb: jpegBlob(24) })
    await makeStore()

    const archive = usePhotoArchive()
    const exported = await archive.exportFullBackup()
    expect(exported.ok).toBe(true)
    if (!exported.ok) return
    const parsed = await archive.parseArchiveFile(exported.result.blob)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    // 导出后，本机换成「另一份原图 / 缩略图」——恢复会覆盖它
    const otherFull = jpegBlob(120)
    const otherThumb = jpegBlob(30)
    doubles.media.files.set('p1', { full: otherFull, thumb: otherThumb })

    const current = readModules((key) => browser.localStorage.getItem(key)).values
    const writes = planMerge(current, parsed.contents.backup, []).writes
    // 让业务数据写盘失败一次（照片阶段已经全部成功）
    const setItemSpy = vi.spyOn(browser.localStorage, 'setItem').mockImplementationOnce(() => {
      throw new Error('模拟存储写满')
    })
    const outcome = await archive.restoreFullBackup(parsed.contents, writes)
    setItemSpy.mockRestore()

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.phase).toBe('data')
    expect(outcome.rolledBackPhotos).toBe(true)
    expect(outcome.photoRollbackFailures).toEqual([])
    // 覆盖前的原图 / 缩略图被原样写回
    expect(await bytesOf((await doubles.media.readFull('p1'))!)).toEqual(await bytesOf(otherFull))
    expect(await bytesOf((await doubles.media.readThumb('p1'))!)).toEqual(await bytesOf(otherThumb))
  })

  it('ZIP 校验失败时不写任何数据（媒体库与 localStorage 都保持原样）', async () => {
    seedBase([photoRecord('p1')])
    doubles.media.files.set('p1', { full: jpegBlob(), thumb: jpegBlob(24) })
    await makeStore()

    const archive = usePhotoArchive()
    const parsed = await archive.parseArchiveFile(new Blob([new Uint8Array([1, 2, 3])]))
    expect(parsed.ok).toBe(false)
    // 解析失败不会有任何恢复调用；本机状态原样
    expect(await doubles.media.readFull('p1')).toBeInstanceOf(Blob)
    expect(browser.localStorage.getItem(STUDENT_PHOTOS_KEY)).not.toBeNull()
  })
})

/* ==================== 恢复后的本地 / 云端状态与上传（Phase 1.1 B） ==================== */

/** 恢复完成后模拟「重新打开应用」：新建 Pinia + Store，重新读盘并按实际媒体派生状态 */
async function reloadPhotoStore(): Promise<ReturnType<typeof useStudentPhotoStore>> {
  setActivePinia(createPinia())
  const store = useStudentPhotoStore()
  await nextTick()
  await store.refreshLocalPresence()
  await nextTick()
  return store
}

/**
 * 完整走一遍「导出 → 清空本机（模拟换设备）→ 恢复 → 重开应用」。
 * 返回重开后的照片 Store。
 */
async function restoreIntoCleanDevice(
  photos: StudentPhoto[],
  localMediaIds: readonly string[],
): Promise<ReturnType<typeof useStudentPhotoStore>> {
  seedBase(photos)
  for (const id of localMediaIds) {
    doubles.media.files.set(id, { full: jpegBlob(), thumb: jpegBlob(24) })
  }
  await makeStore()

  const archive = usePhotoArchive()
  const exported = await archive.exportFullBackup()
  if (!exported.ok) throw new Error(exported.error)
  const parsed = await archive.parseArchiveFile(exported.result.blob)
  if (!parsed.ok) throw new Error(parsed.error)

  doubles.media.files.clear()
  browser.localStorage.clear()
  browser.localStorage.seed(
    STUDENTS_KEY,
    JSON.stringify([{ id: 's1', name: '安琪', studentNo: '', gender: 'male' }]),
  )
  const current = readModules((key) => browser.localStorage.getItem(key)).values
  const writes = planMerge(current, parsed.contents.backup, []).writes
  const restored = await archive.restoreFullBackup(parsed.contents, writes)
  if (!restored.ok) throw new Error(restored.error)

  return reloadPhotoStore()
}

describe('恢复后的照片状态派生（Phase 1.1 B）', () => {
  it('有 fileId → ready；没有 fileId → local-only（不伪装成已同步）', async () => {
    const store = await restoreIntoCleanDevice(
      [photoRecord('p-file', { fileId: 'cloud://fake/p-file.jpg' }), photoRecord('p-local')],
      ['p-file', 'p-local'],
    )
    expect(store.stateOf('p-file')).toBe('ready')
    expect(store.stateOf('p-local')).toBe('local-only')
    // 云端不可用也不会把「仅本机」说成已同步：状态来自实际媒体 + fileId
    expect(store.lastErrorOf('p-local')).toBeUndefined()
    expect(store.pendingUploadCount).toBe(0)
  })

  it('恢复出的无 fileId 照片可通过现有上传队列补传，成功后状态变为 ready', async () => {
    const store = await restoreIntoCleanDevice([photoRecord('p-local')], ['p-local'])
    expect(store.stateOf('p-local')).toBe('local-only')

    // 复用既有入口：StudentPhotoManager 的「上传到云端」按钮调用同一个 queuePhotoUpload
    store.queuePhotoUpload('p-local')
    const result = await store.flushPhotoUploads()
    expect(result.uploaded).toBe(1)

    const uploaded = store.findPhoto('p-local')
    expect(uploaded?.fileId).toBeTruthy()
    expect(store.stateOf('p-local')).toBe('ready')
    expect(doubles.cloud.uploads.some((item) => item.storagePath.includes('p-local'))).toBe(true)
    // 上传不改动本地原图
    expect(await doubles.media.readFull('p-local')).toBeInstanceOf(Blob)
  })

  it('云端不可用时：照片仍可本机查看，状态保持 local-only；云端恢复后同一队列可补传', async () => {
    const store = await restoreIntoCleanDevice([photoRecord('p-local')], ['p-local'])
    doubles.cloud.setAvailable(false)

    // 本机查看不受影响
    const localBlob = await store.getPhotoBlob('p-local')
    expect(localBlob).toBeInstanceOf(Blob)
    expect(await localBlob.arrayBuffer()).toBeInstanceOf(ArrayBuffer)

    store.queuePhotoUpload('p-local')
    const skipped = await store.flushPhotoUploads()
    expect(skipped).toMatchObject({ uploaded: 0, failed: 0, skipped: 1 })
    // 不伪装成已同步，队列保留
    expect(store.stateOf('p-local')).toBe('local-only')
    expect(store.findPhoto('p-local')?.fileId).toBeUndefined()
    expect(store.pendingUploadCount).toBe(1)

    // 云端恢复可用后，同一队列完成补传
    doubles.cloud.setAvailable(true)
    const uploaded = await store.flushPhotoUploads()
    expect(uploaded.uploaded).toBe(1)
    expect(store.stateOf('p-local')).toBe('ready')
    expect(store.pendingUploadCount).toBe(0)
  })
})
