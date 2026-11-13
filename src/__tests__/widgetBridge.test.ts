/**
 * Widget 快照桥的自检（v3.7.0；v3.7.8 按新的授权状态机重写）
 *
 * 这一层盯的是**「界面上说同步成功了、盘上其实没写」**和**「明明写失败却说没授权」**
 * 这两类错——它们不报错、不抛异常，只有把文件夹打开看才发现
 * （`ls ~/Library/Containers/.../TeacherDesk/`）。
 *
 * v3.7.8 的现场：Chrome 里存的句柄指向 `widget-snapshot.json` 文件本身，
 * `getFileHandle()` 抛 `TypeMismatchError`，而旧版把这次失败折成 `needs-permission`，
 * 界面因此永远说「没有拿到写入权限」。所以下面每条都钉住「哪种情况说哪种话」：
 *
 * ① **选错目录 / 选成文件** → `wrong-folder`，且**绝不覆盖**原有句柄；
 * ② **写入失败** → `failed` + 真实 `error.name`（`TypeMismatchError` / `NotAllowedError`）；
 * ③ **浏览器重启后退回 prompt** → 复用句柄补授权，**不再重选目录**；
 * ④ **写成功才通知宿主刷新**（`syncThenNotify`）。
 *
 * 端口是注入的（`WidgetFileSystemPort` / `WidgetHandleStore`），所以这些状态在 node 里全能跑。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createWidgetBridge,
  type WidgetDirectoryHandleLike,
  type WidgetFileSystemPort,
  type WidgetHandleStore,
} from '@/services/widgetBridge'
import {
  describeConnectOutcome,
  describeWriteOutcome,
  syncThenNotify,
  WIDGET_CANCELLED_MESSAGE,
} from '@/services/widgetBridgeFeedback'

/** 内存句柄存储（生产环境是 IndexedDB；这里只要「存得住、读得回、清得掉」） */
function memoryStore(): WidgetHandleStore & { current?: WidgetDirectoryHandleLike } {
  const box: { current?: WidgetDirectoryHandleLike } = {}
  return {
    get current() {
      return box.current
    },
    async read() {
      return box.current
    },
    async write(handle) {
      box.current = handle
    },
    async clear() {
      box.current = undefined
    },
  }
}

/** 造一个目录句柄；`failWith` 用来复现真实的写入异常（TypeMismatchError 等） */
function makeHandle(
  options: {
    name?: string
    kind?: 'file' | 'directory'
    written?: { name: string; text: string }[]
    failWith?: Error
  } = {},
): WidgetDirectoryHandleLike {
  const written = options.written ?? []
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
      if (options.failWith) throw options.failWith
      return {
        async createWritable() {
          return {
            async write(text: string) {
              written.push({ name, text })
            },
            async close() {},
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

const SNAPSHOT = '{"schemaVersion":2}\n'

let store: ReturnType<typeof memoryStore>

beforeEach(() => {
  store = memoryStore()
})

describe('状态机：每种状态各有各的说法', () => {
  it('浏览器不支持 → unsupported，且 write 明确说「不支持」而不是假装成功', async () => {
    const bridge = createWidgetBridge({
      fileSystem: fakeFileSystem({ supported: false }),
      handleStore: store,
    })
    expect(await bridge.status()).toBe('unsupported')
    expect(await bridge.write(SNAPSHOT)).toEqual({ result: 'unsupported' })
  })

  it('支持但没连接过 → unconnected；**write 不弹选择框**', async () => {
    const fs = fakeFileSystem()
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store })
    expect(await bridge.status()).toBe('unconnected')
    expect(await bridge.write(SNAPSHOT)).toEqual({ result: 'unconnected' })
    expect(fs.picks).toBe(0)
    expect(fs.written).toEqual([])
  })

  it('存着的是「指向文件」的坏句柄 → status 直接说 wrong-folder，不去查权限', async () => {
    await store.write(makeHandle({ name: 'widget-snapshot.json' }))
    const fs = fakeFileSystem()
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store })
    expect(await bridge.status()).toBe('wrong-folder')
    expect(fs.permissionCalls).toEqual([])
  })
})

describe('连接：选目录 / 选错 / 取消', () => {
  it('首次选择正确目录 → 授权 → 存句柄 → 写出第一份快照', async () => {
    const fs = fakeFileSystem()
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store })

    const outcome = await bridge.connect(SNAPSHOT)
    expect(outcome).toMatchObject({ status: 'connected', wrote: true })
    expect(fs.picks).toBe(1)
    expect(fs.written).toEqual([{ name: bridge.fileName, text: SNAPSHOT }])
    expect(store.current?.name).toBe('TeacherDesk')
    expect(await bridge.status()).toBe('connected')
  })

  it('**选成了 JSON 文件**（本次故障）→ wrong-folder，不写盘、不落句柄', async () => {
    const fs = fakeFileSystem({ picked: makeHandle({ name: 'widget-snapshot.json' }) })
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store })

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
  })

  it('选到了另一个文件夹（不是 TeacherDesk）→ wrong-folder，且说清选的是谁', async () => {
    const fs = fakeFileSystem({ picked: makeHandle({ name: 'TeacherDesk-old' }) })
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store })

    const outcome = await bridge.connect(SNAPSHOT)
    expect(outcome.wrongFolder).toEqual({
      kind: 'name',
      picked: 'TeacherDesk-old',
      expected: 'TeacherDesk',
    })
    expect(fs.written).toEqual([])
  })

  it('拿到文件句柄（kind=file）→ 一律 wrong-folder', async () => {
    const fs = fakeFileSystem({ picked: makeHandle({ name: 'TeacherDesk', kind: 'file' }) })
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store })
    expect((await bridge.connect(SNAPSHOT)).status).toBe('wrong-folder')
    expect(store.current).toBeUndefined()
  })

  it('用户在选择框里取消 → cancelled，不算错误、不动任何东西', async () => {
    const fs = fakeFileSystem({ picked: undefined })
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store })

    const outcome = await bridge.connect(SNAPSHOT)
    expect(outcome.cancelled).toBe(true)
    expect(outcome.wrote).toBe(false)
    expect(outcome.status).toBe('unconnected')
    expect(describeConnectOutcome(outcome).message).toBe(WIDGET_CANCELLED_MESSAGE)
  })

  it('**选错时不覆盖原有有效句柄**（旧句柄原样留着）', async () => {
    const good = makeHandle({ name: 'TeacherDesk' })
    await store.write(good)
    // 让旧句柄的权限不可用，才会走到「重新选择」；选中的是文件
    const fs = fakeFileSystem({
      query: 'denied',
      request: 'denied',
      picked: makeHandle({ name: 'widget-snapshot.json' }),
    })
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store })

    const outcome = await bridge.connect(SNAPSHOT)
    expect(outcome.status).toBe('wrong-folder')
    expect(store.current).toBe(good)
  })
})

describe('连接：复用已存句柄（浏览器重启后不该逼教师重选）', () => {
  it('已授权句柄直接复用 → 不再弹选择框', async () => {
    const fs = fakeFileSystem()
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store })
    await bridge.connect(SNAPSHOT)
    expect(fs.picks).toBe(1)

    const again = await bridge.connect('{"second":true}\n')
    expect(again).toMatchObject({ status: 'connected', wrote: true, reused: true })
    expect(fs.picks).toBe(1) // 第二次一个选择框都没弹
    expect(fs.written).toHaveLength(2)
  })

  it('权限退回 prompt → 在用户手势里补授权后直接写，**仍不重选目录**', async () => {
    const fs = fakeFileSystem()
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store })
    await bridge.connect(SNAPSHOT)

    fs.setPermission({ query: 'prompt', request: 'granted' })
    const outcome = await bridge.connect('{"second":true}\n')

    expect(outcome).toMatchObject({ status: 'connected', wrote: true, reused: true })
    expect(fs.picks).toBe(1)
    expect(fs.permissionCalls).toContain(true) // 真的调了 requestPermission
  })

  it('prompt 状态下用户拒绝授权 → needs-permission，不写盘、不弹选择框', async () => {
    const fs = fakeFileSystem()
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store })
    await bridge.connect(SNAPSHOT)

    fs.setPermission({ query: 'prompt', request: 'denied' })
    const outcome = await bridge.connect('{"second":true}\n')

    expect(outcome).toMatchObject({ status: 'needs-permission', wrote: false })
    expect(fs.picks).toBe(1)
    expect(fs.written).toHaveLength(1)
  })

  it('首次连接就被拒绝授权 → needs-permission，**不存句柄**', async () => {
    const fs = fakeFileSystem({ query: 'prompt', request: 'denied' })
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store })

    const outcome = await bridge.connect(SNAPSHOT)
    expect(outcome).toMatchObject({ status: 'needs-permission', wrote: false })
    expect(fs.written).toEqual([])
    expect(store.current).toBeUndefined()
  })

  it('IndexedDB 句柄恢复：页面重载后新桥能直接用上旧句柄', async () => {
    const fs = fakeFileSystem()
    const first = createWidgetBridge({ fileSystem: fs, handleStore: store })
    await first.connect(SNAPSHOT)

    // 模拟刷新页面：同一份存储，全新的桥实例
    const reloaded = createWidgetBridge({ fileSystem: fs, handleStore: store })
    expect(await reloaded.status()).toBe('connected')
    expect((await reloaded.write('{"after":"reload"}\n')).result).toBe('written')
  })
})

describe('写入失败：保留真实错误，不冒充「没授权」', () => {
  it('**TypeMismatchError**（句柄指向文件）→ failed + 保留错误名', async () => {
    const error = Object.assign(new Error('The path supplied exists, but is not a directory.'), {
      name: 'TypeMismatchError',
    })
    const fs = fakeFileSystem({ picked: makeHandle({ failWith: error }) })
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store })
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
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store })
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

  it('连接时写失败**不清掉**已校验通过的句柄（下次还能重试）', async () => {
    const fs = fakeFileSystem({ picked: makeHandle({ failWith: new Error('磁盘满') }) })
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await bridge.connect(SNAPSHOT)
    warn.mockRestore()

    expect(store.current?.name).toBe('TeacherDesk')
  })

  it('静默写入失败 → failed（带错误名），不谎报 written', async () => {
    const fs = fakeFileSystem()
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store })
    await bridge.connect(SNAPSHOT)

    await store.write(
      makeHandle({ failWith: Object.assign(new Error('no such file'), { name: 'NotFoundError' }) }),
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const outcome = await bridge.write(SNAPSHOT)
    warn.mockRestore()

    expect(outcome.result).toBe('failed')
    expect(outcome.error?.name).toBe('NotFoundError')
    expect(describeWriteOutcome(outcome).message).toContain('NotFoundError')
  })

  it('已连接时覆盖写同一个文件（不是每写一次多一个文件）', async () => {
    const fs = fakeFileSystem()
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store })
    await bridge.connect(SNAPSHOT)
    expect((await bridge.write('{"second":true}\n')).result).toBe('written')
    expect(fs.written).toHaveLength(2)
    expect(fs.written.every((item) => item.name === bridge.fileName)).toBe(true)
    expect(fs.written[1]!.text).toBe('{"second":true}\n')
  })
})

describe('刷新链路：写成功才通知宿主', () => {
  it('写入成功 → 通知一次', async () => {
    const fs = fakeFileSystem()
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store })
    await bridge.connect(SNAPSHOT)

    const notify = vi.fn()
    const outcome = await syncThenNotify(bridge, '{"second":true}\n', notify)

    expect(outcome.result).toBe('written')
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('写入失败 / 没授权 → **一次都不通知**（否则小组件只会重画旧数据）', async () => {
    const fs = fakeFileSystem()
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store })
    await bridge.connect(SNAPSHOT)

    const notify = vi.fn()
    fs.setPermission({ query: 'prompt' })
    const outcome = await syncThenNotify(bridge, '{"second":true}\n', notify)

    expect(outcome.result).toBe('needs-permission')
    expect(notify).not.toHaveBeenCalled()
  })
})

describe('文案：四种结果必须分得开', () => {
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
    expect(wrong.message).toContain('TeacherDesk')
    expect(failed.message).toContain('TypeMismatchError')
  })

  it('写入成功只有一种情况：wrote === true', () => {
    expect(describeConnectOutcome({ status: 'connected', wrote: true }).message).toContain(
      '已写入快照',
    )
    expect(
      describeConnectOutcome({ status: 'connected', wrote: true, reused: true }).message,
    ).toContain('已恢复授权')
  })

  it('静默写入的每种结果都有自己的说法', () => {
    expect(describeWriteOutcome({ result: 'written' }).ok).toBe(true)
    expect(describeWriteOutcome({ result: 'unconnected' }).message).toContain('连接小组件')
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
    const bridge = createWidgetBridge({
      fileSystem: fakeFileSystem(),
      handleStore: store,
      fileName: 'widget-snapshot.json',
      containerDir: '~/Library/Containers/com.teacherdesk.mac.widget/Data/',
    })
    // 目录结尾的 `/` 不该拼出双斜杠
    expect(bridge.filePathLabel).toBe(
      '~/Library/Containers/com.teacherdesk.mac.widget/Data/widget-snapshot.json',
    )
    expect(bridge.expectedFolderName).toBe('Data')
  })
})
