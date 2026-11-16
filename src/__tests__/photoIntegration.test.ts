/**
 * 学生照片跨阶段集成自检（v3.8.2 · Phase 3）。
 *
 * Phase 1 的「自动分类 / 当前证件照 / 手动调整」与 Phase 2 的「按文件名批量导入」
 * 分别有各自的单测（studentPhotoStore / photoImport），但两者的**交叉**没有：
 * 批量导入最终是把 `buildPhotoImportPlan` 的行喂给 `store.addPhoto`，分类与当前标记
 * 由 Phase 1 的 Store 规则决定。这里用真实 Store + 假媒体/云端替身把整条链串起来测：
 *
 * - 批量导入无类型照片：首张证件照+当前、其后生活照（严格串行得到的顺序）；
 * - 批量导入显式证件照 / 生活照：显式优先、已有当前不被覆盖；
 * - 批量导入后 `setCategory` / `setCurrentIdPhoto` / `removePhoto` 与照片墙派生；
 * - 不同学生互不影响；软删学生不会被导入命中；
 * - 单张失败不回滚其它成功照片、取消不删成功照片、outbox 无重复 photoId。
 *
 * 这是「集成」测试，不重复单点的解析矩阵 / 备份 schema 断言（那些已各有常驻测试）。
 */
import { nextTick } from 'vue'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installFakeBrowser, type FakeBrowser } from './helpers/env'
import { installPhotoTestDoubles, resetPhotoTestDoubles } from './helpers/photoDoubles'
import { appConfig } from '@/config'
import { STUDENT_PHOTOS_KEY } from '@/repositories'
import { readRaw } from '@/services/storage'
import { readPhotoOutbox } from '@/services/photoOutbox'
import { buildPhotoImportPlan, executePhotoImport } from '@/services/photoImport'
import { useStudentPhotoStore } from '@/stores/studentPhoto'
import { useStudentStore } from '@/stores/student'
import { buildClassPhotoWall, filterStudentPhotos } from '@/utils/photoUi'
import type { Student } from '@/types'
import type { StudentPhoto } from '@/types/studentPhoto'

const prefix = appConfig.storageKeyPrefix
const STUDENTS_KEY = `${prefix}:students`
const ID = '540102199001011234'

let browser: FakeBrowser

function student(id: string, name: string, extra: Partial<Student> = {}): Student {
  return { id, name, studentNo: '', gender: 'male', ...extra }
}

function seedStudents(roster: Student[]): void {
  browser.localStorage.seed(STUDENTS_KEY, JSON.stringify(roster))
}

function file(name: string): File {
  return new File([new Uint8Array(64)], name, { type: 'image/jpeg' })
}

/** 造一个计划 + 真 Store 的导入执行器（addOne 直接接 store.addPhoto） */
function importer(store: ReturnType<typeof useStudentPhotoStore>) {
  return async (names: string[], active: Student[] = roster()) => {
    const nameCounts = new Map<string, number>()
    for (const s of active) nameCounts.set(s.name, (nameCounts.get(s.name) ?? 0) + 1)
    const plan = buildPhotoImportPlan(names.map(file), {
      activeStudents: active,
      nameCounts,
      existingPhotos: store.photos,
    })
    const execution = await executePhotoImport(plan.rows, async (row) => {
      const photo = await store.addPhoto(row.studentId!, row.file, row.category)
      return { photoId: photo.id }
    })
    return { plan, execution }
  }
}

function roster(): Student[] {
  return [student('s1', '李明'), student('s2', '张浩然')]
}

function diskPhotos(): StudentPhoto[] {
  const raw = readRaw(STUDENT_PHOTOS_KEY)
  return raw ? (JSON.parse(raw) as StudentPhoto[]) : []
}

beforeEach(() => {
  browser = installFakeBrowser()
  setActivePinia(createPinia())
  // 离线：避免后台补传成功写 fileId / updatedAt 干扰分类与当前标记的断言
  installPhotoTestDoubles({ cloud: { available: false } })
})

afterEach(() => {
  resetPhotoTestDoubles()
})

describe('批量导入 × 自动分类（Phase 1 × Phase 2 交叉）', () => {
  it('批量无类型照片：首张证件照并成为当前，其后生活照；严格串行级联', async () => {
    seedStudents(roster())
    const store = useStudentPhotoStore()
    const { execution } = await importer(store)([
      `9班-李明-${ID}.jpg`,
      `9班-李明-${ID}.jpg`,
      `9班-李明-${ID}.jpg`,
    ])
    expect(execution.success).toBe(3)
    const photos = store.listStudentPhotos('s1')
    expect(photos.map((p) => p.category)).toEqual(['id-photo', 'life-photo', 'life-photo'])
    const current = store.currentIdPhoto('s1')
    expect(current?.category).toBe('id-photo')
  })

  it('批量显式证件照：成为当前；显式生活照不成为当前', async () => {
    seedStudents(roster())
    const store = useStudentPhotoStore()
    await importer(store)([`9班-李明-${ID}-生活照.jpg`, `9班-李明-${ID}-证件照.jpg`])
    const life = store.listStudentPhotos('s1', 'life-photo')
    expect(life).toHaveLength(1)
    expect(life[0]!.isCurrentIdPhoto).not.toBe(true)
    const current = store.currentIdPhoto('s1')
    expect(current?.category).toBe('id-photo')
  })

  it('已有当前证件照时，后续批量证件照不覆盖手动指定', async () => {
    seedStudents(roster())
    const store = useStudentPhotoStore()
    // 先手动指定一张为当前
    const first = await store.addPhoto('s1', file('x.jpg'), 'id-photo')
    await store.setCurrentIdPhoto('s1', first.id)
    const { execution } = await importer(store)([
      `9班-李明-${ID}-证件照.jpg`,
      `9班-李明-${ID}-证件照.jpg`,
    ])
    expect(execution.success).toBe(2)
    expect(store.currentIdPhoto('s1')?.id).toBe(first.id)
    expect(store.listStudentPhotos('s1', 'id-photo')).toHaveLength(3)
  })

  it('不同学生互不影响：各自首张独立判为证件照', async () => {
    seedStudents(roster())
    const store = useStudentPhotoStore()
    await importer(store)([`9班-李明-${ID}.jpg`, `9班-张浩然-${ID}.jpg`])
    expect(store.listStudentPhotos('s1').map((p) => p.category)).toEqual(['id-photo'])
    expect(store.listStudentPhotos('s2').map((p) => p.category)).toEqual(['id-photo'])
    expect(store.currentIdPhoto('s1')?.id).not.toBe(store.currentIdPhoto('s2')?.id)
  })

  it('软删除学生不会被自动匹配，整行需人工确认', async () => {
    const active = [student('s1', '李明')]
    seedStudents([...active, student('s9', '张浩然', { deletedAt: '2026-01-01T00:00:00.000Z' })])
    const store = useStudentPhotoStore()
    const { plan } = await importer(store)([`9班-张浩然-${ID}.jpg`], active)
    expect(plan.rows[0]!.action).toBe('need-choice')
    expect(plan.rows[0]!.candidates.map((s) => s.id)).not.toContain('s9')
    expect(store.listStudentPhotos('s9')).toHaveLength(0)
  })
})

describe('批量导入后手动操作与照片墙派生', () => {
  it('批量导入后可改分类：当前证件照降级清标记，照片墙计数即时更新', async () => {
    seedStudents(roster())
    const store = useStudentPhotoStore()
    await importer(store)([`9班-李明-${ID}-证件照.jpg`])
    const before = store.currentIdPhoto('s1')!
    expect(before.isCurrentIdPhoto).toBe(true)

    await store.setCategory(before.id, 'life-photo')
    await nextTick()
    expect(store.currentIdPhoto('s1')).toBeUndefined()
    expect(store.listStudentPhotos('s1', 'life-photo')).toHaveLength(1)

    const wall = buildClassPhotoWall(useStudentStore().activeStudents, store.photos)
    const row = wall.find((r) => r.student.id === 's1')!
    expect(row.currentPhoto).toBeUndefined()
    expect(row.photoCount).toBe(1)
    expect(filterStudentPhotos(store.listStudentPhotos('s1'), 'id-photo')).toHaveLength(0)
  })

  it('更换当前证件照后，照片墙显示新那张，旧那张仍保留', async () => {
    seedStudents(roster())
    const store = useStudentPhotoStore()
    await importer(store)([`9班-李明-${ID}-证件照.jpg`, `9班-李明-${ID}-证件照.jpg`])
    const idPhotos = store.listStudentPhotos('s1', 'id-photo')
    expect(idPhotos).toHaveLength(2)
    const old = store.currentIdPhoto('s1')!
    const next = idPhotos.find((p) => p.id !== old.id)!
    await store.setCurrentIdPhoto('s1', next.id)
    await nextTick()
    expect(store.currentIdPhoto('s1')?.id).toBe(next.id)
    const wall = buildClassPhotoWall(useStudentStore().activeStudents, store.photos)
    expect(wall.find((r) => r.student.id === 's1')!.currentPhoto?.id).toBe(next.id)
  })

  it('删除当前证件照后不留下悬空标记，其余照片状态正确', async () => {
    seedStudents(roster())
    const store = useStudentPhotoStore()
    await importer(store)([`9班-李明-${ID}-证件照.jpg`, `9班-李明-${ID}-生活照.jpg`])
    const current = store.currentIdPhoto('s1')!
    await store.removePhoto(current.id)
    await nextTick()
    expect(store.currentIdPhoto('s1')).toBeUndefined()
    expect(store.listStudentPhotos('s1')).toHaveLength(1)
    expect(store.listStudentPhotos('s1')[0]!.category).toBe('life-photo')
  })
})

describe('批量导入失败 / 取消 / 队列安全', () => {
  it('单张失败不回滚其它成功照片；成功次数与盘上记录一致', async () => {
    seedStudents(roster())
    const store = useStudentPhotoStore()
    const names = [`9班-李明-${ID}.jpg`, `9班-张浩然-${ID}.jpg`]
    const studentStore = useStudentStore()
    const plan = buildPhotoImportPlan(names.map(file), {
      activeStudents: studentStore.activeStudents,
      nameCounts: studentStore.nameCounts,
      existingPhotos: store.photos,
    })
    const original = store.addPhoto.bind(store)
    let call = 0
    const spy = vi.spyOn(store, 'addPhoto').mockImplementation(async (sid, f, cat) => {
      call += 1
      if (call === 1) throw new Error('模拟第一张落盘失败')
      return original(sid, f, cat)
    })
    const execution = await executePhotoImport(plan.rows, async (row) => {
      const photo = await store.addPhoto(row.studentId!, row.file, row.category)
      return { photoId: photo.id }
    })
    expect(execution.success).toBe(1)
    expect(execution.failed).toBe(1)
    expect(store.listStudentPhotos('s2')).toHaveLength(1)
    expect(diskPhotos().filter((p) => !p.deletedAt)).toHaveLength(1)
    spy.mockRestore()
  })

  it('取消只停未开始项，已成功导入的照片保留；outbox 无重复 photoId', async () => {
    seedStudents(roster())
    const store = useStudentPhotoStore()
    const names = [`9班-李明-${ID}.jpg`, `9班-张浩然-${ID}.jpg`, `9班-李明-${ID}.jpg`]
    const studentStore = useStudentStore()
    const plan = buildPhotoImportPlan(names.map(file), {
      activeStudents: studentStore.activeStudents,
      nameCounts: studentStore.nameCounts,
      existingPhotos: store.photos,
    })
    let done = 0
    const execution = await executePhotoImport(
      plan.rows,
      async (row) => {
        const photo = await store.addPhoto(row.studentId!, row.file, row.category)
        done += 1
        return { photoId: photo.id }
      },
      { shouldCancel: () => done >= 1 },
    )
    expect(execution.cancelled).toBe(true)
    expect(execution.success).toBe(1)
    const outbox = readPhotoOutbox()
    const ids = outbox.map((t) => t.photoId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('重试失败项不会重复上传已成功的照片', async () => {
    seedStudents(roster())
    const store = useStudentPhotoStore()
    const names = [`9班-李明-${ID}.jpg`, `9班-张浩然-${ID}.jpg`]
    const studentStore = useStudentStore()
    const plan = buildPhotoImportPlan(names.map(file), {
      activeStudents: studentStore.activeStudents,
      nameCounts: studentStore.nameCounts,
      existingPhotos: store.photos,
    })
    let attempt = 0
    const run = () =>
      executePhotoImport(plan.rows, async (row) => {
        attempt += 1
        if (attempt === 1) throw new Error('first fails')
        const photo = await store.addPhoto(row.studentId!, row.file, row.category)
        return { photoId: photo.id }
      })
    const first = await run()
    expect(first.success).toBe(1)
    const failedRowIds = first.rows.filter((r) => r.action === 'failed').map((r) => r.id)
    const retryRows = first.rows.map((r) =>
      failedRowIds.includes(r.id) ? { ...r, action: 'ready' as const, errors: [] } : r,
    )
    const second = await executePhotoImport(retryRows, async (row) => {
      const photo = await store.addPhoto(row.studentId!, row.file, row.category)
      return { photoId: photo.id }
    })
    expect(second.success).toBe(1)
    // 重试只处理失败行，第一行（已成功）不再被 addPhoto
    expect(second.rows.filter((r) => r.action === 'imported')).toHaveLength(2)
    expect(diskPhotos().filter((p) => !p.deletedAt)).toHaveLength(2)
  })
})
