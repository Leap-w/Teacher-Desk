/**
 * Widget 快照桥的自检（v3.7.0；v3.7.8 P3 起按「目录身份验证闸门」重写）
 *
 * 这一层盯的是**「没验过却说连上了」**：目录名对、权限有、能写文件，
 * 三条加起来都不该构成「已连接」的理由——只有宿主确认过「这个目录就是扩展读的容器」才行。
 *
 * 所以每条都钉住「什么情况必须不通过」：
 *  ① 有句柄但本次会话没验过 → `needs-verify`，**一个字节都不写**；
 *  ② 验证失败 / 超时 / 取消 → 不落句柄、不写快照、**原连接原样保留**；
 *  ③ 页面重载后（新桥）必须重新验证，不许凭盘上的句柄直接报 `connected`；
 *  ④ 验证通过才允许落盘与写快照。
 *
 * 端口是注入的（`WidgetFileSystemPort` / `WidgetHandleStore` / `WidgetDirectoryVerifierPort`），
 * 所以这些状态在 node 里全能跑。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createWidgetBridge,
  type WidgetDirectoryHandleLike,
  type WidgetDirectoryVerifierPort,
  type WidgetFileSystemPort,
  type WidgetHandleStore,
} from '@/services/widgetBridge'
import {
  describeConnectOutcome,
  describeWriteOutcome,
  syncThenNotify,
  WIDGET_CANCELLED_MESSAGE,
} from '@/services/widgetBridgeFeedback'
import type { WidgetDirectoryVerificationResult } from '@/services/widgetDirectoryVerifier'

/** 内存句柄存储（生产环境是 IndexedDB；这里只要「存得住、读得回、清得掉」） */
function memoryStore(): WidgetHandleStore & {
  current?: WidgetDirectoryHandleLike
  writes: number
  /** 卡住 `write()`（P3.4：把「保存句柄进行中」这一窗口撑开） */
  gate?: Promise<void>
  /** 按调用序号卡住某一次 `write()`（P3.5：让「旧请求的写入最后落地」） */
  gates?: (Promise<void> | undefined)[]
  writeCalls: number
  /** 让 `write()` 直接失败（P3.7：模拟存储不可用 / 事务中止） */
  failWrite?: boolean
  /** 让 `clear()` 直接失败（P3.8：模拟清库失败） */
  failClear?: boolean
  /** 卡住 `clear()`（P3.8：把「清库进行中」这一窗口撑开） */
  clearGate?: Promise<void>
} {
  const box: { current?: WidgetDirectoryHandleLike } = {}
  const store = {
    writes: 0,
    gate: undefined as Promise<void> | undefined,
    gates: undefined as (Promise<void> | undefined)[] | undefined,
    writeCalls: 0,
    failWrite: false,
    failClear: false,
    clearGate: undefined as Promise<void> | undefined,
    get current() {
      return box.current
    },
    async read() {
      return box.current
    },
    async write(handle: WidgetDirectoryHandleLike) {
      const call = store.writeCalls
      store.writeCalls += 1
      const gate = store.gates?.[call]
      if (gate) await gate
      if (store.gate) await store.gate
      if (store.failWrite) {
        throw Object.assign(new Error('保存目录句柄的事务被中止'), { name: 'AbortError' })
      }
      store.writes += 1
      box.current = handle
    },
    async clear() {
      if (store.clearGate) await store.clearGate
      if (store.failClear) {
        throw Object.assign(new Error('清除目录句柄的事务被中止'), { name: 'AbortError' })
      }
      box.current = undefined
    },
  }
  return store
}

/** 造一个目录句柄；`failWith` 用来复现真实的写入异常（TypeMismatchError 等） */
function makeHandle(
  options: {
    name?: string
    kind?: 'file' | 'directory'
    written?: { name: string; text: string }[]
    failWith?: Error
    /** 第 N 次 getFileHandle 时才抛（用来测「连上之后写失败」） */
    failOnCall?: number
    /** 写快照时卡在这个 Promise 上（P3.4 用来把「写入进行中」这一窗口强行撑开） */
    gate?: Promise<void>
  } = {},
): WidgetDirectoryHandleLike {
  const written = options.written ?? []
  let calls = 0
  return {
    name: options.name ?? 'TeacherDesk',
    kind: options.kind ?? 'directory',
    async queryPermission() {
      return 'granted'
    },
    async requestPermission() {
      return 'granted'
    },
    async getFileHandle(name) {
      calls += 1
      if (options.failWith || (options.failOnCall !== undefined && calls === options.failOnCall)) {
        throw (
          options.failWith ?? Object.assign(new Error('no such file'), { name: 'NotFoundError' })
        )
      }
      return {
        async createWritable() {
          let buffer = ''
          return {
            async write(text: string) {
              buffer += text
            },
            async close() {
              // 提交点：gate 挂住时「写入进行中」这个窗口就被撑开了（P3.4 用）
              if (options.gate) await options.gate
              written.push({ name, text: buffer })
            },
          }
        },
      }
    },
  }
}

/** 假文件系统：记录写进去的字节、可切换权限、可指定「用户选了什么」 */
function fakeFileSystem(
  options: {
    supported?: boolean
    query?: PermissionState
    request?: PermissionState
    picked?: WidgetDirectoryHandleLike
    /** 按顺序发放选择框结果（P3.5：让两次连接选到不同的目录） */
    queue?: WidgetDirectoryHandleLike[]
  } = {},
) {
  const written: { name: string; text: string }[] = []
  const state = {
    query: options.query ?? 'granted',
    request: options.request ?? options.query ?? 'granted',
  }
  const permissionCalls: boolean[] = []
  let picks = 0

  const filesystem = {
    written,
    get picks() {
      return picks
    },
    get permissionCalls() {
      return permissionCalls
    },
    setPermission(next: { query?: PermissionState; request?: PermissionState }) {
      if (next.query) state.query = next.query
      if (next.request) state.request = next.request
    },
    supported: () => options.supported ?? true,
    async pickDirectory() {
      picks += 1
      // 按队列发放（两次连接选不同目录）
      if (options.queue && options.queue.length > 0) return options.queue.shift()
      // `picked: undefined` = 用户在选择框里点了取消
      if ('picked' in options) return options.picked
      return makeHandle({ written })
    },
    async permissionOf(_handle: WidgetDirectoryHandleLike, request: boolean) {
      permissionCalls.push(request)
      return request ? state.request : state.query
    },
  } satisfies WidgetFileSystemPort & Record<string, unknown>

  return filesystem
}

/** 假验证器：结果可切换，记录被验证过几次 */
function fakeVerifier(
  initial: WidgetDirectoryVerificationResult = { status: 'verified', nonce: 'n' },
) {
  let next = initial
  const port = {
    calls: 0,
    cancels: 0,
    set(result: WidgetDirectoryVerificationResult) {
      next = result
    },
    async verify(): Promise<WidgetDirectoryVerificationResult> {
      port.calls += 1
      return next
    },
    cancel() {
      port.cancels += 1
    },
  } satisfies WidgetDirectoryVerifierPort & Record<string, unknown>
  return port
}

/**
 * 可手动控制完成顺序的验证器（v3.7.8 P3.3 并发测试用）。
 *
 * 关键点：`verify()` 返回的是**真的挂起**的 Promise，测试用 `settle(i, …)` 决定谁先回来。
 * 只有这样才能复现「旧请求晚一步返回」这种真实竞态，而不是用同步 mock 假装并发。
 */
function deferredVerifier() {
  const calls: { resolve: (r: WidgetDirectoryVerificationResult) => void }[] = []
  const port = {
    calls,
    cancels: 0,
    async verify(): Promise<WidgetDirectoryVerificationResult> {
      return new Promise<WidgetDirectoryVerificationResult>((resolve) => {
        calls.push({ resolve })
      })
    },
    cancel() {
      port.cancels += 1
    },
    /** 让第 index 次挂起的验证返回指定结果 */
    settle(index: number, result: WidgetDirectoryVerificationResult) {
      calls[index]?.resolve(result)
    },
  }
  return port
}

/** 等微任务清空：`connect()` 里有若干 await，验证器要过几拍才会被调用 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** 手动放行的闸门（P3.4：把「写入进行中」这一窗口撑开） */
function makeGate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

const SNAPSHOT = '{"schemaVersion":2}\n'

let store: ReturnType<typeof memoryStore>

beforeEach(() => {
  store = memoryStore()
})

/** 桥 + 假验证器（默认「验证通过」） */
function makeBridge(
  fs: ReturnType<typeof fakeFileSystem>,
  verifier = fakeVerifier(),
  extra: { containerDir?: string } = {},
) {
  const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store, verifier, ...extra })
  return { bridge, verifier }
}

describe('状态机：没验过就不许说「已连接」', () => {
  it('浏览器不支持 → unsupported，且 write 明确说「不支持」而不是假装成功', async () => {
    const { bridge } = makeBridge(fakeFileSystem({ supported: false }))
    expect(await bridge.status()).toBe('unsupported')
    expect(await bridge.write(SNAPSHOT)).toEqual({ result: 'unsupported' })
  })

  it('没连接过 → unconnected；**write 不弹选择框**', async () => {
    const fs = fakeFileSystem()
    const { bridge } = makeBridge(fs)
    expect(await bridge.status()).toBe('unconnected')
    expect(await bridge.write(SNAPSHOT)).toEqual({ result: 'unconnected' })
    expect(fs.picks).toBe(0)
    expect(fs.written).toEqual([])
  })

  it('存着的是「指向文件」的坏句柄 → status 直接说 wrong-folder，不去查权限', async () => {
    await store.write(makeHandle({ name: 'widget-snapshot.json' }))
    const fs = fakeFileSystem()
    const { bridge } = makeBridge(fs)
    expect(await bridge.status()).toBe('wrong-folder')
    expect(fs.permissionCalls).toEqual([])
  })

  it('**有句柄但本次会话没验过 → needs-verify，且 write 一个字节都不写**', async () => {
    await store.write(makeHandle())
    const fs = fakeFileSystem()
    const { bridge, verifier } = makeBridge(fs)

    expect(await bridge.status()).toBe('needs-verify')
    expect(await bridge.write(SNAPSHOT)).toEqual({ result: 'needs-verify' })
    expect(fs.written).toEqual([])
    expect(verifier.calls).toBe(0) // 静默路径不许自己去验证（那会需要用户手势）
  })

  it('页面重载（新桥实例）后必须重新验证，不许凭盘上的句柄直接 connected', async () => {
    const fs = fakeFileSystem()
    const first = makeBridge(fs)
    await first.bridge.connect(SNAPSHOT)
    expect(await first.bridge.status()).toBe('connected')

    // 模拟刷新页面：同一份存储，全新的桥（内存里的验证记录没了）
    const reloaded = makeBridge(fs)
    expect(await reloaded.bridge.status()).toBe('needs-verify')
    expect(await reloaded.bridge.write(SNAPSHOT)).toEqual({ result: 'needs-verify' })
  })
})

describe('连接：选目录 / 选错 / 取消', () => {
  it('首次选择正确目录 → 验证 → 存句柄 → 写出第一份快照', async () => {
    const fs = fakeFileSystem()
    const { bridge, verifier } = makeBridge(fs)

    const outcome = await bridge.connect(SNAPSHOT)
    expect(outcome).toMatchObject({ status: 'connected', wrote: true })
    expect(verifier.calls).toBe(1)
    expect(fs.picks).toBe(1)
    expect(fs.written).toEqual([{ name: bridge.fileName, text: SNAPSHOT }])
    expect(store.current?.name).toBe('TeacherDesk')
    expect(await bridge.status()).toBe('connected')
  })

  it('**选成了 JSON 文件** → wrong-folder，不写盘、不落句柄、**连验证器都不调用**', async () => {
    const fs = fakeFileSystem({ picked: makeHandle({ name: 'widget-snapshot.json' }) })
    const { bridge, verifier } = makeBridge(fs)

    const outcome = await bridge.connect(SNAPSHOT)
    expect(outcome.status).toBe('wrong-folder')
    expect(outcome.wrote).toBe(false)
    expect(outcome.wrongFolder).toEqual({
      kind: 'file',
      picked: 'widget-snapshot.json',
      expected: 'TeacherDesk',
    })
    expect(fs.written).toEqual([])
    expect(store.current).toBeUndefined()
    expect(verifier.calls).toBe(0)
  })

  it('选到了另一个文件夹（不是 TeacherDesk）→ wrong-folder', async () => {
    const fs = fakeFileSystem({ picked: makeHandle({ name: 'TeacherDesk-old' }) })
    const { bridge } = makeBridge(fs)
    expect((await bridge.connect(SNAPSHOT)).wrongFolder).toEqual({
      kind: 'name',
      picked: 'TeacherDesk-old',
      expected: 'TeacherDesk',
    })
  })

  it('拿到文件句柄（kind=file）→ 一律 wrong-folder', async () => {
    const fs = fakeFileSystem({ picked: makeHandle({ name: 'TeacherDesk', kind: 'file' }) })
    const { bridge } = makeBridge(fs)
    expect((await bridge.connect(SNAPSHOT)).status).toBe('wrong-folder')
    expect(store.current).toBeUndefined()
  })

  it('用户在选择框里取消 → cancelled，不算错误、不动任何东西', async () => {
    const fs = fakeFileSystem({ picked: undefined })
    const { bridge } = makeBridge(fs)

    const outcome = await bridge.connect(SNAPSHOT)
    expect(outcome.cancelled).toBe(true)
    expect(outcome.wrote).toBe(false)
    expect(outcome.status).toBe('unconnected')
    expect(describeConnectOutcome(outcome).message).toBe(WIDGET_CANCELLED_MESSAGE)
  })

  it('**选错时不覆盖原有有效句柄**（旧句柄原样留着）', async () => {
    const good = makeHandle()
    await store.write(good)
    const fs = fakeFileSystem({
      query: 'denied',
      request: 'denied',
      picked: makeHandle({ name: 'widget-snapshot.json' }),
    })
    const { bridge } = makeBridge(fs)

    expect((await bridge.connect(SNAPSHOT)).status).toBe('wrong-folder')
    expect(store.current).toBe(good)
  })
})

describe('验证闸门：失败 / 超时 / 取消都不许变成 connected', () => {
  it('宿主说「不是容器」→ verify-failed，不落句柄、不写盘', async () => {
    const fs = fakeFileSystem()
    const verifier = fakeVerifier({
      status: 'failed',
      reason: 'rejected',
      errorCode: 'request-missing',
      detail: '容器里没有本次 nonce 的请求文件',
    })
    const { bridge } = makeBridge(fs, verifier)

    const outcome = await bridge.connect(SNAPSHOT)
    expect(outcome.status).toBe('verify-failed')
    expect(outcome.wrote).toBe(false)
    expect(outcome.verifyErrorCode).toBe('request-missing')
    expect(store.current).toBeUndefined()
    expect(fs.written).toEqual([])
    expect(await bridge.status()).toBe('unconnected')
  })

  it('验证超时 → verify-timeout，**文案不许说「你选错了目录」**', async () => {
    const fs = fakeFileSystem()
    const verifier = fakeVerifier({ status: 'timeout', nonce: 'n' })
    const { bridge } = makeBridge(fs, verifier)

    const outcome = await bridge.connect(SNAPSHOT)
    expect(outcome.status).toBe('verify-timeout')
    expect(store.current).toBeUndefined()
    expect(fs.written).toEqual([])

    const feedback = describeConnectOutcome(outcome)
    expect(feedback.ok).toBe(false)
    expect(feedback.message).toContain('暂时无法确认')
    expect(feedback.message).not.toContain('选错')
  })

  it('验证被取消 → 不报错、不落句柄', async () => {
    const fs = fakeFileSystem()
    const verifier = fakeVerifier({ status: 'cancelled', nonce: 'n' })
    const { bridge } = makeBridge(fs, verifier)

    const outcome = await bridge.connect(SNAPSHOT)
    expect(outcome.status).toBe('unconnected')
    expect(outcome.cancelled).toBe(true)
    expect(store.current).toBeUndefined()
    expect(fs.written).toEqual([])
  })

  it('验证时的真实文件系统错误 → failed（不是 verify-failed）', async () => {
    const fs = fakeFileSystem()
    const verifier = fakeVerifier({
      status: 'failed',
      reason: 'request-write-failed',
      detail: '写入被拒绝',
      errorName: 'NotAllowedError',
    })
    const { bridge } = makeBridge(fs, verifier)

    const outcome = await bridge.connect(SNAPSHOT)
    expect(outcome.status).toBe('failed')
    expect(outcome.error?.name).toBe('NotAllowedError')
    expect(store.current).toBeUndefined()
  })

  it('**已有连接时，新选的目录验证失败：原句柄与原有快照都不受影响**', async () => {
    const fs = fakeFileSystem()
    const good = makeHandle({ written: fs.written })
    await store.write(good)
    const verifier = fakeVerifier()
    const { bridge } = makeBridge(fs, verifier)

    // 先验证并连上（复用已存句柄）
    const first = await bridge.connect(SNAPSHOT)
    expect(first.status).toBe('connected')
    expect(fs.written).toHaveLength(1)

    // 让旧句柄权限不可用 → 走「重新选择」；新选的目录验证失败
    fs.setPermission({ query: 'denied', request: 'granted' })
    verifier.set({ status: 'timeout', nonce: 'n' })
    const second = await bridge.connect(SNAPSHOT)

    expect(second.status).toBe('verify-timeout')
    expect(store.current).toBe(good) // 旧句柄没被覆盖
    expect(fs.written).toHaveLength(1) // 没有多写一份快照
  })

  it('验证通过之后才落句柄（顺序不能反）', async () => {
    const fs = fakeFileSystem()
    const verifier = fakeVerifier({ status: 'timeout', nonce: 'n' })
    const { bridge } = makeBridge(fs, verifier)

    await bridge.connect(SNAPSHOT)
    expect(store.current).toBeUndefined()

    verifier.set({ status: 'verified', nonce: 'n' })
    await bridge.connect(SNAPSHOT)
    expect(store.current).toBeDefined()
  })
})

describe('复用已存句柄（浏览器重启后不该逼教师重选）', () => {
  it('已授权句柄复用 → 不弹选择框，但**仍然要验证**', async () => {
    const fs = fakeFileSystem()
    const { bridge, verifier } = makeBridge(fs)
    await bridge.connect(SNAPSHOT)
    expect(fs.picks).toBe(1)

    const again = await bridge.connect('{"second":true}\n')
    expect(again).toMatchObject({ status: 'connected', wrote: true, reused: true })
    expect(fs.picks).toBe(1) // 第二次一个选择框都没弹
    expect(verifier.calls).toBe(2) // 每次连接都当场验证
    expect(fs.written).toHaveLength(2)
  })

  it('权限退回 prompt → 在手势里补授权，然后验证并写入', async () => {
    const fs = fakeFileSystem()
    const { bridge } = makeBridge(fs)
    await bridge.connect(SNAPSHOT)

    fs.setPermission({ query: 'prompt', request: 'granted' })
    const outcome = await bridge.connect('{"second":true}\n')

    expect(outcome).toMatchObject({ status: 'connected', wrote: true, reused: true })
    expect(fs.picks).toBe(1)
    expect(fs.permissionCalls).toContain(true)
  })

  it('prompt 状态下用户拒绝授权 → needs-permission，不验证、不写盘', async () => {
    const fs = fakeFileSystem()
    const { bridge, verifier } = makeBridge(fs)
    await bridge.connect(SNAPSHOT)
    const callsBefore = verifier.calls

    fs.setPermission({ query: 'prompt', request: 'denied' })
    const outcome = await bridge.connect('{"second":true}\n')

    expect(outcome).toMatchObject({ status: 'needs-permission', wrote: false })
    expect(verifier.calls).toBe(callsBefore)
    expect(fs.written).toHaveLength(1)
  })

  it('首次连接就被拒绝授权 → needs-permission，**不存句柄**', async () => {
    const fs = fakeFileSystem({ query: 'prompt', request: 'denied' })
    const { bridge } = makeBridge(fs)

    const outcome = await bridge.connect(SNAPSHOT)
    expect(outcome).toMatchObject({ status: 'needs-permission', wrote: false })
    expect(fs.written).toEqual([])
    expect(store.current).toBeUndefined()
  })

  it('IndexedDB 句柄恢复：重载后需要重验，验过即恢复 connected', async () => {
    const fs = fakeFileSystem()
    const first = makeBridge(fs)
    await first.bridge.connect(SNAPSHOT)

    const reloaded = makeBridge(fs)
    expect(await reloaded.bridge.status()).toBe('needs-verify')

    const outcome = await reloaded.bridge.connect(SNAPSHOT)
    expect(outcome).toMatchObject({ status: 'connected', reused: true })
    expect(await reloaded.bridge.status()).toBe('connected')
  })
})

describe('写入失败：保留真实错误，不冒充「没授权」', () => {
  it('**TypeMismatchError**（句柄指向文件）→ failed + 保留错误名', async () => {
    const error = Object.assign(new Error('The path supplied exists, but is not a directory.'), {
      name: 'TypeMismatchError',
    })
    const fs = fakeFileSystem({ picked: makeHandle({ failWith: error }) })
    const { bridge } = makeBridge(fs)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const outcome = await bridge.connect(SNAPSHOT)
    warn.mockRestore()

    expect(outcome.status).toBe('failed')
    expect(outcome.wrote).toBe(false)
    expect(outcome.error?.name).toBe('TypeMismatchError')
    expect(describeConnectOutcome(outcome).message).toContain('TypeMismatchError')
  })

  it('NotAllowedError → failed，**不再折成 needs-permission**', async () => {
    const error = Object.assign(new Error('The request is not allowed by the user agent.'), {
      name: 'NotAllowedError',
    })
    const fs = fakeFileSystem({ picked: makeHandle({ failWith: error }) })
    const { bridge } = makeBridge(fs)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const outcome = await bridge.connect(SNAPSHOT)
    warn.mockRestore()

    expect(outcome.status).not.toBe('needs-permission')
    expect(outcome.status).toBe('failed')
    expect(outcome.error).toEqual({
      name: 'NotAllowedError',
      message: 'The request is not allowed by the user agent.',
    })
  })

  it('连接时写失败**不清掉**已验证的句柄（下次还能重试）', async () => {
    const fs = fakeFileSystem({ picked: makeHandle({ failWith: new Error('磁盘满') }) })
    const { bridge } = makeBridge(fs)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await bridge.connect(SNAPSHOT)
    warn.mockRestore()

    expect(store.current?.name).toBe('TeacherDesk')
  })

  it('静默写入失败 → failed（带错误名），不谎报 written', async () => {
    // 第一次（连接时）写成功，第二次（仅同步）才失败
    const fs = fakeFileSystem({ picked: makeHandle({ failOnCall: 2 }) })
    const { bridge } = makeBridge(fs)
    await bridge.connect(SNAPSHOT)

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const outcome = await bridge.write(SNAPSHOT)
    warn.mockRestore()

    expect(outcome.result).toBe('failed')
    expect(outcome.error?.name).toBe('NotFoundError')
    expect(describeWriteOutcome(outcome).message).toContain('NotFoundError')
  })

  it('已验证时覆盖写同一个文件（不是每写一次多一个文件）', async () => {
    const fs = fakeFileSystem()
    const { bridge } = makeBridge(fs)
    await bridge.connect(SNAPSHOT)
    expect((await bridge.write('{"second":true}\n')).result).toBe('written')
    expect(fs.written).toHaveLength(2)
    expect(fs.written.every((item) => item.name === bridge.fileName)).toBe(true)
    expect(fs.written[1]!.text).toBe('{"second":true}\n')
  })

  it('断开后清掉句柄与验证记录：再写就是 unconnected', async () => {
    const fs = fakeFileSystem()
    const { bridge } = makeBridge(fs)
    await bridge.connect(SNAPSHOT)

    await bridge.disconnect()
    expect(store.current).toBeUndefined()
    expect(await bridge.status()).toBe('unconnected')
    expect(await bridge.write(SNAPSHOT)).toEqual({ result: 'unconnected' })
  })

  it('cancelVerification 会转给验证器', async () => {
    const fs = fakeFileSystem()
    const { bridge, verifier } = makeBridge(fs)
    bridge.cancelVerification()
    expect(verifier.cancels).toBe(1)
  })
})

describe('刷新链路：写成功才通知宿主', () => {
  it('写入成功 → 通知一次', async () => {
    const fs = fakeFileSystem()
    const { bridge } = makeBridge(fs)
    await bridge.connect(SNAPSHOT)

    const notify = vi.fn()
    const outcome = await syncThenNotify(bridge, '{"second":true}\n', notify)

    expect(outcome.result).toBe('written')
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('未授权 / 没权限 → **一次都不通知**（否则小组件只会重画旧数据）', async () => {
    const fs = fakeFileSystem()
    const { bridge } = makeBridge(fs)
    await bridge.connect(SNAPSHOT)

    const notify = vi.fn()
    fs.setPermission({ query: 'prompt' })
    const outcome = await syncThenNotify(bridge, '{"second":true}\n', notify)

    expect(outcome.result).toBe('needs-permission')
    expect(notify).not.toHaveBeenCalled()
  })
})

describe('并发：旧请求不能覆盖新请求（P3.3）', () => {
  it('A. 同一时间连续两次连接 → 只落一次句柄、只写一次快照', async () => {
    const fs = fakeFileSystem()
    const verifier = deferredVerifier()
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store, verifier })

    const first = bridge.connect(SNAPSHOT)
    const second = bridge.connect(SNAPSHOT)
    await flush()
    expect(verifier.calls).toHaveLength(2) // 两次都真的挂起了

    // 新的先成功，旧的晚一步回来（真实竞态的形态）
    verifier.settle(1, { status: 'verified', nonce: '2' })
    const secondOutcome = await second
    verifier.settle(0, { status: 'verified', nonce: '1' })
    const firstOutcome = await first

    expect(secondOutcome).toMatchObject({ status: 'connected', wrote: true })
    expect(firstOutcome.superseded).toBe(true)
    expect(firstOutcome.wrote).toBe(false)
    expect(fs.written).toHaveLength(1) // 快照只写了一次
    expect(store.writes).toBe(1) // 句柄只存了一次
    expect(await bridge.status()).toBe('connected')
  })

  it('B/D. 旧请求返回 cancelled，新请求仍然保持 connected', async () => {
    const fs = fakeFileSystem()
    const verifier = deferredVerifier()
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store, verifier })

    const first = bridge.connect(SNAPSHOT)
    const second = bridge.connect(SNAPSHOT)
    await flush()

    // 旧请求先回来（被取消）→ 它已经过期，不许写状态
    verifier.settle(0, { status: 'cancelled', nonce: '1' })
    const firstOutcome = await first
    expect(firstOutcome.superseded).toBe(true)
    expect(firstOutcome.wrote).toBe(false)

    // 新请求随后验证成功
    verifier.settle(1, { status: 'verified', nonce: '2' })
    const secondOutcome = await second
    expect(secondOutcome).toMatchObject({ status: 'connected', wrote: true })
    expect(await bridge.status()).toBe('connected')
    expect(store.current).toBeDefined()
  })

  it('C. 旧请求在新请求成功之后才返回 → 结果作废', async () => {
    const fs = fakeFileSystem()
    const verifier = deferredVerifier()
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store, verifier })

    const first = bridge.connect(SNAPSHOT)
    const second = bridge.connect(SNAPSHOT)
    await flush()

    verifier.settle(1, { status: 'verified', nonce: '2' })
    await second
    const writesAfterSecond = fs.written.length

    // 旧的这时才成功返回 —— 但它已经不是最新那次了
    verifier.settle(0, { status: 'verified', nonce: '1' })
    const firstOutcome = await first

    expect(firstOutcome.superseded).toBe(true)
    expect(fs.written).toHaveLength(writesAfterSecond)
    expect(store.writes).toBe(1)
  })

  it('E. 新请求失败时，结果不被旧的（晚到的成功）覆盖', async () => {
    const fs = fakeFileSystem()
    const verifier = deferredVerifier()
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store, verifier })

    const first = bridge.connect(SNAPSHOT)
    const second = bridge.connect(SNAPSHOT)
    await flush()

    verifier.settle(1, { status: 'timeout', nonce: '2' }) // 新的失败
    const secondOutcome = await second
    expect(secondOutcome.status).toBe('verify-timeout')

    verifier.settle(0, { status: 'verified', nonce: '1' }) // 旧的晚到且成功
    const firstOutcome = await first
    expect(firstOutcome.superseded).toBe(true)

    // 结论以新的那次为准：没连上、没落句柄、没写快照
    expect(store.writes).toBe(0)
    expect(fs.written).toHaveLength(0)
    expect(await bridge.status()).toBe('unconnected')
  })

  it('F. 单次连接行为不受影响（回归）', async () => {
    const fs = fakeFileSystem()
    const verifier = deferredVerifier()
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store, verifier })

    const run = bridge.connect(SNAPSHOT)
    await flush()
    verifier.settle(0, { status: 'verified', nonce: '1' })
    const outcome = await run

    expect(outcome).toMatchObject({ status: 'connected', wrote: true })
    expect(outcome.superseded).toBeUndefined()
    expect(fs.written).toHaveLength(1)
    expect(store.writes).toBe(1)
  })
})

describe('并发提交边界（P3.4）：序号检查之后的窗口', () => {
  /**
   * 这一组用例用**手动闸门**把「序号检查已通过、但写入还没落地」这段窗口强行撑开，
   * 回答一个具体问题：旧请求在这段窗口里被新请求超越，还会不会留下过期副作用？
   *
   * 结论（也是这几条用例钉住的事实）：
   *  · 旧请求**会把这一次写入做完**——序号在写入前看过一次，写入期间不再复查；
   *  · 但它写的永远是**已验证**的那个目录（写盘调用点在 `verifyHandle` 之后），
   *    不存在「未验证目录被写入」；
   *  · 写入落地后若发现已过期，**不再向调用方报成功**（P3.4 收口），
   *    于是界面不会被一次过期请求点亮成「已连接」；
   *  · 最终状态收敛到**最后一次成功的那次**。
   *
   * 这段窗口在应用里**不可达**（`connect()` 只有卡片一个调用方，且 `busy` 同步置位把按钮禁用，
   * 同一 tick 的两次点击又会双双停在验证阶段、由验证器会话 abort 掉旧的那次）。
   * 用例把它撑开是为了记录语义，而不是宣称用户可以触发。
   */
  it('A. 新请求在旧请求「写快照」过程中启动', async () => {
    const written: { name: string; text: string }[] = []
    const writeGate = makeGate()
    const fs = fakeFileSystem({ picked: makeHandle({ written, gate: writeGate.promise }) })
    const verifier = deferredVerifier()
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store, verifier })

    const first = bridge.connect(SNAPSHOT)
    await flush()
    verifier.settle(0, { status: 'verified', nonce: '1' }) // 旧请求通过序号检查 → 卡在写入提交点
    await flush()
    expect(store.writes).toBe(1) // 句柄已保存
    expect(written).toHaveLength(0) // 快照还没落地

    const second = bridge.connect(SNAPSHOT) // 窗口内启动新请求
    await flush()

    writeGate.release()
    const firstOutcome = await first
    verifier.settle(1, { status: 'verified', nonce: '2' })
    const secondOutcome = await second

    // 旧请求的写入确实落地了（窗口存在），但写的是**已验证**的同一个快照文件
    expect(written).toHaveLength(2)
    expect(written.every((item) => item.name === 'widget-snapshot.json')).toBe(true)
    // 但它**不报成功**：结果作废，状态交给新的那次
    expect(firstOutcome.superseded).toBe(true)
    expect(firstOutcome.wrote).toBe(false)
    expect(secondOutcome.wrote).toBe(true)
    // 最终状态收敛到最后一次成功
    expect(await bridge.status()).toBe('connected')
    // 第二次走的是「复用已存句柄」分支，不会再存一次句柄
    expect(store.writes).toBe(1)
  })

  it('B. 新请求在旧请求「保存句柄」过程中启动', async () => {
    const written: { name: string; text: string }[] = []
    const storeGate = makeGate()
    store.gate = storeGate.promise
    const fs = fakeFileSystem({ picked: makeHandle({ written }) })
    const verifier = deferredVerifier()
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store, verifier })

    const first = bridge.connect(SNAPSHOT)
    await flush()
    verifier.settle(0, { status: 'verified', nonce: '1' })
    await flush()
    expect(store.writes).toBe(0) // 句柄保存卡在闸门上

    const second = bridge.connect(SNAPSHOT)
    await flush()

    store.gate = undefined // 只卡第一次
    storeGate.release()
    const firstOutcome = await first
    verifier.settle(1, { status: 'verified', nonce: '2' })
    const secondOutcome = await second

    expect(firstOutcome.superseded).toBe(true) // 写入落地了，但这次请求已过期
    expect(firstOutcome.wrote).toBe(false)
    expect(secondOutcome.wrote).toBe(true)
    expect(written.every((item) => item.name === 'widget-snapshot.json')).toBe(true)
    expect(await bridge.status()).toBe('connected')
  })

  it('C. 新请求验证失败：旧请求已完成的写入不会被当成新请求的成功', async () => {
    const fs = fakeFileSystem()
    const verifier = deferredVerifier()
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store, verifier })

    const first = bridge.connect(SNAPSHOT)
    await flush()
    verifier.settle(0, { status: 'verified', nonce: '1' })
    expect((await first).wrote).toBe(true)

    const second = bridge.connect(SNAPSHOT)
    await flush()
    verifier.settle(1, { status: 'timeout', nonce: '2' })
    const secondOutcome = await second

    // 新请求的结论就是 timeout —— 没有被旧请求的成功覆盖
    expect(secondOutcome.status).toBe('verify-timeout')
    expect(secondOutcome.wrote).toBe(false)
    // 旧请求建立的连接仍然有效（这是「验证失败不破坏原连接」的既有语义）
    expect(await bridge.status()).toBe('connected')
  })

  it('D. 新请求被取消：旧连接不被破坏，也不会产生不一致状态', async () => {
    const fs = fakeFileSystem()
    const verifier = deferredVerifier()
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store, verifier })

    const first = bridge.connect(SNAPSHOT)
    await flush()
    verifier.settle(0, { status: 'verified', nonce: '1' })
    expect((await first).wrote).toBe(true)
    const handleAfterFirst = store.current

    const second = bridge.connect(SNAPSHOT)
    await flush()
    verifier.settle(1, { status: 'cancelled', nonce: '2' })
    const secondOutcome = await second

    expect(secondOutcome.cancelled).toBe(true)
    expect(secondOutcome.superseded).toBeUndefined() // 它是最新那次，只是被取消
    // 句柄没有被清、连接仍是旧的这一条
    expect(store.current).toBe(handleAfterFirst)
    expect(await bridge.status()).toBe('connected')
  })
})

describe('句柄持久化并发边界（P3.5）', () => {
  /**
   * `handleStore.write()` 是异步的（IndexedDB：`await openDb()` → 建事务 → 等 `oncomplete`），
   * 两次写入的**完成顺序不保证等于调用顺序**。下面用按序号放行的闸门把「旧请求的写入最后落地」
   * 这个顺序强行造出来，检查它会不会把新请求保存的句柄盖回去。
   */
  it('E. 旧请求的句柄写入最后落地 → 不能覆盖新句柄', async () => {
    const gateA = makeGate()
    const writtenA: { name: string; text: string }[] = []
    const writtenB: { name: string; text: string }[] = []
    const handleA = makeHandle({ written: writtenA })
    const handleB = makeHandle({ written: writtenB })
    const fs = fakeFileSystem({ queue: [handleA, handleB] })
    const verifier = deferredVerifier()
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store, verifier })

    store.gates = [gateA.promise] // 只卡第一次 handleStore.write（A 的）

    const first = bridge.connect(SNAPSHOT)
    await flush()
    verifier.settle(0, { status: 'verified', nonce: '1' }) // A 验证通过 → 卡在写入队列里
    await flush()
    expect(store.writes).toBe(0)

    const second = bridge.connect(SNAPSHOT)
    await flush()
    verifier.settle(1, { status: 'verified', nonce: '2' }) // B 验证通过（它的写入排在 A 之后）

    gateA.release() // 放行 A 的写入，队列继续
    const [firstOutcome, secondOutcome] = await Promise.all([first, second])
    expect(firstOutcome.superseded).toBe(true)
    expect(secondOutcome).toMatchObject({ status: 'connected', wrote: true })
    expect(store.current).toBe(handleB)

    // 关键一：持久化句柄仍然是 B
    expect(store.current).toBe(handleB)

    // 关键二：内存里的 verifiedHandle 也必须是 B —— 用「手动同步写到哪个句柄」来观察
    writtenA.length = 0
    writtenB.length = 0
    expect((await bridge.write(SNAPSHOT)).result).toBe('written')
    expect(writtenB).toHaveLength(1)
    expect(writtenA).toHaveLength(0)
  })

  it('F. 新请求验证失败时，旧请求的迟到写入不能把结论洗成「已连接」', async () => {
    const gateA = makeGate()
    const handleA = makeHandle({ written: [] })
    const handleB = makeHandle({ written: [] })
    const fs = fakeFileSystem({ queue: [handleA, handleB] })
    const verifier = deferredVerifier()
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store, verifier })

    store.gates = [gateA.promise]

    const first = bridge.connect(SNAPSHOT)
    await flush()
    verifier.settle(0, { status: 'verified', nonce: '1' })
    await flush()

    const second = bridge.connect(SNAPSHOT)
    await flush()
    verifier.settle(1, { status: 'timeout', nonce: '2' }) // B 失败
    expect((await second).status).toBe('verify-timeout')

    gateA.release() // 放行 A 的写入
    expect((await first).superseded).toBe(true)

    // 结论仍是 B 的失败：不能被 A 的迟到写入变成 connected
    expect(await bridge.status()).toBe('needs-verify')
  })

  it('G. 顺序相反（旧请求先落地、新请求后落地）→ 以新请求为准', async () => {
    const gateA = makeGate()
    const gateB = makeGate()
    const handleA = makeHandle({ written: [] })
    const handleB = makeHandle({ written: [] })
    const fs = fakeFileSystem({ queue: [handleA, handleB] })
    const verifier = deferredVerifier()
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store, verifier })

    // 两次写入都先挂住：这样 B 读 store 时还是空的，才会自己选目录
    store.gates = [gateA.promise, gateB.promise]

    const first = bridge.connect(SNAPSHOT)
    await flush()
    verifier.settle(0, { status: 'verified', nonce: '1' })
    await flush() // 让 A 先走到 write（占第 0 次），卡住
    expect(store.writes).toBe(0)

    const second = bridge.connect(SNAPSHOT)
    await flush()
    verifier.settle(1, { status: 'verified', nonce: '2' })
    await flush() // B 走到 write（第 1 次），卡住

    gateA.release() // 旧请求先落地
    await flush()
    expect(store.current).toBe(handleA)

    gateB.release() // 新请求后落地
    const secondOutcome = await second
    expect(secondOutcome.wrote).toBe(true)
    expect(store.current).toBe(handleB) // 以新请求为准
    expect((await first).superseded).toBe(true)
  })
})

describe('三请求与写入队列边界（P3.6）', () => {
  /**
   * P3.5 的「补偿写入」本身又是一次异步写，会被第三次连接再超越——补偿永远追不上。
   * P3.6 改成**串行队列 + 执行时判序号**：轮到自己时若已不是最新那次，一个字节都不写。
   *
   * 这条用例把 A 的写入卡住，再让 B、C 依次排队，验证：
   *  · 过期请求（A、B）的写入在轮到时被跳过，**最后落地的必然是最新那次**；
   *  · IndexedDB 里的句柄与内存里的 `verifiedHandle` 始终一致。
   */
  it('H. 三个请求排队 → 最后落地的必然是最新那次', async () => {
    const gateA = makeGate()
    const writtenA: { name: string; text: string }[] = []
    const writtenB: { name: string; text: string }[] = []
    const writtenC: { name: string; text: string }[] = []
    const handleA = makeHandle({ written: writtenA })
    const handleB = makeHandle({ written: writtenB })
    const handleC = makeHandle({ written: writtenC })
    const fs = fakeFileSystem({ queue: [handleA, handleB, handleC] })
    const verifier = deferredVerifier()
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store, verifier })

    store.gates = [gateA.promise] // 只卡第一次写入（A 的）

    const first = bridge.connect(SNAPSHOT)
    await flush()
    verifier.settle(0, { status: 'verified', nonce: '1' })
    await flush() // A 的写入开始执行并卡在闸门上
    expect(store.writes).toBe(0)

    const second = bridge.connect(SNAPSHOT)
    await flush()
    verifier.settle(1, { status: 'verified', nonce: '2' })

    const third = bridge.connect(SNAPSHOT)
    await flush()
    verifier.settle(2, { status: 'verified', nonce: '3' })

    gateA.release() // 放行队列
    const [a, b, c] = await Promise.all([first, second, third])

    expect(a.superseded).toBe(true)
    expect(b.superseded).toBe(true) // 轮到 B 时 C 已经是最新 → 跳过
    expect(c.wrote).toBe(true)
    expect(store.current).toBe(handleC) // 最后落地的必然是最新那次

    // 一致性：内存里的 verifiedHandle 也是 C
    writtenA.length = 0
    writtenB.length = 0
    writtenC.length = 0
    expect((await bridge.write(SNAPSHOT)).result).toBe('written')
    expect(writtenC).toHaveLength(1)
    expect(writtenA).toHaveLength(0)
    expect(writtenB).toHaveLength(0)
  })
})

describe('句柄持久化失败语义（P3.7 A）', () => {
  it('句柄没落盘 → 不报成功、不写快照、不更新 verifiedHandle', async () => {
    const fs = fakeFileSystem()
    const { bridge } = makeBridge(fs)
    store.failWrite = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const outcome = await bridge.connect(SNAPSHOT)
    warn.mockRestore()

    expect(outcome.status).toBe('failed')
    expect(outcome.wrote).toBe(false)
    expect(outcome.error?.name).toBe('HandleStoreError')
    expect(fs.written).toEqual([]) // 快照一个字节都没写
    expect(store.current).toBeUndefined()
    expect(store.writes).toBe(0)
    // 不能出现「界面说已连接、其实没句柄」
    expect(await bridge.status()).toBe('unconnected')
    expect(await bridge.write(SNAPSHOT)).toEqual({ result: 'unconnected' })
  })

  it('持久化失败不清除原有有效句柄', async () => {
    const good = makeHandle({ written: [] })
    await store.write(good)
    // 旧句柄权限不可用 → 走「重新选择」；新选的目录验证通过，但持久化失败
    const fs = fakeFileSystem({ query: 'denied', request: 'granted' })
    const { bridge } = makeBridge(fs)
    store.failWrite = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const outcome = await bridge.connect(SNAPSHOT)
    warn.mockRestore()

    expect(outcome.status).toBe('failed')
    expect(store.current).toBe(good) // 旧句柄原样保留
    expect(fs.written).toEqual([])
  })

  it('失败文案说的是「保存授权」，不是「目录写不进去」', () => {
    const feedback = describeConnectOutcome({
      status: 'failed',
      wrote: false,
      error: { name: 'HandleStoreError', message: '事务被中止' },
    })
    expect(feedback.ok).toBe(false)
    expect(feedback.message).toContain('保存下来')
    expect(feedback.message).not.toContain('文件夹还在且可写')
  })
})

describe('disconnect 与在途写入（P3.7 B）', () => {
  it('B1. 写入正在执行时断开 → disconnect 返回后 store 仍为空', async () => {
    const gate = makeGate()
    const fs = fakeFileSystem()
    const verifier = deferredVerifier()
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store, verifier })
    store.gates = [gate.promise]

    const first = bridge.connect(SNAPSHOT)
    await flush()
    verifier.settle(0, { status: 'verified', nonce: '1' })
    await flush() // A 的写入正在执行（卡在闸门）

    const disconnecting = bridge.disconnect()
    await flush()
    gate.release() // A 的写入这时才真正提交
    await disconnecting

    expect(store.current).toBeUndefined() // clear 排在写入之后，旧句柄没复活
    expect((await first).superseded).toBe(true)
    expect(await bridge.status()).toBe('unconnected')
  })

  it('B2. 旧写入排队时断开 → 轮到它时被跳过', async () => {
    const gate = makeGate()
    const handleA = makeHandle({ written: [] })
    const handleB = makeHandle({ written: [] })
    const fs = fakeFileSystem({ queue: [handleA, handleB] })
    const verifier = deferredVerifier()
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store, verifier })
    store.gates = [gate.promise]

    const first = bridge.connect(SNAPSHOT)
    await flush()
    verifier.settle(0, { status: 'verified', nonce: '1' })
    await flush() // A 的写入执行中

    const second = bridge.connect(SNAPSHOT)
    await flush()
    verifier.settle(1, { status: 'verified', nonce: '2' })
    await flush() // B 的写入排 A 后面，尚未执行

    const disconnecting = bridge.disconnect()
    await flush()
    gate.release()
    await disconnecting

    expect((await first).superseded).toBe(true)
    expect((await second).superseded).toBe(true) // 轮到它时已过期 → 跳过
    expect(store.current).toBeUndefined()
  })

  it('B3. 断开之后重新连接 → 最终以新连接为准', async () => {
    const gate = makeGate()
    const handleA = makeHandle({ written: [] })
    const handleB = makeHandle({ written: [] })
    const fs = fakeFileSystem({ queue: [handleA, handleB] })
    const verifier = deferredVerifier()
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store, verifier })
    store.gates = [gate.promise]

    const first = bridge.connect(SNAPSHOT)
    await flush()
    verifier.settle(0, { status: 'verified', nonce: '1' })
    await flush()

    const disconnecting = bridge.disconnect()
    await flush()

    const second = bridge.connect(SNAPSHOT) // 清库还没执行，读到的是空 → 自己选目录
    await flush()
    verifier.settle(1, { status: 'verified', nonce: '2' })

    gate.release()
    await disconnecting
    const secondOutcome = await second

    expect(secondOutcome.wrote).toBe(true)
    expect(store.current).toBe(handleB)
    expect(await bridge.status()).toBe('connected')
    expect((await first).superseded).toBe(true)
  })
})

describe('队列异常恢复（P3.8）', () => {
  it('A. 清库失败要如实报告，且不影响之后的连接', async () => {
    const fs = fakeFileSystem()
    const { bridge } = makeBridge(fs)
    await bridge.connect(SNAPSHOT)
    expect(store.current).toBeDefined()

    store.failClear = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const outcome = await bridge.disconnect()
    warn.mockRestore()

    // 不能把清库失败当作断开成功
    expect(outcome.ok).toBe(false)
    expect(outcome.error?.name).toBe('AbortError')
    expect(store.current).toBeDefined() // 句柄确实还在

    // 之后的连接仍然能存句柄（队列没被污染）
    store.failClear = false
    fs.setPermission({ query: 'denied', request: 'granted' })
    const again = await bridge.connect(SNAPSHOT)
    expect(again.wrote).toBe(true)
    expect(store.current).toBeDefined()
    fs.setPermission({ query: 'granted' }) // 刚才为了走选择框才把查询权限设成 denied
    expect(await bridge.status()).toBe('connected')
  })

  it('B. 句柄写入失败不污染队列，后续连接正常', async () => {
    const fs = fakeFileSystem()
    const { bridge } = makeBridge(fs)
    store.failWrite = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const first = await bridge.connect(SNAPSHOT)
    warn.mockRestore()
    expect(first.status).toBe('failed')

    store.failWrite = false
    const second = await bridge.connect(SNAPSHOT)
    expect(second.wrote).toBe(true)
    expect(store.current).toBeDefined()
    expect(await bridge.status()).toBe('connected')
  })

  it('C. 清库挂起期间新连接排队，clear 失败后队列仍继续', async () => {
    const clearGate = makeGate()
    const handleA = makeHandle({ written: [] })
    const handleB = makeHandle({ written: [] })
    const fs = fakeFileSystem({ queue: [handleA, handleB] })
    const verifier = deferredVerifier()
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store, verifier })

    const first = bridge.connect(SNAPSHOT)
    await flush()
    verifier.settle(0, { status: 'verified', nonce: '1' })
    await first
    expect(store.current).toBe(handleA)

    // 断开：clear 挂住，并且注定失败
    store.clearGate = clearGate.promise
    store.failClear = true
    const disconnecting = bridge.disconnect()

    // 新连接在清库挂起期间进入队列
    fs.setPermission({ query: 'denied', request: 'granted' })
    const second = bridge.connect(SNAPSHOT)
    await flush()
    verifier.settle(1, { status: 'verified', nonce: '2' })

    clearGate.release()
    const disconnectOutcome = await disconnecting
    const secondOutcome = await second

    expect(disconnectOutcome.ok).toBe(false) // 失败如实报告
    expect(secondOutcome.wrote).toBe(true) // 但队列继续，新连接成功
    expect(store.current).toBe(handleB)
    fs.setPermission({ query: 'granted' }) // 同上
    expect(await bridge.status()).toBe('connected')
  })
})

describe('文案：每种结果必须分得开', () => {
  it('未授权 / 选错 / 写失败 三句话互不相同，且不再出现笼统的「没有拿到写入权限」', () => {
    const permission = describeConnectOutcome({ status: 'needs-permission', wrote: false })
    const wrong = describeConnectOutcome({
      status: 'wrong-folder',
      wrote: false,
      wrongFolder: { kind: 'file', picked: 'widget-snapshot.json', expected: 'TeacherDesk' },
    })
    const failed = describeConnectOutcome({
      status: 'failed',
      wrote: false,
      error: { name: 'TypeMismatchError', message: 'not a directory' },
    })

    expect(new Set([permission.message, wrong.message, failed.message]).size).toBe(3)
    for (const message of [permission.message, wrong.message, failed.message]) {
      expect(message).not.toContain('没有拿到写入权限')
    }
    expect(wrong.message).toContain('widget-snapshot.json')
    expect(failed.message).toContain('TypeMismatchError')
  })

  it('验证相关的四种结果各有各的说法', () => {
    const timeout = describeConnectOutcome({ status: 'verify-timeout', wrote: false })
    const rejected = describeConnectOutcome({
      status: 'verify-failed',
      wrote: false,
      verifyErrorCode: 'request-expired',
    })
    const needsVerify = describeConnectOutcome({ status: 'needs-verify', wrote: false })
    const ok = describeConnectOutcome({ status: 'connected', wrote: true })

    expect(new Set([timeout.message, rejected.message, needsVerify.message]).size).toBe(3)
    expect(rejected.message).toContain('request-expired')
    expect(needsVerify.message).toContain('验证连接')
    expect(ok.ok).toBe(true)
  })

  it('静默写入的每种结果都有自己的说法', () => {
    expect(describeWriteOutcome({ result: 'written' }).ok).toBe(true)
    expect(describeWriteOutcome({ result: 'unconnected' }).message).toContain('连接小组件')
    expect(describeWriteOutcome({ result: 'needs-verify' }).message).toContain('验证连接')
    expect(describeWriteOutcome({ result: 'wrong-folder' }).message).toContain('TeacherDesk')
    expect(
      describeWriteOutcome({
        result: 'failed',
        error: { name: 'QuotaExceededError', message: 'x' },
      }).message,
    ).toContain('QuotaExceededError')
  })
})

describe('路径', () => {
  it('快照文件名与容器目录来自配置（不是散落的开发机绝对路径）', () => {
    const { bridge } = makeBridge(fakeFileSystem(), fakeVerifier(), {
      containerDir: '~/Library/Containers/com.teacherdesk.mac.widget/Data/',
    })
    expect(bridge.filePathLabel).toBe(
      '~/Library/Containers/com.teacherdesk.mac.widget/Data/widget-snapshot.json',
    )
    expect(bridge.expectedFolderName).toBe('Data')
  })
})
