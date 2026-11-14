/**
 * 极简 IndexedDB 替身（Phase 1B 照片媒体库自检用）。
 *
 * 为什么手写而不是引入 `fake-indexeddb` / jsdom：项目自检的既有纪律是**不新增测试依赖**，
 * 而媒体库真正要验证的是「**同一个事务里写两个 store、任一失败整批回滚、配额错误能被识别**」。
 * 一个内存替身足以把这三件事跑成真实数据流：
 *
 * - 事务内的写先落在事务自己的暂存区，`oncomplete` 才提交、`onerror/onabort` 整批丢弃；
 * - 可注入 `putFailure`（返回 `quota` / `error`）模拟磁盘满 / 写入失败；
 * - 可注入 `setFailOpen` 模拟数据库打不开。
 *
 * 只实现 `services/mediaStore.ts` 用到的 API：`open` / `transaction` / `objectStore` /
 * `put` / `get` / `delete` / `getAllKeys` / `oncomplete` / `onerror` / `onabort`。
 */
type Callback = (() => void) | null

function quotaError(): Error {
  const error = new Error('The quota has been exceeded.') as Error & { name: string }
  error.name = 'QuotaExceededError'
  return error
}

class FakeRequest<T = unknown> {
  result!: T
  error: unknown = null
  onsuccess: Callback = null
  onerror: Callback = null
  onupgradeneeded: Callback = null

  succeed(result: T): void {
    this.result = result
    queueMicrotask(() => this.onsuccess?.())
  }

  fail(error: unknown): void {
    this.error = error
    queueMicrotask(() => this.onerror?.())
  }
}

/** 事务暂存区：key → value（`null` 表示删除） */
type Staged = Map<string, Blob | null>

interface FailureInjector {
  putFailureFor(storeName: string, key: string): 'quota' | 'error' | null
}

class FakeObjectStore {
  readonly name: string
  private readonly transaction: FakeTransaction

  constructor(name: string, transaction: FakeTransaction) {
    this.name = name
    this.transaction = transaction
  }

  put(value: Blob, key: string): FakeRequest<void> {
    const request = new FakeRequest<void>()
    const failure = this.transaction.injector.putFailureFor(this.name, String(key))
    if (failure) {
      const error = failure === 'quota' ? quotaError() : new Error('put failed')
      request.fail(error)
      this.transaction.failFromStore(error)
      return request
    }
    this.transaction.stage(this.name, String(key), value)
    request.succeed(undefined)
    return request
  }

  get(key: string): FakeRequest<Blob | undefined> {
    const request = new FakeRequest<Blob | undefined>()
    request.succeed(this.transaction.read(this.name, String(key)))
    return request
  }

  delete(key: string): FakeRequest<void> {
    const request = new FakeRequest<void>()
    this.transaction.stage(this.name, String(key), null)
    request.succeed(undefined)
    return request
  }

  getAllKeys(): FakeRequest<string[]> {
    const request = new FakeRequest<string[]>()
    request.succeed(this.transaction.keys(this.name))
    return request
  }
}

class FakeTransaction {
  readonly injector: FailureInjector
  error: unknown = null
  oncomplete: Callback = null
  onerror: Callback = null
  onabort: Callback = null

  private readonly db: FakeDatabase
  private readonly storeNames: string[]
  private readonly staged = new Map<string, Staged>()
  private state: 'pending' | 'committed' | 'failed' = 'pending'
  private readonly completionTimer: ReturnType<typeof setTimeout>

  constructor(db: FakeDatabase, storeNames: string[], injector: FailureInjector) {
    this.db = db
    this.storeNames = storeNames
    this.injector = injector
    for (const name of storeNames) this.staged.set(name, new Map())
    this.completionTimer = setTimeout(() => this.complete(), 0)
  }

  objectStore(name: string): FakeObjectStore {
    if (!this.storeNames.includes(name)) throw new Error(`transaction 未包含 store：${name}`)
    return new FakeObjectStore(name, this)
  }

  stage(storeName: string, key: string, value: Blob | null): void {
    if (this.state !== 'pending') return
    this.staged.get(storeName)?.set(key, value)
  }

  read(storeName: string, key: string): Blob | undefined {
    const staged = this.staged.get(storeName)
    if (staged?.has(key)) {
      const value = staged.get(key)
      if (value === null) return undefined
      return value
    }
    return this.db.read(storeName, key)
  }

  keys(storeName: string): string[] {
    const keys = new Set(this.db.keys(storeName))
    const staged = this.staged.get(storeName)
    if (staged) {
      for (const [key, value] of staged) {
        if (value === null) keys.delete(key)
        else keys.add(key)
      }
    }
    return [...keys]
  }

  /** store 写入失败：标记事务失败，异步派发 onerror + onabort（与真实 IDB 一致） */
  failFromStore(error: unknown): void {
    if (this.state !== 'pending') return
    this.state = 'failed'
    this.error = error
    queueMicrotask(() => {
      this.onerror?.()
      this.onabort?.()
    })
  }

  abort(): void {
    this.failFromStore(new Error('transaction aborted'))
  }

  private complete(): void {
    clearTimeout(this.completionTimer)
    if (this.state !== 'pending') return
    this.state = 'committed'
    for (const [storeName, staged] of this.staged) {
      for (const [key, value] of staged) {
        if (value === null) this.db.delete(storeName, key)
        else this.db.write(storeName, key, value)
      }
    }
    this.oncomplete?.()
  }
}

class FakeDatabase {
  readonly objectStoreNames: { contains: (name: string) => boolean }
  private readonly stores = new Map<string, Map<string, Blob>>()
  private readonly injector: FailureInjector

  constructor(injector: FailureInjector) {
    this.injector = injector
    this.objectStoreNames = {
      contains: (name: string) => this.stores.has(name),
    }
  }

  createObjectStore(name: string): void {
    if (!this.stores.has(name)) this.stores.set(name, new Map())
  }

  transaction(storeNames: string | string[]): FakeTransaction {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames]
    return new FakeTransaction(this, names, this.injector)
  }

  read(storeName: string, key: string): Blob | undefined {
    return this.stores.get(storeName)?.get(key)
  }

  write(storeName: string, key: string, value: Blob): void {
    this.stores.get(storeName)?.set(key, value)
  }

  delete(storeName: string, key: string): void {
    this.stores.get(storeName)?.delete(key)
  }

  keys(storeName: string): string[] {
    return [...(this.stores.get(storeName)?.keys() ?? [])]
  }
}

export interface FakeIndexedDb {
  /** 可直接传给 `createIndexedDbMediaStore({ factory })` */
  readonly factory: IDBFactory
  /** 让后续 open 失败（模拟库不可用） */
  setFailOpen(fail: boolean): void
  /**
   * 注入 put 失败：返回 `'quota'` 模拟配额不足，`'error'` 模拟事务错误，`null` 正常。
   * 参数是 store 名与 key，可按 key 精确制造「原图失败 / 缩略图失败」。
   */
  setPutFailure(
    failure: ((storeName: string, key: string) => 'quota' | 'error' | null) | null,
  ): void
  /** 测试断言用：某 store 当前落盘的 key 列表 */
  keys(storeName: string): string[]
  /** 测试断言用：某 store 里某个 key 的内容 */
  read(storeName: string, key: string): Blob | undefined
}

/** 创建一个全新的内存 IndexedDB 工厂（每个用例一个，测试间不串味） */
export function createFakeIndexedDb(): FakeIndexedDb {
  let failOpen = false
  let putFailure: ((storeName: string, key: string) => 'quota' | 'error' | null) | null = null
  const injector: FailureInjector = {
    putFailureFor: (storeName, key) => (putFailure ? putFailure(storeName, key) : null),
  }
  let database: FakeDatabase | null = null

  const factory = {
    open(): FakeRequest<FakeDatabase> {
      const request = new FakeRequest<FakeDatabase>()
      queueMicrotask(() => {
        if (failOpen) {
          request.fail(new Error('open failed'))
          return
        }
        database ??= new FakeDatabase(injector)
        request.result = database
        request.onupgradeneeded?.()
        request.onsuccess?.()
      })
      return request
    },
  } as unknown as IDBFactory

  return {
    factory,
    setFailOpen(fail) {
      failOpen = fail
    },
    setPutFailure(failure) {
      putFailure = failure
    },
    keys(storeName) {
      return database ? database.keys(storeName) : []
    },
    read(storeName, key) {
      return database ? database.read(storeName, key) : undefined
    },
  }
}
