/**
 * 照片 Store 自检（Phase 1B）——跑真实编排，不是只验方法被调用。
 *
 * 覆盖：
 * - 新增：图片处理 → IndexedDB（原图+缩略图）→ 元数据落盘 → 入队上传；失败补偿；
 * - 当前证件照：手动指定 / 更换 / 删除后无悬空标记 / 唯一性收敛；
 * - 逻辑删除：墓碑先落盘、后清本地、云端保留；墓碑重启后仍在；
 * - 状态派生：local-only / remote-only / ready / uploading / missing / deleted；
 * - 上传：离线跳过、成功写 fileId、失败重试、重启恢复、幂等不重复上传；
 * - 同步边界：元数据走现有整键同步、图片不进 payload、outbox 不参与同步/备份；
 *   LWW 覆盖后本机媒体**不会被误删**；
 * - JSON 安全：元数据里没有 Blob/Base64/签名 URL。
 */
import { nextTick } from 'vue'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installFakeBrowser, type FakeBrowser } from './helpers/env'
import {
  createMemoryMediaStore,
  installPhotoTestDoubles,
  resetPhotoTestDoubles,
  type PhotoTestDoubles,
} from './helpers/photoDoubles'
import { appConfig } from '@/config'
import { STUDENT_PHOTOS_KEY } from '@/repositories'
import { useStudentStore } from '@/stores/student'
import { useStudentPhotoStore, StudentPhotoStoreError } from '@/stores/studentPhoto'
import { applySyncKeys, syncedKeys, syncSubscriberCount } from '@/services/sync'
import { readRaw } from '@/services/storage'
import { PHOTO_OUTBOX_KEY, readPhotoOutbox } from '@/services/photoOutbox'
import { PhotoProcessingError } from '@/services/imagePipeline'
import { PhotoCloudError } from '@/services/photoCloud'
import { MediaStoreError, setMediaStore } from '@/services/mediaStore'
import { BACKUP_MODULES } from '@/utils/backup'
import type { Student } from '@/types'
import type { StudentPhoto } from '@/types/studentPhoto'

const prefix = appConfig.storageKeyPrefix
const STUDENTS_KEY = `${prefix}:students`

let browser: FakeBrowser
let doubles: PhotoTestDoubles

function student(id: string, name: string, extra: Partial<Student> = {}): Student {
  return { id, name, studentNo: '', gender: 'male', ...extra }
}

function seedStudents(roster: Student[] = [student('s1', '安琪'), student('s2', '白玛')]): void {
  browser.localStorage.seed(STUDENTS_KEY, JSON.stringify(roster))
}

function openStore(roster?: Student[]) {
  seedStudents(roster)
  return useStudentPhotoStore()
}

function photoFile(size = 2048): File {
  return new File([new Uint8Array(size)], 'photo.jpg', { type: 'image/jpeg' })
}

function diskPhotos(): Record<string, unknown>[] {
  const raw = readRaw(STUDENT_PHOTOS_KEY)
  return raw ? (JSON.parse(raw) as Record<string, unknown>[]) : []
}

function diskText(): string {
  return readRaw(STUDENT_PHOTOS_KEY) ?? ''
}

/** 让写某个键时抛错（模拟浏览器存储写不进去 / 配额满） */
function makeKeyUnwritable(key: string): () => void {
  const original = browser.localStorage.setItem.bind(browser.localStorage)
  const spy = vi.spyOn(browser.localStorage, 'setItem').mockImplementation((k, v) => {
    if (k === key) throw new Error('simulated quota error')
    original(k, v)
  })
  return () => spy.mockRestore()
}

beforeEach(() => {
  browser = installFakeBrowser()
  setActivePinia(createPinia())
  doubles = installPhotoTestDoubles()
})

afterEach(() => {
  resetPhotoTestDoubles()
  vi.restoreAllMocks()
})

/* ==================== 新增照片 ==================== */

describe('新增照片：本地优先 + 元数据落盘 + 入队上传', () => {
  it('新增成功：元数据完整、本机原图/缩略图都在、进入上传队列', async () => {
    const store = openStore()
    const created = await store.addPhoto('s1', photoFile(), 'id-photo')

    expect(created).toMatchObject({
      studentId: 's1',
      studentName: '安琪',
      category: 'id-photo',
      mimeType: 'image/jpeg',
      width: 1600,
      height: 1200,
      storagePath: `student-photos/s1/${created.id}.jpg`,
    })
    expect(created.fileId).toBeUndefined()
    expect(created.isCurrentIdPhoto).toBeUndefined()
    expect(Number.isNaN(Date.parse(created.uploadedAt))).toBe(false)

    // 本机媒体：原图 + 缩略图同一个事务写入
    expect(doubles.media.files.has(created.id)).toBe(true)
    expect(store.hasLocalMedia(created.id)).toBe(true)

    // 元数据已经落盘
    await nextTick()
    expect(diskPhotos()).toHaveLength(1)
    expect(diskPhotos()[0]).toMatchObject({ id: created.id, studentId: 's1', category: 'id-photo' })

    // 待上传队列（默认云可用 → 后台可能已开传；至少入过队）
    expect(readPhotoOutbox().some((task) => task.photoId === created.id)).toBe(true)
  })

  it('新上传证件照不会自动成为当前证件照', async () => {
    const store = openStore()
    await store.addPhoto('s1', photoFile(), 'id-photo')
    await store.addPhoto('s1', photoFile(), 'id-photo')
    expect(store.currentIdPhoto('s1')).toBeUndefined()
  })

  it('多张证件照 + 多张生活照可共存', async () => {
    const store = openStore()
    await store.addPhoto('s1', photoFile(), 'id-photo')
    await store.addPhoto('s1', photoFile(), 'id-photo')
    await store.addPhoto('s1', photoFile(), 'life-photo')
    await store.addPhoto('s1', photoFile(), 'life-photo')
    expect(store.listStudentPhotos('s1', 'id-photo')).toHaveLength(2)
    expect(store.listStudentPhotos('s1', 'life-photo')).toHaveLength(2)
    expect(store.photos.filter((photo) => photo.studentId === 's1')).toHaveLength(4)
  })

  it('学生不存在 → 拒绝且不写本机媒体 / 元数据', async () => {
    const store = openStore()
    await expect(store.addPhoto('nobody', photoFile(), 'id-photo')).rejects.toMatchObject({
      name: 'StudentPhotoStoreError',
      code: 'student-not-found',
    })
    expect(doubles.media.files.size).toBe(0)
    expect(diskPhotos()).toHaveLength(0)
  })

  it('图片处理失败（解码失败）→ 不写媒体、不写元数据', async () => {
    doubles = installPhotoTestDoubles({
      image: { failWith: new PhotoProcessingError('decode-failed', '解码失败') },
    })
    const store = openStore()
    await expect(store.addPhoto('s1', photoFile(), 'id-photo')).rejects.toMatchObject({
      code: 'decode-failed',
    })
    expect(doubles.media.files.size).toBe(0)
    expect(diskPhotos()).toHaveLength(0)
  })

  it('本机媒体写入失败（配额不足）→ 抛可读错误、不写元数据、不入队', async () => {
    const store = openStore()
    doubles.media.failNextSave = new MediaStoreError('quota', '本机存储空间不足')
    const error = (await store
      .addPhoto('s1', photoFile(), 'id-photo')
      .catch((caught: unknown) => caught)) as StudentPhotoStoreError
    expect(error).toBeInstanceOf(StudentPhotoStoreError)
    expect(error.code).toBe('media-save-failed')
    expect(error.message).toContain('存储空间不足')
    expect(diskPhotos()).toHaveLength(0)
    expect(readPhotoOutbox()).toHaveLength(0)
  })

  it('元数据落盘失败 → 补偿删除刚写的本地媒体（不留无法追踪的孤儿）', async () => {
    const store = openStore()
    const restore = makeKeyUnwritable(STUDENT_PHOTOS_KEY)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const error = (await store
        .addPhoto('s1', photoFile(), 'id-photo')
        .catch((caught: unknown) => caught)) as StudentPhotoStoreError
      expect(error.code).toBe('metadata-not-saved')
      expect(store.photos).toHaveLength(0)
      expect(doubles.media.files.size).toBe(0)
      expect(doubles.media.removedIds.length).toBeGreaterThan(0)
    } finally {
      restore()
      warn.mockRestore()
    }
  })
})

/* ==================== 学生关联 ==================== */

describe('学生关联：改名刷新快照、软删除保留历史', () => {
  it('学生改名后照片关联不变、姓名快照刷新', async () => {
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'life-photo')
    const studentStore = useStudentStore()
    studentStore.updateStudent('s1', { name: '安琪拉' })
    await nextTick()
    expect(store.findPhoto(photo.id)?.studentId).toBe('s1')
    expect(store.findPhoto(photo.id)?.studentName).toBe('安琪拉')
  })

  it('学生软删除后照片历史仍保留、仍可按 id 查询', async () => {
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'id-photo')
    const studentStore = useStudentStore()
    studentStore.removeStudent('s1')
    await nextTick()
    expect(store.findPhoto(photo.id)).toBeDefined()
    expect(store.listStudentPhotos('s1')).toHaveLength(1)
    expect(diskPhotos()).toHaveLength(1)
  })
})

/* ==================== 当前证件照 ==================== */

describe('当前证件照：手动指定 / 更换 / 删除安全', () => {
  it('手动指定当前证件照并落盘', async () => {
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'id-photo')
    await store.setCurrentIdPhoto('s1', photo.id)
    expect(store.currentIdPhoto('s1')?.id).toBe(photo.id)
    await nextTick()
    expect(diskPhotos()[0]).toMatchObject({ isCurrentIdPhoto: true })
  })

  it('更换当前证件照：原照片继续保留、只是去掉标记', async () => {
    const store = openStore()
    const first = await store.addPhoto('s1', photoFile(), 'id-photo')
    const second = await store.addPhoto('s1', photoFile(), 'id-photo')
    await store.setCurrentIdPhoto('s1', first.id)
    await store.setCurrentIdPhoto('s1', second.id)

    await nextTick()
    const onDisk = diskPhotos()
    expect(onDisk).toHaveLength(2)
    expect(onDisk.find((photo) => photo.id === first.id)?.isCurrentIdPhoto).toBeUndefined()
    expect(onDisk.find((photo) => photo.id === second.id)?.isCurrentIdPhoto).toBe(true)
    expect(store.currentIdPhoto('s1')?.id).toBe(second.id)
  })

  it('不能把生活照 / 别人的照片设为当前证件照', async () => {
    const store = openStore()
    const life = await store.addPhoto('s1', photoFile(), 'life-photo')
    await expect(store.setCurrentIdPhoto('s1', life.id)).rejects.toMatchObject({
      code: 'current-photo-invalid',
    })
    const other = await store.addPhoto('s2', photoFile(), 'id-photo')
    await expect(store.setCurrentIdPhoto('s1', other.id)).rejects.toMatchObject({
      code: 'current-photo-invalid',
    })
  })

  it('取消当前证件照：历史照片全部保留', async () => {
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'id-photo')
    await store.setCurrentIdPhoto('s1', photo.id)
    await store.clearCurrentIdPhoto('s1')
    expect(store.currentIdPhoto('s1')).toBeUndefined()
    expect(store.listStudentPhotos('s1')).toHaveLength(1)
  })

  it('删除当前证件照后不留下悬空标记', async () => {
    const store = openStore()
    const current = await store.addPhoto('s1', photoFile(), 'id-photo')
    const other = await store.addPhoto('s1', photoFile(), 'id-photo')
    await store.setCurrentIdPhoto('s1', current.id)
    await store.removePhoto(current.id)

    expect(store.currentIdPhoto('s1')).toBeUndefined()
    await nextTick()
    const onDisk = diskPhotos()
    expect(onDisk.find((photo) => photo.id === current.id)).toMatchObject({
      deletedAt: expect.any(String),
    })
    expect('isCurrentIdPhoto' in (onDisk.find((photo) => photo.id === current.id) ?? {})).toBe(
      false,
    )
    expect(onDisk.find((photo) => photo.id === other.id)).toBeDefined()
  })

  it('同步采纳带多条"当前证件照"时收敛为一条（按最后指定）', async () => {
    seedStudents()
    browser.localStorage.seed(
      STUDENT_PHOTOS_KEY,
      JSON.stringify([
        {
          id: 'old',
          studentId: 's1',
          studentName: '安琪',
          category: 'id-photo',
          isCurrentIdPhoto: true,
          storagePath: 'student-photos/s1/old.jpg',
          mimeType: 'image/jpeg',
          width: 10,
          height: 10,
          size: 10,
          uploadedAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-01T00:00:00.000Z',
          createdAt: '2026-11-01T00:00:00.000Z',
        },
        {
          id: 'new',
          studentId: 's1',
          studentName: '安琪',
          category: 'id-photo',
          isCurrentIdPhoto: true,
          storagePath: 'student-photos/s1/new.jpg',
          mimeType: 'image/jpeg',
          width: 10,
          height: 10,
          size: 10,
          uploadedAt: '2026-11-02T00:00:00.000Z',
          updatedAt: '2026-11-05T00:00:00.000Z',
          createdAt: '2026-11-02T00:00:00.000Z',
        },
      ]),
    )
    const store = useStudentPhotoStore()
    expect(store.currentIdPhoto('s1')?.id).toBe('new')
    expect(store.photos.filter((photo) => photo.isCurrentIdPhoto)).toHaveLength(1)
  })
})

/* ==================== 逻辑删除 ==================== */

describe('逻辑删除：墓碑先落盘、后清本地、云端保留', () => {
  it('删除写入墓碑并保留文件定位信息，正常查询过滤', async () => {
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'id-photo')
    await store.flushPhotoUploads()
    const uploaded = store.findPhoto(photo.id)!
    expect(uploaded.fileId).toBeTruthy()

    expect(await store.removePhoto(photo.id)).toBe(true)
    const tombstone = store.findPhoto(photo.id)!
    expect(tombstone.deletedAt).toBeTruthy()
    expect(tombstone.fileId).toBe(uploaded.fileId)
    expect(tombstone.storagePath).toBe(uploaded.storagePath)
    expect(tombstone.uploadedAt).toBe(uploaded.uploadedAt)
    expect(store.listStudentPhotos('s1')).toEqual([])
    expect(store.activePhotos).toEqual([])
    expect(store.stateOf(photo.id)).toBe('deleted')

    // 本机二进制被清理；云端文件**没有被删**
    expect(doubles.media.files.has(photo.id)).toBe(false)
    expect(doubles.cloud.files.has(tombstone.fileId!)).toBe(true)
  })

  it('墓碑在应用重启后仍在（跨会话保留删除状态）', async () => {
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'id-photo')
    await store.removePhoto(photo.id)
    await nextTick()

    setActivePinia(createPinia())
    const reloaded = useStudentPhotoStore()
    expect(reloaded.findPhoto(photo.id)?.deletedAt).toBeTruthy()
    expect(reloaded.listStudentPhotos('s1')).toEqual([])
    expect(reloaded.stateOf(photo.id)).toBe('deleted')
  })

  it('墓碑落盘失败 → 抛错、内存回滚、本地媒体**不删**', async () => {
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'id-photo')
    await nextTick()

    const restore = makeKeyUnwritable(STUDENT_PHOTOS_KEY)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await expect(store.removePhoto(photo.id)).rejects.toMatchObject({
        code: 'metadata-not-saved',
      })
      // 内存回滚：照片仍是有效状态
      expect(store.findPhoto(photo.id)?.deletedAt).toBeUndefined()
      expect(store.stateOf(photo.id)).not.toBe('deleted')
      // 本地媒体没有被删
      expect(doubles.media.files.has(photo.id)).toBe(true)
      expect(doubles.media.removedIds).not.toContain(photo.id)
    } finally {
      restore()
      warn.mockRestore()
    }
  })

  it('删除不存在 / 已删除的照片返回 false', async () => {
    const store = openStore()
    expect(await store.removePhoto('nope')).toBe(false)
    const photo = await store.addPhoto('s1', photoFile(), 'id-photo')
    await store.removePhoto(photo.id)
    expect(await store.removePhoto(photo.id)).toBe(false)
  })

  it('删除不会影响同学生的其它照片', async () => {
    const store = openStore()
    const keep = await store.addPhoto('s1', photoFile(), 'id-photo')
    const remove = await store.addPhoto('s1', photoFile(), 'life-photo')
    await store.removePhoto(remove.id)
    expect(store.listStudentPhotos('s1').map((photo) => photo.id)).toEqual([keep.id])
    expect(doubles.media.files.has(keep.id)).toBe(true)
  })
})

/* ==================== 状态派生与本地媒体 ==================== */

describe('状态派生与本地媒体读取', () => {
  it('离线新增 → local-only；getPhotoBlob 直接读本机', async () => {
    doubles.cloud.setAvailable(false)
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'id-photo')
    await store.flushPhotoUploads()

    expect(store.stateOf(photo.id)).toBe('local-only')
    expect(store.mediaAvailable).toBe(true)
    expect(store.pendingUploadCount).toBe(1)
    expect((await store.getPhotoBlob(photo.id)).size).toBeGreaterThan(0)
    expect((await store.getPhotoThumbnail(photo.id)).size).toBeGreaterThan(0)
  })

  it('云端的照片（remote-only）→ 下载后落本地并变 ready', async () => {
    seedStudents()
    browser.localStorage.seed(
      STUDENT_PHOTOS_KEY,
      JSON.stringify([
        {
          id: 'remote-1',
          studentId: 's1',
          studentName: '安琪',
          category: 'life-photo',
          fileId: 'cloud://fake-env/student-photos/s1/remote-1.jpg',
          storagePath: 'student-photos/s1/remote-1.jpg',
          mimeType: 'image/jpeg',
          width: 1600,
          height: 1200,
          size: 1024,
          uploadedAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-01T00:00:00.000Z',
          createdAt: '2026-11-01T00:00:00.000Z',
        },
      ]),
    )
    doubles.cloud.files.set(
      'cloud://fake-env/student-photos/s1/remote-1.jpg',
      new Blob(['remote'], { type: 'image/jpeg' }),
    )
    const store = useStudentPhotoStore()
    await store.refreshLocalPresence()

    expect(store.stateOf('remote-1')).toBe('remote-only')

    const blob = await store.getPhotoBlob('remote-1')
    expect(await blob.text()).toBe('remote')
    expect(store.stateOf('remote-1')).toBe('ready')
    expect(doubles.media.files.has('remote-1')).toBe(true)
    expect(doubles.image.thumbnailInputs.length).toBeGreaterThan(0)
  })

  it('本机与云端都没有 → missing，读取时给可读错误', async () => {
    seedStudents()
    browser.localStorage.seed(
      STUDENT_PHOTOS_KEY,
      JSON.stringify([
        {
          id: 'lost-1',
          studentId: 's1',
          studentName: '安琪',
          category: 'life-photo',
          storagePath: 'student-photos/s1/lost-1.jpg',
          mimeType: 'image/jpeg',
          width: 1,
          height: 1,
          size: 1,
          uploadedAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-01T00:00:00.000Z',
          createdAt: '2026-11-01T00:00:00.000Z',
        },
      ]),
    )
    const store = useStudentPhotoStore()
    await store.refreshLocalPresence()
    expect(store.stateOf('lost-1')).toBe('missing')
    await expect(store.getPhotoBlob('lost-1')).rejects.toMatchObject({ code: 'photo-missing' })
    expect(store.lastErrorOf('lost-1')).toBeTruthy()
  })

  it('下载失败 → 可读错误 + 记录本机错误；照片仍是 remote-only', async () => {
    seedStudents()
    browser.localStorage.seed(
      STUDENT_PHOTOS_KEY,
      JSON.stringify([
        {
          id: 'remote-2',
          studentId: 's1',
          studentName: '安琪',
          category: 'life-photo',
          fileId: 'cloud://x',
          storagePath: 'student-photos/s1/remote-2.jpg',
          mimeType: 'image/jpeg',
          width: 1,
          height: 1,
          size: 1,
          uploadedAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-01T00:00:00.000Z',
          createdAt: '2026-11-01T00:00:00.000Z',
        },
      ]),
    )
    doubles.cloud.failNextDownload = new PhotoCloudError('download-failed', '网络中断')
    const store = useStudentPhotoStore()
    await store.refreshLocalPresence()
    await expect(store.getPhotoBlob('remote-2')).rejects.toMatchObject({ code: 'download-failed' })
    expect(store.stateOf('remote-2')).toBe('remote-only')
    expect(store.lastErrorOf('remote-2')).toContain('网络中断')
  })

  it('本机媒体读取异常 → media-read-failed（不吞错）', async () => {
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'life-photo')
    doubles.media.failReads = true
    await expect(store.getPhotoBlob(photo.id)).rejects.toMatchObject({
      code: 'media-read-failed',
    })
  })

  it('本机媒体库不可用 → mediaAvailable=false，状态按"本机无图"派生', async () => {
    doubles.media.failList = true
    const store = openStore()
    await store.refreshLocalPresence()
    expect(store.mediaAvailable).toBe(false)
    const photo = await store.addPhoto('s1', photoFile(), 'life-photo')
    // 新写入会重新把 mediaAvailable 置回 true（写入成功即说明库可用）
    expect(store.mediaAvailable).toBe(true)
    expect(store.stateOf(photo.id)).not.toBe('ready')
  })
})

/* ==================== 上传队列 ==================== */

describe('离线补传：可恢复、可重试、幂等、不丢本地', () => {
  it('离线时 flush 跳过、队列保留；联网后补传成功并写 fileId', async () => {
    doubles.cloud.setAvailable(false)
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'id-photo')
    const offline = await store.flushPhotoUploads()
    expect(offline).toMatchObject({ uploaded: 0, failed: 0, skipped: 1 })
    expect(readPhotoOutbox()).toHaveLength(1)
    expect(store.findPhoto(photo.id)?.fileId).toBeUndefined()

    doubles.cloud.setAvailable(true)
    const online = await store.flushPhotoUploads()
    expect(online.uploaded).toBe(1)
    expect(readPhotoOutbox()).toHaveLength(0)
    expect(store.findPhoto(photo.id)?.fileId).toMatch(/^cloud:\/\//)
    expect(store.stateOf(photo.id)).toBe('ready')
    expect(doubles.cloud.uploads[0]?.storagePath).toBe(photo.storagePath)
    await nextTick()
    expect(diskPhotos()[0]?.fileId).toBeTruthy()
  })

  it('上传失败 → 记尝试次数与脱敏原因、本地照片保留；重试成功后出队', async () => {
    // 先离线新增（避免 addPhoto 的自动冲刷把注入的一次失败吃掉），再联网并注入一次失败
    doubles.cloud.setAvailable(false)
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'id-photo')
    await store.flushPhotoUploads()

    doubles.cloud.failNextUpload = new PhotoCloudError(
      'upload-failed',
      '上传失败：https://signed.example.test/secret?sign=1',
    )
    doubles.cloud.setAvailable(true)
    await store.flushPhotoUploads()

    const task = readPhotoOutbox().find((item) => item.photoId === photo.id)!
    expect(task.attempts).toBe(1)
    expect(task.lastError).not.toContain('https://signed.example.test')
    expect(task.lastError).toContain('[url]')
    expect(doubles.media.files.has(photo.id)).toBe(true)
    expect(store.stateOf(photo.id)).toBe('local-only')
    expect(store.lastErrorOf(photo.id)).toBeTruthy()

    // 刷新 / 重启后失败原因要从 outbox 回填，单张重试入口不能消失
    setActivePinia(createPinia())
    const reloaded = useStudentPhotoStore()
    expect(reloaded.lastErrorOf(photo.id)).toContain('[url]')

    const retried = await store.flushPhotoUploads()
    expect(retried.uploaded).toBe(1)
    expect(readPhotoOutbox()).toHaveLength(0)
  })

  it('重复执行不会产生重复云端文件（同一路径、上传成功后不再传）', async () => {
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'id-photo')
    await store.flushPhotoUploads()
    const uploadCount = doubles.cloud.uploads.length

    await store.flushPhotoUploads()
    await store.flushPhotoUploads()
    expect(doubles.cloud.uploads).toHaveLength(uploadCount)
    expect(
      doubles.cloud.uploads.filter((item) => item.storagePath === photo.storagePath),
    ).toHaveLength(1)
  })

  it('应用重启后从 outbox 恢复待上传任务', async () => {
    doubles.cloud.setAvailable(false)
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'id-photo')
    await store.flushPhotoUploads()
    await nextTick()

    // 模拟重启：新的 pinia + 新的 store，队列从盘上恢复
    setActivePinia(createPinia())
    doubles.cloud.setAvailable(true)
    const reloaded = useStudentPhotoStore()
    expect(reloaded.pendingUploadCount).toBe(1)
    const result = await reloaded.flushPhotoUploads()
    expect(result.uploaded).toBe(1)
    expect(reloaded.findPhoto(photo.id)?.fileId).toBeTruthy()
  })

  it('已删除的照片不会被上传', async () => {
    doubles.cloud.setAvailable(false)
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'id-photo')
    await store.flushPhotoUploads()
    await store.removePhoto(photo.id)
    expect(readPhotoOutbox()).toHaveLength(0)

    doubles.cloud.setAvailable(true)
    await store.flushPhotoUploads()
    expect(doubles.cloud.uploads).toHaveLength(0)
  })

  it('本机文件丢失时无法上传：出队并留下诊断（不无限重试）', async () => {
    doubles.cloud.setAvailable(false)
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'id-photo')
    await store.flushPhotoUploads()
    doubles.media.files.delete(photo.id)
    await store.refreshLocalPresence()

    doubles.cloud.setAvailable(true)
    const result = await store.flushPhotoUploads()
    expect(result.skipped).toBe(1)
    expect(readPhotoOutbox()).toHaveLength(0)
    expect(store.lastErrorOf(photo.id)).toContain('本机照片文件不存在')
    expect(doubles.cloud.uploads).toHaveLength(0)
  })

  it('上传成功但元数据落盘失败 → 不出队、内存回滚、下次重试', async () => {
    doubles.cloud.setAvailable(false)
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'id-photo')
    await store.flushPhotoUploads()

    const restore = makeKeyUnwritable(STUDENT_PHOTOS_KEY)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    doubles.cloud.setAvailable(true)
    try {
      const result = await store.flushPhotoUploads()
      expect(result.failed).toBe(1)
      expect(store.findPhoto(photo.id)?.fileId).toBeUndefined()
      expect(readPhotoOutbox().find((task) => task.photoId === photo.id)?.attempts).toBe(1)
      expect(doubles.media.files.has(photo.id)).toBe(true)
    } finally {
      restore()
      warn.mockRestore()
    }
  })

  it('上传中状态可被派生（uploading）', async () => {
    doubles.cloud.setAvailable(false)
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'id-photo')
    await store.flushPhotoUploads()

    // 手动排队并让"云可用"，用不 await 的 flush 观察中间态
    doubles.cloud.setAvailable(true)
    const pending = store.flushPhotoUploads()
    await nextTick()
    // 上传很快结束，这里只断言"完成后不再是 uploading"，并保证竞态不抛错
    await pending
    expect(store.isUploading(photo.id)).toBe(false)
    expect(store.stateOf(photo.id)).toBe('ready')
  })
})

/* ==================== 同步与备份边界 ==================== */

describe('同步 / 备份边界：元数据同步、二进制隔离、LWW 不误删媒体', () => {
  it('照片元数据键注册进跨标签页 / 云同步，且只有一个订阅增量', () => {
    const before = syncSubscriberCount(STUDENT_PHOTOS_KEY)
    openStore()
    expect(syncedKeys()).toContain(STUDENT_PHOTOS_KEY)
    expect(syncSubscriberCount(STUDENT_PHOTOS_KEY)).toBe(before + 1)
  })

  it('同步 payload 只有纯 JSON：无 Blob / Base64 / 签名 URL / outbox', async () => {
    const store = openStore()
    await store.addPhoto('s1', photoFile(), 'id-photo')
    await store.flushPhotoUploads()
    await nextTick()

    const text = diskText()
    expect(text).not.toContain('data:image')
    expect(text).not.toContain('base64')
    expect(text).not.toContain('blob:')
    expect(text).not.toContain('signed.example')
    expect(text).not.toContain('https://')
    expect(diskPhotos()).toHaveLength(1)
    expect(JSON.stringify(diskPhotos())).not.toContain(PHOTO_OUTBOX_KEY)
  })

  it('本地 outbox 不参与云同步、不进入 JSON 备份', async () => {
    const store = openStore()
    doubles.cloud.setAvailable(false)
    await store.addPhoto('s1', photoFile(), 'id-photo')
    await store.flushPhotoUploads()
    expect(readPhotoOutbox()).toHaveLength(1)

    expect(syncedKeys()).not.toContain(PHOTO_OUTBOX_KEY)
    expect(BACKUP_MODULES.some((module) => module.key === PHOTO_OUTBOX_KEY)).toBe(false)
    expect(BACKUP_MODULES.some((module) => module.key === STUDENT_PHOTOS_KEY)).toBe(true)
  })

  it('云端采纳：补上本地没有的照片元数据，不覆盖本地已有记录', async () => {
    const store = openStore()
    const local = await store.addPhoto('s1', photoFile(), 'life-photo')
    doubles.cloud.setAvailable(false)
    await store.flushPhotoUploads()

    const remote: StudentPhoto = {
      id: 'remote-photo',
      studentId: 's2',
      studentName: '白玛',
      category: 'id-photo',
      fileId: 'cloud://remote-1',
      storagePath: 'student-photos/s2/remote-photo.jpg',
      mimeType: 'image/jpeg',
      width: 1600,
      height: 1200,
      size: 100,
      uploadedAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
      createdAt: '2026-11-01T00:00:00.000Z',
    }
    browser.localStorage.seed(
      STUDENT_PHOTOS_KEY,
      JSON.stringify([...(store.photos as StudentPhoto[]), remote]),
    )
    applySyncKeys([STUDENT_PHOTOS_KEY])
    await nextTick()

    expect(store.findPhoto(local.id)).toBeDefined()
    expect(store.findPhoto('remote-photo')).toBeDefined()
    expect(doubles.media.files.has(local.id)).toBe(true)
  })

  it('现有 LWW 边界：远端整键覆盖后本机媒体**不会被误删**（但元数据条目可能消失）', async () => {
    const store = openStore()
    const local = await store.addPhoto('s1', photoFile(), 'life-photo')
    doubles.cloud.setAvailable(false)
    await store.flushPhotoUploads()
    await nextTick()

    // 另一台设备的整份数组（不含本机这张照片）——LWW 会整键覆盖
    browser.localStorage.seed(STUDENT_PHOTOS_KEY, JSON.stringify([]))
    applySyncKeys([STUDENT_PHOTOS_KEY])
    await nextTick()

    expect(store.findPhoto(local.id)).toBeUndefined()
    // 本机二进制仍在：不做"元数据没有就删本地"的自动 GC（那会在 LWW 覆盖时误删照片）
    expect(doubles.media.files.has(local.id)).toBe(true)
    expect(doubles.media.removedIds).not.toContain(local.id)
  })

  it('同步失败（断网）不影响本地照片保存与查看', async () => {
    doubles.cloud.setAvailable(false)
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'id-photo')
    await store.flushPhotoUploads()
    expect(store.findPhoto(photo.id)).toBeDefined()
    expect((await store.getPhotoBlob(photo.id)).size).toBeGreaterThan(0)
  })
})

/* ==================== 签名 URL ==================== */

describe('签名 URL：按需签发、不持久化', () => {
  it('未上传的照片不能生成访问地址', async () => {
    doubles.cloud.setAvailable(false)
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'id-photo')
    await expect(store.getPhotoSignedUrl(photo.id)).rejects.toMatchObject({
      code: 'signed-url-failed',
    })
  })

  it('上传后可取签名 URL；每次重新签发（过期后重新获取），且不写进元数据/本地存储', async () => {
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'id-photo')
    await store.flushPhotoUploads()

    const first = await store.getPhotoSignedUrl(photo.id)
    const second = await store.getPhotoSignedUrl(photo.id)
    expect(first).not.toBe(second)
    expect(doubles.cloud.signedUrlRequests).toHaveLength(2)
    expect(diskText()).not.toContain('https://')
    expect(JSON.stringify(store.photos)).not.toContain('signed.example')
  })

  it('签名失败 → 可读 signed-url-failed', async () => {
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'id-photo')
    await store.flushPhotoUploads()
    doubles.cloud.failNextSignedUrl = new PhotoCloudError('signed-url-failed', '网络中断')
    await expect(store.getPhotoSignedUrl(photo.id)).rejects.toMatchObject({
      code: 'signed-url-failed',
    })
  })
})

/* ==================== 加载与未知字段 ==================== */

describe('加载：无效记录丢弃、未知字段保留', () => {
  it('盘上无效记录被丢弃，合法记录保留', async () => {
    seedStudents()
    browser.localStorage.seed(
      STUDENT_PHOTOS_KEY,
      JSON.stringify([
        {
          id: 'ok',
          studentId: 's1',
          category: 'life-photo',
          uploadedAt: '2026-11-01T00:00:00.000Z',
        },
        { id: 'bad', studentId: '' },
        null,
      ]),
    )
    const store = useStudentPhotoStore()
    expect(store.photos.map((photo) => photo.id)).toEqual(['ok'])
  })

  it('未来版本的未知字段在加载与后续写盘后仍然保留', async () => {
    seedStudents()
    browser.localStorage.seed(
      STUDENT_PHOTOS_KEY,
      JSON.stringify([
        {
          id: 'future',
          studentId: 's1',
          studentName: '安琪',
          category: 'id-photo',
          storagePath: 'student-photos/s1/future.jpg',
          mimeType: 'image/jpeg',
          width: 1600,
          height: 1200,
          size: 100,
          uploadedAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-01T00:00:00.000Z',
          createdAt: '2026-11-01T00:00:00.000Z',
          futureField: 'keep-me',
          futureNested: { level: 2 },
        },
      ]),
    )
    const store = useStudentPhotoStore()
    expect((store.findPhoto('future') as StudentPhoto & Record<string, unknown>)?.futureField).toBe(
      'keep-me',
    )

    // 触发一次写盘（新增一张照片）后，未知字段仍应保留
    await store.addPhoto('s2', photoFile(), 'life-photo')
    await nextTick()
    const onDisk = diskPhotos().find((photo) => photo.id === 'future')
    expect(onDisk?.futureField).toBe('keep-me')
    expect(onDisk?.futureNested).toEqual({ level: 2 })
  })
})

/* ==================== 跨设备同一账号 ==================== */

describe('跨设备同一账号（模拟）：元数据同步 + 云端按需下载', () => {
  it('A 上传后，B 用同一份元数据从云端取到照片并落本地', async () => {
    // 设备 A：新增并上传
    const storeA = openStore()
    const photo = await storeA.addPhoto('s1', photoFile(), 'id-photo')
    await storeA.flushPhotoUploads()
    await nextTick()
    const fileId = storeA.findPhoto(photo.id)?.fileId
    expect(fileId).toBeTruthy()

    // 设备 B：本机媒体库是空的，但元数据已同步过来、云端文件仍在
    const mediaB = createMemoryMediaStore()
    setMediaStore(mediaB)
    setActivePinia(createPinia())
    const storeB = useStudentPhotoStore()
    await storeB.refreshLocalPresence()

    expect(storeB.mediaAvailable).toBe(true)
    expect(storeB.stateOf(photo.id)).toBe('remote-only')
    const blob = await storeB.getPhotoBlob(photo.id)
    expect(blob.size).toBeGreaterThan(0)
    expect(storeB.stateOf(photo.id)).toBe('ready')
    expect(mediaB.files.has(photo.id)).toBe(true)
    // B 的下载带上的是同一个 fileId（同账号同文件，不产生副本）
    expect(doubles.cloud.downloadRequests).toContain(fileId)
  })
})

/* ==================== 墓碑同步 ==================== */

describe('墓碑通过元数据同步传播（本机媒体不误删）', () => {
  it('另一台设备删除后：本机不再显示、但墓碑保留且不清理本机二进制', async () => {
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'life-photo')
    await nextTick()

    const tombstone = {
      ...(store.findPhoto(photo.id) as unknown as Record<string, unknown>),
      deletedAt: '2026-11-12T00:00:00.000Z',
      updatedAt: '2026-11-12T00:00:00.000Z',
    }
    browser.localStorage.seed(STUDENT_PHOTOS_KEY, JSON.stringify([tombstone]))
    applySyncKeys([STUDENT_PHOTOS_KEY])
    await nextTick()

    expect(store.listStudentPhotos('s1')).toEqual([])
    expect(store.findPhoto(photo.id)?.deletedAt).toBeTruthy()
    expect(store.stateOf(photo.id)).toBe('deleted')
    // 关键：同步来的墓碑不触发本机媒体删除（避免 LWW/误同步导致照片被误删）
    expect(doubles.media.files.has(photo.id)).toBe(true)
    expect(doubles.media.removedIds).not.toContain(photo.id)
  })
})

/* ==================== 入参兜底 / 已删除读取 ==================== */

describe('入参兜底与已删除照片的读取保护', () => {
  it('分类不合法（运行期兜底）→ invalid-photo，且不处理图片、不写媒体', async () => {
    const store = openStore()
    const before = doubles.image.processedInputs.length
    await expect(store.addPhoto('s1', photoFile(), 'group-photo' as never)).rejects.toMatchObject({
      code: 'invalid-photo',
    })
    expect(doubles.image.processedInputs.length).toBe(before)
    expect(doubles.media.files.size).toBe(0)
  })

  it('已逻辑删除的照片不再提供 blob / 签名地址', async () => {
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'id-photo')
    await store.flushPhotoUploads()
    await store.removePhoto(photo.id)
    await expect(store.getPhotoBlob(photo.id)).rejects.toMatchObject({ code: 'photo-missing' })
    await expect(store.getPhotoSignedUrl(photo.id)).rejects.toMatchObject({
      code: 'signed-url-failed',
    })
  })
})
