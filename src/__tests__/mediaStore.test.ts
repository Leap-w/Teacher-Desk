/**
 * IndexedDB 媒体库自检（Phase 1B）。
 *
 * 用内存 IDB 替身跑**真实的事务逻辑**（不是只 mock 方法）：
 * - 原图 + 缩略图在同一事务成功；
 * - 任一写入失败 → 整批回滚（两个 store 都查不到）；
 * - 配额不足 / 数据库打不开 → 抛带 `code` 的 `MediaStoreError`；
 * - 删除 / 读取 / 列举 / 覆盖写。
 */
import { describe, expect, it } from 'vitest'

import { createIndexedDbMediaStore, MediaStoreError } from '@/services/mediaStore'
import { createFakeIndexedDb } from './helpers/fakeIndexedDb'

const FULL = 'photos'
const THUMB = 'thumbs'

function blobOf(text: string): Blob {
  return new Blob([text], { type: 'image/jpeg' })
}

function setup() {
  const fake = createFakeIndexedDb()
  const store = createIndexedDbMediaStore({ factory: fake.factory })
  return { fake, store }
}

describe('媒体库：正常读写', () => {
  it('原图 + 缩略图在同一次 save 里落盘，且分别可读', async () => {
    const { fake, store } = setup()
    await store.save('p1', { full: blobOf('full-1'), thumb: blobOf('thumb-1') })

    expect(fake.keys(FULL)).toEqual(['p1'])
    expect(fake.keys(THUMB)).toEqual(['p1'])
    expect(await (await store.readFull('p1'))?.text()).toBe('full-1')
    expect(await (await store.readThumb('p1'))?.text()).toBe('thumb-1')
  })

  it('同 id 再次 save 覆盖原图与缩略图', async () => {
    const { store } = setup()
    await store.save('p1', { full: blobOf('old-full'), thumb: blobOf('old-thumb') })
    await store.save('p1', { full: blobOf('new-full'), thumb: blobOf('new-thumb') })
    expect(await (await store.readFull('p1'))?.text()).toBe('new-full')
    expect(await (await store.readThumb('p1'))?.text()).toBe('new-thumb')
  })

  it('读取不存在的照片返回 undefined（不是错误）', async () => {
    const { store } = setup()
    expect(await store.readFull('missing')).toBeUndefined()
    expect(await store.readThumb('missing')).toBeUndefined()
  })

  it('listIds 是 photos + thumbs 两个 store 的并集', async () => {
    const { store } = setup()
    await store.save('a', { full: blobOf('a'), thumb: blobOf('a') })
    await store.save('b', { full: blobOf('b'), thumb: blobOf('b') })
    expect((await store.listIds()).sort()).toEqual(['a', 'b'])
  })

  it('remove 删除两个 store 里的同一张照片；删除不存在的不报错', async () => {
    const { fake, store } = setup()
    await store.save('p1', { full: blobOf('f'), thumb: blobOf('t') })
    await store.remove('p1')
    expect(fake.keys(FULL)).toEqual([])
    expect(fake.keys(THUMB)).toEqual([])
    await expect(store.remove('p1')).resolves.toBeUndefined()
  })
})

describe('媒体库：事务回滚与错误码', () => {
  it('原图写入失败 → 整批回滚（缩略图也不落盘）', async () => {
    const { fake, store } = setup()
    fake.setPutFailure((storeName) => (storeName === FULL ? 'error' : null))
    await expect(store.save('p1', { full: blobOf('f'), thumb: blobOf('t') })).rejects.toMatchObject(
      {
        name: 'MediaStoreError',
        code: 'write-failed',
      },
    )
    expect(fake.keys(FULL)).toEqual([])
    expect(fake.keys(THUMB)).toEqual([])
  })

  it('缩略图写入失败 → 整批回滚（原图也不落盘）', async () => {
    const { fake, store } = setup()
    fake.setPutFailure((storeName) => (storeName === THUMB ? 'error' : null))
    await expect(
      store.save('p1', { full: blobOf('f'), thumb: blobOf('t') }),
    ).rejects.toBeInstanceOf(MediaStoreError)
    expect(fake.keys(FULL)).toEqual([])
    expect(fake.keys(THUMB)).toEqual([])
  })

  it('配额不足映射成 code=quota，并给出可读中文提示', async () => {
    const { fake, store } = setup()
    fake.setPutFailure(() => 'quota')
    const error = (await store
      .save('p1', { full: blobOf('f'), thumb: blobOf('t') })
      .catch((caught: unknown) => caught)) as MediaStoreError
    expect(error).toBeInstanceOf(MediaStoreError)
    expect(error.code).toBe('quota')
    expect(error.message).toContain('存储空间不足')
  })

  it('数据库打不开 → code=unavailable', async () => {
    const { fake, store } = setup()
    fake.setFailOpen(true)
    await expect(store.save('p1', { full: blobOf('f'), thumb: blobOf('t') })).rejects.toMatchObject(
      {
        name: 'MediaStoreError',
        code: 'unavailable',
      },
    )
  })

  it('当前环境没有 IndexedDB → code=unavailable（明确报错，不静默）', async () => {
    const store = createIndexedDbMediaStore({ factory: null })
    await expect(store.listIds()).rejects.toMatchObject({ code: 'unavailable' })
    await expect(store.readFull('p1')).rejects.toMatchObject({ code: 'unavailable' })
    await expect(store.remove('p1')).rejects.toMatchObject({ code: 'unavailable' })
  })
})
