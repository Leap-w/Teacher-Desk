/**
 * 学生照片 UI 逻辑自检（v3.8.0 · Phase 2）。
 *
 * 分两层：
 * 1. `utils/photoUi.ts` 纯函数：状态文案（remote-only ≠ 缺失）、照片墙行、大图顺序、
 *    批量上传编排（失败不中断 / 取消只取消未开始的）；
 * 2. 真实 `useStudentPhotoStore()` + Phase 1B 测试替身联调：上传、批量上传、当前证件照、
 *    历史保留、生活照不能设为当前、逻辑删除、离线状态、跨设备 remote-only。
 */
import { nextTick } from 'vue'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { installFakeBrowser, type FakeBrowser } from './helpers/env'
import {
  installPhotoTestDoubles,
  resetPhotoTestDoubles,
  type PhotoTestDoubles,
} from './helpers/photoDoubles'
import { appConfig } from '@/config'
import { STUDENT_PHOTOS_KEY } from '@/repositories'
import { useStudentPhotoStore } from '@/stores/studentPhoto'
import { useStudentStore } from '@/stores/student'
import { MediaStoreError } from '@/services/mediaStore'
import type { Student } from '@/types'
import type { StudentPhoto } from '@/types/studentPhoto'
import {
  PHOTO_BACKUP_NOTICE,
  PHOTO_CATEGORY_FILTER_OPTIONS,
  PHOTO_STATE_VIEW,
  buildClassPhotoWall,
  buildPhotoViewerSequence,
  canUploadLocalPhoto,
  filterStudentPhotos,
  formatPhotoUploadedAt,
  photoCountSummary,
  photoStatusView,
  photoViewerIndexOf,
  runPhotoUploadBatch,
  stepPhotoViewer,
  summarizePhotoUploadBatch,
  toPhotoUploadItems,
  type PhotoUploadBatchResult,
} from '@/utils/photoUi'

const prefix = appConfig.storageKeyPrefix
const STUDENTS_KEY = `${prefix}:students`

let browser: FakeBrowser
let doubles: PhotoTestDoubles

function student(id: string, name: string, extra: Partial<Student> = {}): Student {
  return { id, name, studentNo: '', gender: 'male', ...extra }
}

function seedStudents(roster: Student[]): void {
  browser.localStorage.seed(STUDENTS_KEY, JSON.stringify(roster))
}

function openStore(roster: Student[] = [student('s1', '安琪'), student('s2', '白玛')]) {
  seedStudents(roster)
  return useStudentPhotoStore()
}

function photoFile(size = 2048): File {
  return new File([new Uint8Array(size)], 'photo.jpg', { type: 'image/jpeg' })
}

function rawPhoto(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    studentId: 's1',
    studentName: '安琪',
    category: 'id-photo',
    storagePath: `student-photos/s1/${id}.jpg`,
    mimeType: 'image/jpeg',
    width: 1600,
    height: 1200,
    size: 1024,
    uploadedAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    createdAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  }
}

function asPhoto(id: string, overrides: Partial<StudentPhoto> = {}): StudentPhoto {
  return rawPhoto(id, overrides) as unknown as StudentPhoto
}

beforeEach(() => {
  browser = installFakeBrowser()
  setActivePinia(createPinia())
  doubles = installPhotoTestDoubles()
})

afterEach(() => {
  resetPhotoTestDoubles()
})

/* ==================== 状态文案 ==================== */

describe('媒体状态文案：普通教师能看懂，且不把 remote-only 说成缺失', () => {
  it('六种派生状态都有文字（不能只靠颜色）', () => {
    for (const state of [
      'ready',
      'local-only',
      'remote-only',
      'uploading',
      'missing',
      'deleted',
    ] as const) {
      expect(PHOTO_STATE_VIEW[state].label.length).toBeGreaterThan(0)
      expect(PHOTO_STATE_VIEW[state].description.length).toBeGreaterThan(0)
    }
  })

  it('remote-only 是"仅云端保存"，不是照片缺失', () => {
    expect(photoStatusView('remote-only').label).toBe('仅云端保存')
    expect(photoStatusView('remote-only').label).not.toBe(photoStatusView('missing').label)
    expect(photoStatusView('remote-only').tone).toBe('info')
    expect(photoStatusView('missing').label).toBe('照片缺失')
  })

  it('只有 local-only + 有失败原因时才显示"上传失败"', () => {
    expect(photoStatusView('local-only').label).toBe('仅本机保存')
    const failed = photoStatusView('local-only', '网络中断')
    expect(failed.kind).toBe('upload-failed')
    expect(failed.label).toContain('上传失败')
    expect(failed.label).toContain('已存本机')
    expect(failed.description).toContain('网络中断')

    // 已上传成功时残留的旧错误提示不应把成功说成失败
    expect(photoStatusView('ready', '旧错误').kind).toBe('ready')
  })

  it('备份提示明确不含照片文件', () => {
    expect(PHOTO_BACKUP_NOTICE).toContain('仅包含照片信息')
    expect(PHOTO_BACKUP_NOTICE).toContain('不包含照片文件')
  })

  it('恢复出的「仅本机」照片有上传入口；其它状态不重复出入口', () => {
    expect(canUploadLocalPhoto('local-only')).toBe(true)
    for (const state of ['ready', 'remote-only', 'uploading', 'missing', 'deleted'] as const) {
      expect(canUploadLocalPhoto(state)).toBe(false)
    }
  })
})

/* ==================== 分类 / 时间 ==================== */

describe('分类视图与上传时间', () => {
  it('三个分类视图：证件照 / 生活照 / 全部', () => {
    expect(PHOTO_CATEGORY_FILTER_OPTIONS.map((item) => item.value)).toEqual([
      'id-photo',
      'life-photo',
      'all',
    ])
  })

  it('按分类筛选，全部包含两类；当前证件照优先排序', () => {
    const photos = [
      asPhoto('life-old', { category: 'life-photo', uploadedAt: '2026-10-01T00:00:00.000Z' }),
      asPhoto('current', { isCurrentIdPhoto: true, uploadedAt: '2026-10-02T00:00:00.000Z' }),
      asPhoto('id-old', { uploadedAt: '2026-10-03T00:00:00.000Z' }),
    ]
    expect(filterStudentPhotos(photos, 'all').map((photo) => photo.id)).toEqual([
      'current',
      'id-old',
      'life-old',
    ])
    expect(filterStudentPhotos(photos, 'id-photo').map((photo) => photo.id)).toEqual([
      'current',
      'id-old',
    ])
    expect(filterStudentPhotos(photos, 'life-photo').map((photo) => photo.id)).toEqual(['life-old'])
  })

  it('上传时间按本地时间显示（元数据仍是原 ISO）', () => {
    const local = new Date(2026, 10, 13, 9, 5)
    expect(formatPhotoUploadedAt(local.toISOString())).toBe('2026-11-13 09:05')
  })

  it('数量摘要只数有效照片', () => {
    const photos = [
      asPhoto('a'),
      asPhoto('b', { category: 'life-photo' }),
      asPhoto('c', { category: 'life-photo', deletedAt: '2026-11-10T00:00:00.000Z' }),
    ]
    expect(photoCountSummary(photos)).toBe('证件照 1 · 生活照 1')
    expect(photoCountSummary([])).toBe('证件照 0 · 生活照 0')
  })
})

/* ==================== 照片墙 ==================== */

describe('班级照片墙行：当前证件照优先、没有就占位', () => {
  const students = [student('s1', '安琪'), student('s2', '白玛'), student('s3', '扎西')]
  const photos = [
    asPhoto('current', { studentId: 's1', isCurrentIdPhoto: true }),
    asPhoto('id-old', { studentId: 's1', uploadedAt: '2026-10-01T00:00:00.000Z' }),
    asPhoto('life', { studentId: 's1', category: 'life-photo' }),
    // s2 只有生活照：**不能拿生活照冒充证件照**
    asPhoto('life-only', { studentId: 's2', category: 'life-photo' }),
    asPhoto('id-candidate', {
      studentId: 's2',
      uploadedAt: '2026-10-02T00:00:00.000Z',
      // 历史证件照但**不是当前** → 照片墙仍显示占位
    }),
  ]

  it('当前证件照优先；没有当前证件照就占位（不用生活照、不用历史证件照冒充）', () => {
    const rows = buildClassPhotoWall(students, photos)
    expect(rows.map((row) => row.student.id)).toEqual(['s1', 's2', 's3'])
    expect(rows[0]?.currentPhoto?.id).toBe('current')
    expect(rows[1]?.currentPhoto).toBeUndefined()
    expect(rows[2]?.currentPhoto).toBeUndefined()
  })

  it('每名学生的有效照片数量正确', () => {
    const rows = buildClassPhotoWall(students, photos)
    expect(rows[0]?.photoCount).toBe(3)
    expect(rows[1]?.photoCount).toBe(2)
    expect(rows[2]?.photoCount).toBe(0)
  })

  it('已软删除学生不在传入名册 → 不进入照片墙', () => {
    const rows = buildClassPhotoWall(
      students.filter((item) => item.id !== 's1'),
      photos,
    )
    expect(rows.some((row) => row.student.id === 's1')).toBe(false)
  })
})

/* ==================== 大图浏览 ==================== */

describe('大图查看：顺序 / 上一张 / 下一张 / 首尾循环', () => {
  const photos = [
    asPhoto('a', { uploadedAt: '2026-10-01T00:00:00.000Z' }),
    asPhoto('b', { uploadedAt: '2026-10-03T00:00:00.000Z' }),
    asPhoto('c', { uploadedAt: '2026-10-02T00:00:00.000Z' }),
  ]

  it('顺序与照片列表一致（当前证件照优先 → 上传时间倒序）', () => {
    expect(buildPhotoViewerSequence(photos).map((photo) => photo.id)).toEqual(['b', 'c', 'a'])
  })

  it('下一张 / 上一张；首尾循环；空序列安全', () => {
    const sequence = buildPhotoViewerSequence(photos)
    expect(stepPhotoViewer(sequence, 'b', 1)).toBe('c')
    expect(stepPhotoViewer(sequence, 'b', -1)).toBe('a')
    expect(stepPhotoViewer(sequence, 'a', 1)).toBe('b')
    expect(stepPhotoViewer(sequence, 'b', 2)).toBe('a')
    expect(stepPhotoViewer([], 'x', 1)).toBeUndefined()
    expect(photoViewerIndexOf(sequence, 'c')).toBe(1)
  })

  it('已删除照片不出现在大图序列里', () => {
    const sequence = buildPhotoViewerSequence([
      ...photos,
      asPhoto('deleted', { deletedAt: '2026-11-01T00:00:00.000Z' }),
    ])
    expect(sequence.some((photo) => photo.id === 'deleted')).toBe(false)
  })
})

/* ==================== 批量上传编排 ==================== */

describe('批量上传：逐张反馈、失败不中断、取消只取消未开始的', () => {
  const items = toPhotoUploadItems([
    new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
    new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
    new File(['c'], 'c.jpg', { type: 'image/jpeg' }),
  ])

  it('全部成功：按顺序逐张调用，进度回调完整', async () => {
    const calls: string[] = []
    const progress: number[] = []
    const result = await runPhotoUploadBatch(
      items,
      async (item) => {
        calls.push(item.fileName)
        return { photoId: `photo-${item.fileName}` }
      },
      { onProgress: (done) => progress.push(done) },
    )
    expect(calls).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    expect(result.results.every((item) => item.ok)).toBe(true)
    expect(result.cancelled).toBe(false)
    expect(progress).toContain(0)
    expect(progress).toContain(3)
  })

  it('一张失败不影响其它张（成功的不丢）', async () => {
    const result = await runPhotoUploadBatch(items, async (item) => {
      if (item.fileName === 'b.jpg') throw new Error('模拟失败')
      return { photoId: `photo-${item.fileName}` }
    })
    const summary = summarizePhotoUploadBatch(result)
    expect(summary.success).toBe(2)
    expect(summary.failed).toBe(1)
    expect(summary.failedFiles[0]).toMatchObject({ fileName: 'b.jpg', error: '模拟失败' })
    expect(result.results.filter((item) => item.ok).map((item) => item.fileName)).toEqual([
      'a.jpg',
      'c.jpg',
    ])
  })

  it('取消只取消尚未开始的照片，已成功的保留', async () => {
    let uploaded = 0
    const result = await runPhotoUploadBatch(
      items,
      async () => {
        uploaded += 1
        return { photoId: `p${uploaded}` }
      },
      { shouldCancel: () => uploaded >= 1 },
    )
    expect(uploaded).toBe(1)
    expect(result.cancelled).toBe(true)
    expect(result.results).toHaveLength(1)
    expect(summarizePhotoUploadBatch(result)).toMatchObject({ success: 1, failed: 0 })
  })

  it('空文件列表不会调用上传', async () => {
    let called = false
    const result = await runPhotoUploadBatch([], async () => {
      called = true
      return { photoId: 'x' }
    })
    expect(called).toBe(false)
    expect(result.results).toEqual([])
    expect(result.cancelled).toBe(false)
  })
})

/* ==================== 与真实 Store 联调 ==================== */

describe('上传 / 当前证件照 / 历史保留（真实 Store）', () => {
  it('上传证件照与生活照：分类正确，新证件照不会自动成为当前', async () => {
    const store = openStore()
    const idPhoto = await store.addPhoto('s1', photoFile(), 'id-photo')
    const lifePhoto = await store.addPhoto('s1', photoFile(), 'life-photo')

    expect(store.listStudentPhotos('s1', 'id-photo').map((photo) => photo.id)).toEqual([idPhoto.id])
    expect(store.listStudentPhotos('s1', 'life-photo').map((photo) => photo.id)).toEqual([
      lifePhoto.id,
    ])
    expect(store.currentIdPhoto('s1')).toBeUndefined()
    expect(store.listStudentPhotos('s1')).toHaveLength(2)
  })

  it('设置当前证件照 → 更换：旧的变历史但保留；生活照不能设为当前', async () => {
    const store = openStore()
    const first = await store.addPhoto('s1', photoFile(), 'id-photo')
    const second = await store.addPhoto('s1', photoFile(), 'id-photo')
    const life = await store.addPhoto('s1', photoFile(), 'life-photo')

    await store.setCurrentIdPhoto('s1', first.id)
    expect(store.currentIdPhoto('s1')?.id).toBe(first.id)

    await store.setCurrentIdPhoto('s1', second.id)
    expect(store.currentIdPhoto('s1')?.id).toBe(second.id)
    expect(store.findPhoto(first.id)?.isCurrentIdPhoto).toBeUndefined()
    expect(store.listStudentPhotos('s1')).toHaveLength(3)

    await expect(store.setCurrentIdPhoto('s1', life.id)).rejects.toMatchObject({
      code: 'current-photo-invalid',
    })
  })

  it('删除当前证件照：列表消失、当前标记不悬空、生活照不受影响', async () => {
    const store = openStore()
    const current = await store.addPhoto('s1', photoFile(), 'id-photo')
    const life = await store.addPhoto('s1', photoFile(), 'life-photo')
    await store.setCurrentIdPhoto('s1', current.id)

    await store.removePhoto(current.id)
    expect(store.currentIdPhoto('s1')).toBeUndefined()
    expect(store.listStudentPhotos('s1').map((photo) => photo.id)).toEqual([life.id])
    expect(store.stateOf(current.id)).toBe('deleted')
    await nextTick()
    // 墓碑留在盘上，照片文件不会被"物理删除云端"（本版本无云端删除调用）
    expect(browser.localStorage.getItem(STUDENT_PHOTOS_KEY)).toContain('deletedAt')
  })
})

describe('批量上传（真实 Store）：部分失败继续、成功后刷新列表', () => {
  it('3 张里第 2 张失败，第 1/3 张成功，失败原因可展示', async () => {
    const store = openStore()
    const files = [photoFile(), photoFile(), photoFile()].map(
      (file, index) => new File([file], `p${index + 1}.jpg`, { type: 'image/jpeg' }),
    )
    const items = toPhotoUploadItems(files)

    // 第 2 张的本地媒体写入失败（模拟配额不足，走真实 Store 的错误路径），其余正常
    let index = 0
    const result: PhotoUploadBatchResult = await runPhotoUploadBatch(items, async (item) => {
      index += 1
      if (index === 2) {
        doubles.media.failNextSave = new MediaStoreError('quota', '本机存储空间不足')
      }
      const photo = await store.addPhoto('s1', item.file, 'id-photo')
      return { photoId: photo.id }
    })

    const summary = summarizePhotoUploadBatch(result)
    expect(summary.success).toBe(2)
    expect(summary.failed).toBe(1)
    expect(summary.failedFiles[0]?.fileName).toBe('p2.jpg')
    expect(store.listStudentPhotos('s1')).toHaveLength(2)
    // 成功的两张都关联到同一名学生，未串到别人
    expect(store.listStudentPhotos('s1').every((photo) => photo.studentId === 's1')).toBe(true)
  })
})

describe('状态派生（真实 Store）：only-local / remote-only / missing 区分', () => {
  it('离线新增 → local-only，本地仍可查看', async () => {
    doubles.cloud.setAvailable(false)
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'id-photo')
    await store.flushPhotoUploads()
    expect(store.stateOf(photo.id)).toBe('local-only')
    expect((await store.getPhotoBlob(photo.id)).size).toBeGreaterThan(0)
  })

  it('仅云端（换设备恢复）→ remote-only，下载后可查看并变 ready，不显示为缺失', async () => {
    const fileId = 'cloud://fake-env/student-photos/s1/remote.jpg'
    seedStudents([student('s1', '安琪')])
    browser.localStorage.seed(STUDENT_PHOTOS_KEY, JSON.stringify([rawPhoto('remote', { fileId })]))
    doubles.cloud.files.set(fileId, new Blob(['remote'], { type: 'image/jpeg' }))

    const store = useStudentPhotoStore()
    await store.refreshLocalPresence()
    expect(store.stateOf('remote')).toBe('remote-only')
    expect(photoStatusView(store.stateOf('remote')).label).not.toBe('照片缺失')

    await store.getPhotoBlob('remote')
    expect(store.stateOf('remote')).toBe('ready')
  })

  it('本机与云端都没有 → missing，界面显示缺失文案', async () => {
    seedStudents([student('s1', '安琪')])
    browser.localStorage.seed(STUDENT_PHOTOS_KEY, JSON.stringify([rawPhoto('lost')]))
    const store = useStudentPhotoStore()
    await store.refreshLocalPresence()
    expect(store.stateOf('lost')).toBe('missing')
    expect(photoStatusView('missing').label).toBe('照片缺失')
  })
})

describe('软删除学生照片历史可查', () => {
  it('学生退档后照片仍在数据层（历史档案可查看），但不能再上传', async () => {
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'id-photo')
    const studentStore = useStudentStore()
    studentStore.removeStudent('s1')

    expect(store.listStudentPhotos('s1').map((item) => item.id)).toEqual([photo.id])
    await expect(store.addPhoto('s1', photoFile(), 'id-photo')).rejects.toMatchObject({
      code: 'student-not-found',
    })
  })
})
