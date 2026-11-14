/**
 * 本地照片媒体库（IndexedDB）—— v3.8.0 · Phase 1B。
 *
 * ## 为什么独立一个库
 *
 * `services/widgetBridge.ts` 已经在用 IndexedDB，但那是 **macOS 小组件的目录句柄库**
 * （`teacherdesk-widget` / `handles`），生命周期与清理语义和照片完全不同：
 * 照片库要能整体清理、要能按 id 批量扫，句柄库不能跟着动。因此新建独立库
 * `teacherdesk-media`（`config/photo.ts` 的 `PHOTO_MEDIA_DB_NAME`），**不扩展** widget 库。
 *
 * ## 结构
 *
 * - `photos`：原图（压缩后）Blob，键 = 照片 id；
 * - `thumbs`：缩略图 Blob，键 = 照片 id。
 * - 原图与缩略图**同一个 readwrite 事务**写入：要么两张都成功，要么都不落盘
 *   （避免"有缩略图没原图"这种误导性状态）。
 *
 * ## 错误
 *
 * 统一抛 `MediaStoreError`（带 `code`）：`unavailable` / `quota` / `write-failed` / `read-failed`。
 * 上层（store）据此给出可读提示，**绝不静默丢弃**。
 *
 * ## 可注入
 *
 * `createIndexedDbMediaStore({ factory })` 允许测试注入一个极简 IDB 替身，从而在 node 里
 * 真正跑「事务成功 / 回滚 / 配额失败 / 库不可用」这些分支（项目不引入 jsdom / fake-indexeddb）。
 */
import { PHOTO_MEDIA_DB_NAME, PHOTO_MEDIA_STORES } from '@/config/photo'

export type MediaStoreErrorCode = 'unavailable' | 'quota' | 'write-failed' | 'read-failed'

/** 媒体库错误（`code` 供上层区分提示文案；message 直接可展示给教师） */
export class MediaStoreError extends Error {
  readonly code: MediaStoreErrorCode

  constructor(code: MediaStoreErrorCode, message: string) {
    super(message)
    this.name = 'MediaStoreError'
    this.code = code
  }
}

/** 一张照片要一起写入的两份二进制 */
export interface MediaBinaryBundle {
  full: Blob
  thumb: Blob
}

/** 本地媒体存储端口（生产 = IndexedDB；测试 = 内存替身） */
export interface MediaStorePort {
  /** 原图 + 缩略图在**同一个事务**里写入；失败抛 `MediaStoreError` */
  save(photoId: string, media: MediaBinaryBundle): Promise<void>
  /** 读原图；不存在返回 `undefined`（读失败抛错） */
  readFull(photoId: string): Promise<Blob | undefined>
  /** 读缩略图；不存在返回 `undefined`（读失败抛错） */
  readThumb(photoId: string): Promise<Blob | undefined>
  /** 删除一张照片的两份二进制（不存在不算错误） */
  remove(photoId: string): Promise<void>
  /** 本机媒体库里出现过的全部照片 id（两个 store 的并集） */
  listIds(): Promise<string[]>
}

export interface IndexedDbMediaStoreOptions {
  /** 注入 IDB 工厂（测试用）；缺省取运行环境的 `indexedDB` */
  factory?: IDBFactory | null
  /** 库名（测试用）；缺省 `teacherdesk-media` */
  dbName?: string
}

const STORE_FULL = PHOTO_MEDIA_STORES.full
const STORE_THUMB = PHOTO_MEDIA_STORES.thumb

function isQuotaError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name
  if (name === 'QuotaExceededError') return true
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /quota|storage full|空间不足/i.test(message)
}

function unavailableError(reason?: string): MediaStoreError {
  return new MediaStoreError(
    'unavailable',
    `本地照片库不可用${reason ? `（${reason}）` : ''}。浏览器可能禁用了存储，或处于隐私模式。`,
  )
}

function writeError(error: unknown): MediaStoreError {
  if (error instanceof MediaStoreError) return error
  if (isQuotaError(error)) {
    return new MediaStoreError(
      'quota',
      '本机存储空间不足，照片没有保存。请清理浏览器存储，或删除部分照片后重试。',
    )
  }
  const detail = error instanceof Error && error.message ? `：${error.message}` : ''
  return new MediaStoreError('write-failed', `保存照片到本机失败${detail}`)
}

function readError(error: unknown): MediaStoreError {
  if (error instanceof MediaStoreError) return error
  const detail = error instanceof Error && error.message ? `：${error.message}` : ''
  return new MediaStoreError('read-failed', `读取本机照片失败${detail}`)
}

/**
 * 创建 IndexedDB 媒体库实现。数据库连接**惰性打开**并缓存；
 * 打不开时抛 `unavailable`，由 store 提示教师（不静默降级）。
 */
export function createIndexedDbMediaStore(
  options: IndexedDbMediaStoreOptions = {},
): MediaStorePort {
  const dbName = options.dbName ?? PHOTO_MEDIA_DB_NAME
  let dbPromise: Promise<IDBDatabase> | null = null

  function factoryOf(): IDBFactory | null {
    if (options.factory !== undefined) return options.factory
    return typeof indexedDB === 'undefined' ? null : indexedDB
  }

  function getDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise
    const factory = factoryOf()
    if (!factory) return Promise.reject(unavailableError('当前环境没有 IndexedDB'))
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest
      try {
        request = factory.open(dbName, 1)
      } catch (error) {
        reject(unavailableError(error instanceof Error ? error.message : '打开失败'))
        return
      }
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_FULL)) db.createObjectStore(STORE_FULL)
        if (!db.objectStoreNames.contains(STORE_THUMB)) db.createObjectStore(STORE_THUMB)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(unavailableError('打开本地照片库失败'))
      request.onblocked = () => reject(unavailableError('照片库被其他标签页占用'))
    }).catch((error: unknown) => {
      // 打开失败不缓存失败结果：下次调用可以再试（例如教师关掉了隐私模式）
      dbPromise = null
      throw error instanceof MediaStoreError ? error : unavailableError()
    })
    return dbPromise
  }

  /** 在给定 store 上执行一个事务；`fill` 里抛错会让事务中止并统一映射错误 */
  function runTransaction(
    db: IDBDatabase,
    storeNames: string[],
    mode: IDBTransactionMode,
    fill: (tx: IDBTransaction) => void,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let tx: IDBTransaction
      try {
        tx = db.transaction(storeNames, mode)
      } catch (error) {
        reject(writeError(error))
        return
      }
      let settled = false
      tx.oncomplete = () => {
        if (!settled) {
          settled = true
          resolve()
        }
      }
      tx.onerror = () => {
        if (!settled) {
          settled = true
          reject(writeError(tx.error))
        }
      }
      tx.onabort = () => {
        if (!settled) {
          settled = true
          reject(writeError(tx.error))
        }
      }
      try {
        fill(tx)
      } catch (error) {
        try {
          tx.abort()
        } catch {
          // 事务可能已经结束；下面照常把错误抛给调用方
        }
        if (!settled) {
          settled = true
          reject(writeError(error))
        }
      }
    })
  }

  function readOne(db: IDBDatabase, storeName: string, photoId: string): Promise<Blob | undefined> {
    return new Promise<Blob | undefined>((resolve, reject) => {
      let tx: IDBTransaction
      try {
        tx = db.transaction(storeName, 'readonly')
      } catch (error) {
        reject(readError(error))
        return
      }
      const request = tx.objectStore(storeName).get(photoId)
      request.onsuccess = () => resolve(request.result as Blob | undefined)
      request.onerror = () => reject(readError(request.error))
    })
  }

  return {
    async save(photoId, media) {
      if (!photoId) throw writeError(new Error('缺少照片 ID'))
      const db = await getDb()
      await runTransaction(db, [STORE_FULL, STORE_THUMB], 'readwrite', (tx) => {
        // 同一事务写两个 store：任意一个失败（含配额不足）都会中止整个事务
        tx.objectStore(STORE_FULL).put(media.full, photoId)
        tx.objectStore(STORE_THUMB).put(media.thumb, photoId)
      })
    },

    async readFull(photoId) {
      const db = await getDb()
      return readOne(db, STORE_FULL, photoId)
    },

    async readThumb(photoId) {
      const db = await getDb()
      return readOne(db, STORE_THUMB, photoId)
    },

    async remove(photoId) {
      const db = await getDb()
      await runTransaction(db, [STORE_FULL, STORE_THUMB], 'readwrite', (tx) => {
        tx.objectStore(STORE_FULL).delete(photoId)
        tx.objectStore(STORE_THUMB).delete(photoId)
      })
    },

    async listIds() {
      const db = await getDb()
      return new Promise<string[]>((resolve, reject) => {
        let tx: IDBTransaction
        try {
          tx = db.transaction([STORE_FULL, STORE_THUMB], 'readonly')
        } catch (error) {
          reject(readError(error))
          return
        }
        const fullRequest = tx.objectStore(STORE_FULL).getAllKeys()
        const thumbRequest = tx.objectStore(STORE_THUMB).getAllKeys()
        const ids = new Set<string>()
        let failed = false
        const collect = (request: IDBRequest) => {
          if (failed) return
          if (request.error) {
            failed = true
            reject(readError(request.error))
            return
          }
          for (const key of request.result as IDBValidKey[]) {
            if (typeof key === 'string') ids.add(key)
          }
        }
        fullRequest.onsuccess = () => collect(fullRequest)
        thumbRequest.onsuccess = () => collect(thumbRequest)
        fullRequest.onerror = () => collect(fullRequest)
        thumbRequest.onerror = () => collect(thumbRequest)
        tx.oncomplete = () => {
          if (!failed) resolve([...ids])
        }
        tx.onerror = () => {
          if (!failed) {
            failed = true
            reject(readError(tx.error))
          }
        }
      })
    },
  }
}

/** 生产默认实现（在浏览器里惰性打开 `teacherdesk-media`） */
export const indexedDbMediaStore: MediaStorePort = createIndexedDbMediaStore()

/**
 * 运行时活动端口：默认是 IndexedDB；测试可整体替换成内存替身。
 * （与 `sync/transportRegistry.ts` 的注册表同一手法，避免每个调用方各自传端口。）
 */
let activeMediaStore: MediaStorePort | null = null

export function setMediaStore(store: MediaStorePort | null): void {
  activeMediaStore = store
}

export function getMediaStore(): MediaStorePort {
  return activeMediaStore ?? indexedDbMediaStore
}
