/**
 * 照片墙「批量管理」自检（v3.8.3 界面调整，版本号不变）。
 *
 * 跑的是真编排：`usePhotoBatchManage` → `studentPhotoStore.removePhoto`（墓碑落盘 →
 * 清本机媒体 → 出队）→ 本机缩略图位置配置清理。不是只验「某个函数被调用」。
 *
 * 覆盖：
 * - 管理模式开关（进入 / 退出都清空选择）；
 * - 多选、取消、计数，同一张不重复；
 * - 空选择不删除；
 * - 只删选中的照片，同一学生的其它照片与学生档案不动；
 * - 删除当前证件照后不留悬空标记；
 * - 只清被删照片的位置配置，其余照片的本机位置保留；
 * - 部分失败如实拆成成功 / 失败；
 * - 位置配置清理失败不影响「照片已删除」的结论。
 * - P2-1：选择状态与 `activePhotos` 对账（外部删除后自动剔除幽灵 id）。
 * - 删除待上传照片会移除它自己的上传任务，其它任务保留。
 */
import { nextTick, ref } from 'vue'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installFakeBrowser, type FakeBrowser } from './helpers/env'
import {
  installPhotoTestDoubles,
  resetPhotoTestDoubles,
  type PhotoTestDoubles,
} from './helpers/photoDoubles'
import { appConfig } from '@/config'
import { usePhotoBatchManage } from '@/composables/usePhotoBatchManage'
import { usePhotoThumbPosition } from '@/composables/usePhotoThumbPosition'
import { STUDENT_PHOTOS_KEY } from '@/repositories'
import { readPhotoOutbox } from '@/services/photoOutbox'
import { readRaw } from '@/services/storage'
import { useStudentPhotoStore } from '@/stores/studentPhoto'
import { PHOTO_THUMB_POSITION_KEY } from '@/utils/photoThumbPosition'
import type { Student } from '@/types'

const STUDENTS_KEY = `${appConfig.storageKeyPrefix}:students`

let browser: FakeBrowser
let doubles: PhotoTestDoubles

function student(id: string, name: string): Student {
  return { id, name, studentNo: '', gender: 'male' }
}

function photoFile(): File {
  return new File([new Uint8Array(1024)], 'photo.jpg', { type: 'image/jpeg' })
}

function diskPhotos(): Record<string, unknown>[] {
  const raw = readRaw(STUDENT_PHOTOS_KEY)
  return raw ? (JSON.parse(raw) as Record<string, unknown>[]) : []
}

/** 让写某个键时抛错（模拟配额满 / 隐私模式） */
function makeKeyUnwritable(key: string): void {
  const original = browser.localStorage.setItem.bind(browser.localStorage)
  vi.spyOn(browser.localStorage, 'setItem').mockImplementation((k, v) => {
    if (k === key) throw new Error('simulated quota error')
    original(k, v)
  })
}

function openStore(): ReturnType<typeof useStudentPhotoStore> {
  browser.localStorage.seed(
    STUDENTS_KEY,
    JSON.stringify([student('s1', '安琪'), student('s2', '白玛')]),
  )
  return useStudentPhotoStore()
}

beforeEach(() => {
  browser = installFakeBrowser()
  setActivePinia(createPinia())
  doubles = installPhotoTestDoubles()
  usePhotoThumbPosition().reload()
})

afterEach(() => {
  resetPhotoTestDoubles()
  vi.restoreAllMocks()
})

describe('管理模式：进入与退出都从空选择开始', () => {
  it('进入 / 退出会清空选择，避免下次残留', async () => {
    const store = openStore()
    const a = await store.addPhoto('s1', photoFile(), 'id-photo')
    const b = await store.addPhoto('s2', photoFile(), 'id-photo')

    const manage = usePhotoBatchManage()
    expect(manage.managing.value).toBe(false)

    manage.enter()
    manage.toggle(a.id)
    manage.toggle(b.id)
    expect(manage.selectedIds.value).toEqual([a.id, b.id])
    expect(manage.selectedCount.value).toBe(2)

    manage.exit()
    expect(manage.managing.value).toBe(false)
    expect(manage.selectedIds.value).toEqual([])
    expect(manage.hasSelection.value).toBe(false)

    manage.enter()
    expect(manage.selectedIds.value).toEqual([])
    // 选择只认真实存在的照片：随便编一个 id 不会被计入
    manage.toggle('not-a-real-photo')
    expect(manage.selectedIds.value).toEqual([])
    expect(manage.selectedCount.value).toBe(0)
  })

  it('多选 / 取消 / 重复点击同一张不会累加', async () => {
    const store = openStore()
    const a = await store.addPhoto('s1', photoFile(), 'id-photo')
    const b = await store.addPhoto('s1', photoFile(), 'life-photo')
    const c = await store.addPhoto('s2', photoFile(), 'id-photo')

    const manage = usePhotoBatchManage()
    manage.enter()

    manage.toggle(a.id)
    manage.toggle(a.id)
    expect(manage.selectedIds.value).toEqual([])

    manage.toggle(a.id)
    manage.toggle(b.id)
    manage.toggle(c.id)
    expect(manage.selectedCount.value).toBe(3)
    expect(manage.isSelected(b.id)).toBe(true)

    manage.toggle(b.id)
    expect(manage.selectedIds.value).toEqual([a.id, c.id])
    expect(manage.isSelected(b.id)).toBe(false)
  })

  it('空 id 被忽略；空选择时删除是空操作', async () => {
    const manage = usePhotoBatchManage()
    manage.enter()
    manage.toggle('')

    const result = await manage.removeSelected()
    expect(result).toEqual({
      requested: 0,
      removed: [],
      failed: [],
      skipped: [],
      positionCleaned: true,
    })
  })
})

describe('批量删除：只删选中的照片记录', () => {
  it('同一学生的三张照片只删选中的两张，学生档案与其余照片不动', async () => {
    const store = openStore()
    const keep = await store.addPhoto('s1', photoFile(), 'id-photo')
    const delA = await store.addPhoto('s1', photoFile(), 'life-photo')
    const delB = await store.addPhoto('s1', photoFile(), 'life-photo')
    const studentsBefore = browser.localStorage.getItem(STUDENTS_KEY)

    const manage = usePhotoBatchManage()
    manage.enter()
    manage.toggle(delA.id)
    manage.toggle(delB.id)
    const result = await manage.removeSelected()

    expect(result.removed.sort()).toEqual([delA.id, delB.id].sort())
    expect(result.failed).toEqual([])
    expect(store.listStudentPhotos('s1').map((photo) => photo.id)).toEqual([keep.id])
    // 学生档案逐字未变
    expect(browser.localStorage.getItem(STUDENTS_KEY)).toBe(studentsBefore)
    // 删除确实走了 Store 的媒体清理
    expect(doubles.media.removedIds).toEqual(expect.arrayContaining([delA.id, delB.id]))
  })

  it('删除当前证件照后不留悬空标记，磁盘上是墓碑', async () => {
    const store = openStore()
    const current = await store.addPhoto('s1', photoFile(), 'id-photo')
    expect(store.currentIdPhoto('s1')?.id).toBe(current.id)

    const manage = usePhotoBatchManage()
    manage.enter()
    manage.toggle(current.id)
    await manage.removeSelected()
    await nextTick()

    expect(store.currentIdPhoto('s1')).toBeUndefined()
    expect(store.listStudentPhotos('s1')).toEqual([])
    expect(diskPhotos().find((photo) => photo.id === current.id)).toMatchObject({
      deletedAt: expect.any(String),
    })
  })

  it('一次删除多个学生的照片：互不影响', async () => {
    const store = openStore()
    const a = await store.addPhoto('s1', photoFile(), 'id-photo')
    const b = await store.addPhoto('s2', photoFile(), 'id-photo')
    const keepB = await store.addPhoto('s2', photoFile(), 'life-photo')

    const manage = usePhotoBatchManage()
    manage.enter()
    manage.toggle(a.id)
    manage.toggle(b.id)
    const result = await manage.removeSelected()

    expect(result.removed.sort()).toEqual([a.id, b.id].sort())
    expect(store.listStudentPhotos('s1')).toEqual([])
    expect(store.listStudentPhotos('s2').map((photo) => photo.id)).toEqual([keepB.id])
  })

  it('删除完成后，被删照片从选择中移除；真实失败项保留选中以便重试', async () => {
    const store = openStore()
    const ok = await store.addPhoto('s1', photoFile(), 'id-photo')
    const failing = await store.addPhoto('s2', photoFile(), 'id-photo')
    const realRemove = store.removePhoto.bind(store)
    vi.spyOn(store, 'removePhoto').mockImplementation(async (photoId: string) => {
      if (photoId === failing.id) throw new Error('模拟写盘失败')
      return realRemove(photoId)
    })

    const manage = usePhotoBatchManage()
    manage.enter()
    manage.toggle(ok.id)
    manage.toggle(failing.id)
    const result = await manage.removeSelected()

    expect(result.removed).toEqual([ok.id])
    expect(result.failed.map((item) => item.photoId)).toEqual([failing.id])
    expect(result.skipped).toEqual([])
    // 成功的移出选择，失败的留下（照片也还在）
    expect(manage.selectedIds.value).toEqual([failing.id])
    expect(store.listStudentPhotos('s2').map((photo) => photo.id)).toEqual([failing.id])
  })
})

describe('本机缩略图位置配置：只清被删照片', () => {
  it('删除两张后，只剩未删那张的位置配置', async () => {
    const store = openStore()
    const keep = await store.addPhoto('s1', photoFile(), 'id-photo')
    const delA = await store.addPhoto('s1', photoFile(), 'life-photo')
    const delB = await store.addPhoto('s2', photoFile(), 'id-photo')

    const position = usePhotoThumbPosition()
    expect(position.setPosition(keep.id, 20, 40)).toBe(true)
    expect(position.setPosition(delA.id, 30, 50)).toBe(true)
    expect(position.setPosition(delB.id, 60, 70)).toBe(true)

    const manage = usePhotoBatchManage()
    manage.enter()
    manage.toggle(delA.id)
    manage.toggle(delB.id)
    const result = await manage.removeSelected()

    expect(result.positionCleaned).toBe(true)
    const onDisk = JSON.parse(browser.localStorage.getItem(PHOTO_THUMB_POSITION_KEY) ?? '{}')
    expect(onDisk).toEqual({ [keep.id]: { x: 20, y: 40 } })
    // 内存里的共享状态也同步了（照片墙下一帧就按默认取景渲染）
    expect(position.positionOfPhoto(delA.id)).toEqual({ x: 50, y: 30 })
    expect(position.positionOfPhoto(keep.id)).toEqual({ x: 20, y: 40 })
  })

  it('位置配置清理失败时不谎报删除失败：照片照样删掉，只回报 positionCleaned=false', async () => {
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'id-photo')
    expect(usePhotoThumbPosition().setPosition(photo.id, 10, 20)).toBe(true)
    makeKeyUnwritable(PHOTO_THUMB_POSITION_KEY)

    const manage = usePhotoBatchManage()
    manage.enter()
    manage.toggle(photo.id)
    const result = await manage.removeSelected()
    await nextTick()

    expect(result.removed).toEqual([photo.id])
    expect(result.failed).toEqual([])
    expect(result.positionCleaned).toBe(false)
    expect(store.listStudentPhotos('s1')).toEqual([])
    expect(diskPhotos().find((item) => item.id === photo.id)).toMatchObject({
      deletedAt: expect.any(String),
    })
  })
})

describe('选择状态与真实照片数据对账（P2-1）', () => {
  it('其他标签页删除后自动剔除该照片，其它选择不受影响', async () => {
    const store = openStore()
    const a = await store.addPhoto('s1', photoFile(), 'id-photo')
    const b = await store.addPhoto('s1', photoFile(), 'life-photo')
    const c = await store.addPhoto('s2', photoFile(), 'id-photo')

    const manage = usePhotoBatchManage()
    manage.enter()
    manage.toggle(a.id)
    manage.toggle(b.id)
    manage.toggle(c.id)
    expect(manage.selectedCount.value).toBe(3)

    // 模拟另一个标签页 / 另一台设备删掉 b：Store 的 activePhotos 随之更新
    await store.removePhoto(b.id)
    await nextTick()

    expect(manage.selectedIds.value).toEqual([a.id, c.id])
    expect(manage.selectedCount.value).toBe(2)
    expect(manage.isSelected(b.id)).toBe(false)
    expect(manage.isSelected(a.id)).toBe(true)
    expect(manage.isSelected(c.id)).toBe(true)
    expect(manage.hasSelection.value).toBe(true)
  })

  it('外部删除后再批量删除：只处理仍有效的照片，不把已删除的算成新失败', async () => {
    const store = openStore()
    const a = await store.addPhoto('s1', photoFile(), 'id-photo')
    const b = await store.addPhoto('s1', photoFile(), 'life-photo')

    const manage = usePhotoBatchManage()
    manage.enter()
    manage.toggle(a.id)
    manage.toggle(b.id)

    await store.removePhoto(b.id)
    await nextTick()

    const result = await manage.removeSelected()

    expect(result.requested).toBe(1)
    expect(result.removed).toEqual([a.id])
    expect(result.failed).toEqual([])
    expect(result.skipped).toEqual([])
    expect(store.listStudentPhotos('s1')).toEqual([])
    expect(manage.selectedCount.value).toBe(0)
  })

  it('快照后被别处删掉（返回 false 且照片确实没了）记为 skipped', async () => {
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'id-photo')

    const manage = usePhotoBatchManage()
    manage.enter()
    manage.toggle(photo.id)

    // 模拟「另一个标签页先删掉了它，这次写入什么都没做」：真的落墓碑，但返回 false
    const realRemove = store.removePhoto.bind(store)
    vi.spyOn(store, 'removePhoto').mockImplementation(async (photoId: string) => {
      await realRemove(photoId)
      return false
    })
    const result = await manage.removeSelected()

    expect(result.removed).toEqual([])
    expect(result.failed).toEqual([])
    expect(result.skipped).toEqual([photo.id])
    expect(manage.selectedIds.value).toEqual([])
    // 照片确实已不存在（墓碑），所以「跳过」是诚实的描述
    expect(store.listStudentPhotos('s1')).toEqual([])
    expect(store.findPhoto(photo.id)?.deletedAt).toBeTruthy()
  })
})

describe('removePhoto 返回值分类：以删除后的真实状态为准', () => {
  it('A. 正常删除：true + 已不存在 → removed，选择清除', async () => {
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'id-photo')

    const manage = usePhotoBatchManage()
    manage.enter()
    manage.toggle(photo.id)
    const result = await manage.removeSelected()

    expect(result.removed).toEqual([photo.id])
    expect(result.failed).toEqual([])
    expect(result.skipped).toEqual([])
    expect(manage.selectedIds.value).toEqual([])
    expect(store.findPhoto(photo.id)?.deletedAt).toBeTruthy()
  })

  it('B. false + 删除后已不存在 → skipped（不算成功、不算失败，选择清除）', async () => {
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'id-photo')

    const manage = usePhotoBatchManage()
    manage.enter()
    manage.toggle(photo.id)

    const realRemove = store.removePhoto.bind(store)
    vi.spyOn(store, 'removePhoto').mockImplementation(async (photoId: string) => {
      await realRemove(photoId)
      return false
    })
    const result = await manage.removeSelected()

    expect(result.skipped).toEqual([photo.id])
    expect(result.removed).toEqual([])
    expect(result.failed).toEqual([])
    expect(manage.selectedIds.value).toEqual([])
    expect(store.findPhoto(photo.id)?.deletedAt).toBeTruthy()
  })

  it('C. false + 照片仍存在 → failed（不是 skipped），保留选择可重试', async () => {
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'id-photo')

    const manage = usePhotoBatchManage()
    manage.enter()
    manage.toggle(photo.id)

    // 写入没有生效：什么都没删，却返回 false
    vi.spyOn(store, 'removePhoto').mockResolvedValueOnce(false)
    const result = await manage.removeSelected()

    expect(result.failed.map((item) => item.photoId)).toEqual([photo.id])
    expect(result.removed).toEqual([])
    expect(result.skipped).toEqual([])
    expect(result.failed[0].message).toContain('仍然存在')
    // 失败项保留选中，允许重试；照片仍在
    expect(manage.selectedIds.value).toEqual([photo.id])
    expect(store.listStudentPhotos('s1').map((item) => item.id)).toEqual([photo.id])
  })

  it('D1. 抛异常但照片已不存在 → 按实际状态记 skipped，不误报失败', async () => {
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'id-photo')

    const manage = usePhotoBatchManage()
    manage.enter()
    manage.toggle(photo.id)

    const realRemove = store.removePhoto.bind(store)
    vi.spyOn(store, 'removePhoto').mockImplementation(async (photoId: string) => {
      await realRemove(photoId)
      throw new Error('模拟删除后被并发打断')
    })
    const result = await manage.removeSelected()

    expect(result.skipped).toEqual([photo.id])
    expect(result.failed).toEqual([])
    expect(result.removed).toEqual([])
    expect(store.findPhoto(photo.id)?.deletedAt).toBeTruthy()
  })

  it('D2. 抛异常且照片仍存在 → failed，保留选择', async () => {
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'id-photo')

    const manage = usePhotoBatchManage()
    manage.enter()
    manage.toggle(photo.id)

    vi.spyOn(store, 'removePhoto').mockRejectedValueOnce(new Error('模拟写盘失败'))
    const result = await manage.removeSelected()

    expect(result.failed.map((item) => item.photoId)).toEqual([photo.id])
    expect(result.failed[0].message).toContain('模拟写盘失败')
    expect(result.removed).toEqual([])
    expect(result.skipped).toEqual([])
    expect(manage.selectedIds.value).toEqual([photo.id])
    expect(store.listStudentPhotos('s1').map((item) => item.id)).toEqual([photo.id])
  })

  it('D3. 删除后状态查不出来 → 保守记 failed，绝不宣称成功或已在别处删除', async () => {
    const store = openStore()
    const photo = await store.addPhoto('s1', photoFile(), 'id-photo')

    const manage = usePhotoBatchManage()
    manage.enter()
    manage.toggle(photo.id)

    // 第一次 findPhoto 是循环开始时的存在性检查；删除后的确认故意抛错
    const realFind = store.findPhoto.bind(store)
    let calls = 0
    vi.spyOn(store, 'findPhoto').mockImplementation((photoId: string) => {
      calls += 1
      if (calls >= 2) throw new Error('state unreadable')
      return realFind(photoId)
    })
    const result = await manage.removeSelected()

    expect(result.failed.map((item) => item.photoId)).toEqual([photo.id])
    expect(result.failed[0].message).toContain('无法确认')
    expect(result.removed).toEqual([])
    expect(result.skipped).toEqual([])
    // 照片事实上已经不在了：选择按「只保留仍存在的照片」自动清掉，
    // 但结果仍按 failed 上报（不猜、不宣称成功）
    expect(manage.selectedIds.value).toEqual([])
  })
})

describe('可见范围与选择对齐（搜索过滤）', () => {
  it('已选照片被搜索隐藏后自动取消选择', async () => {
    const store = openStore()
    const a = await store.addPhoto('s1', photoFile(), 'id-photo')
    const b = await store.addPhoto('s2', photoFile(), 'id-photo')
    const visible = ref<string[]>([a.id, b.id])
    const manage = usePhotoBatchManage(() => visible.value)

    manage.enter()
    manage.toggle(a.id)
    manage.toggle(b.id)
    expect(manage.selectedCount.value).toBe(2)

    // 搜索把 a 过滤掉：a 必须从「已选集合」里真正消失，而不是只改计数
    visible.value = [b.id]
    await nextTick()

    expect(manage.selectedIds.value).toEqual([b.id])
    expect(manage.selectedCount.value).toBe(1)
    expect(manage.isSelected(a.id)).toBe(false)
    expect(manage.isSelected(b.id)).toBe(true)
  })

  it('清空搜索后，被取消的照片不会自动重新选中', async () => {
    const store = openStore()
    const a = await store.addPhoto('s1', photoFile(), 'id-photo')
    const visible = ref<string[]>([a.id])
    const manage = usePhotoBatchManage(() => visible.value)

    manage.enter()
    manage.toggle(a.id)
    expect(manage.selectedCount.value).toBe(1)

    visible.value = [] // 搜索词把这张也过滤掉了
    await nextTick()
    expect(manage.selectedIds.value).toEqual([])

    visible.value = [a.id] // 清空搜索：照片回来了，但选择不该被「复活」
    await nextTick()
    expect(manage.selectedIds.value).toEqual([])
    expect(manage.selectedCount.value).toBe(0)
  })

  it('多选时只有被隐藏的那部分被取消，其余保留', async () => {
    const store = openStore()
    const a = await store.addPhoto('s1', photoFile(), 'id-photo')
    const b = await store.addPhoto('s1', photoFile(), 'life-photo')
    const c = await store.addPhoto('s2', photoFile(), 'id-photo')
    const visible = ref<string[]>([a.id, b.id, c.id])
    const manage = usePhotoBatchManage(() => visible.value)

    manage.enter()
    manage.toggle(a.id)
    manage.toggle(b.id)
    manage.toggle(c.id)

    visible.value = [a.id, c.id]
    await nextTick()

    expect(manage.selectedIds.value).toEqual([a.id, c.id])
    expect(manage.selectedCount.value).toBe(2)
  })

  it('切换学生范围（可见集合整体替换）时清理隐藏选择', async () => {
    const store = openStore()
    const a = await store.addPhoto('s1', photoFile(), 'id-photo')
    const b = await store.addPhoto('s2', photoFile(), 'id-photo')
    const visible = ref<string[]>([a.id, b.id])
    const manage = usePhotoBatchManage(() => visible.value)

    manage.enter()
    manage.toggle(a.id)
    manage.toggle(b.id)

    visible.value = [b.id]
    await nextTick()
    expect(manage.selectedIds.value).toEqual([b.id])

    visible.value = []
    await nextTick()
    expect(manage.selectedIds.value).toEqual([])
    expect(manage.hasSelection.value).toBe(false)
  })

  it('过滤后批量删除只删当前可见的选中照片，隐藏的不受影响', async () => {
    const store = openStore()
    const a = await store.addPhoto('s1', photoFile(), 'id-photo')
    const b = await store.addPhoto('s2', photoFile(), 'id-photo')
    const visible = ref<string[]>([a.id, b.id])
    const manage = usePhotoBatchManage(() => visible.value)

    manage.enter()
    manage.toggle(a.id)
    manage.toggle(b.id)

    visible.value = [a.id] // b 被搜索过滤掉
    await nextTick()

    const result = await manage.removeSelected()
    expect(result.requested).toBe(1)
    expect(result.removed).toEqual([a.id])
    expect(store.listStudentPhotos('s1')).toEqual([])
    // b 仍完好
    expect(store.listStudentPhotos('s2').map((photo) => photo.id)).toEqual([b.id])
  })

  it('提供可见来源时，跨标签页外部删除的对账仍然生效', async () => {
    const store = openStore()
    const a = await store.addPhoto('s1', photoFile(), 'id-photo')
    const b = await store.addPhoto('s2', photoFile(), 'id-photo')
    const visible = ref<string[]>([a.id, b.id])
    const manage = usePhotoBatchManage(() => visible.value)

    manage.enter()
    manage.toggle(a.id)
    manage.toggle(b.id)

    await store.removePhoto(b.id)
    await nextTick()

    expect(manage.selectedIds.value).toEqual([a.id])
    expect(manage.selectedCount.value).toBe(1)
  })
})

describe('删除影响上传队列（常驻断言）', () => {
  it('删掉待上传照片会移除它自己的任务，其它照片的任务保留', async () => {
    doubles.cloud.setAvailable(false)
    const store = openStore()
    const a = await store.addPhoto('s1', photoFile(), 'id-photo')
    const b = await store.addPhoto('s2', photoFile(), 'id-photo')
    expect(
      readPhotoOutbox()
        .map((task) => task.photoId)
        .sort(),
    ).toEqual([a.id, b.id].sort())

    const manage = usePhotoBatchManage()
    manage.enter()
    manage.toggle(a.id)
    await manage.removeSelected()

    // 删除仍走 Store 的既有路径：出队的是这一张，另一张还在队列里
    expect(readPhotoOutbox().map((task) => task.photoId)).toEqual([b.id])
  })
})
