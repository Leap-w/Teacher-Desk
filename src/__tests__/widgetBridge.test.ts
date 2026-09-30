/**
 * Widget 快照桥的自检（v3.7.0）。
 *
 * 这一层盯的是**「界面上说同步成功了、盘上其实没写」**这类错——它们不报错、不抛异常，
 * 只有把文件夹打开看才发现（`ls ~/Library/Containers/.../TeacherDesk/`）。桥的状态机有四种
 * 说法（不支持 / 未连接 / 需要授权 / 已连接），每一种都要能区分开：
 *
 * ① **不支持**（Safari）必须走「下载快照」兜底，不能假装在写；
 * ② **未连接** 时 `write()` 只返回状态，**不弹选择框**（弹窗必须由用户手势触发，
 *    后台自动同步里弹窗会被浏览器直接拒掉，还白打扰一次）；
 * ③ **权限退回 prompt**（浏览器重启后的常态）时要能被认出来，界面才知道该提示「重新授权」；
 * ④ **写入失败**（目录被删 / 容器没建）要被识别成 `failed`，而不是静默当作成功。
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

/** 假文件系统：记录写进去的字节、可切换权限、可模拟写入失败 */
function fakeFileSystem(options: { permission?: PermissionState; supported?: boolean } = {}) {
  const written: { name: string; text: string }[] = []
  let permission: PermissionState = options.permission ?? 'granted'
  let failWrite = false
  const handle: WidgetDirectoryHandleLike = {
    async queryPermission() {
      return permission
    },
    async requestPermission() {
      return permission
    },
    async getFileHandle(name) {
      return {
        async createWritable() {
          return {
            async write(text: string) {
              if (failWrite) throw new Error('容器目录不见了')
              written.push({ name, text })
            },
            async close() {},
          }
        },
      }
    },
  }
  const filesystem: WidgetFileSystemPort & {
    written: typeof written
    setPermission(value: PermissionState): void
    setFailWrite(value: boolean): void
    picks: number
  } = {
    written,
    picks: 0,
    setPermission(value) {
      permission = value
    },
    setFailWrite(value) {
      failWrite = value
    },
    supported: () => options.supported ?? true,
    async pickDirectory() {
      filesystem.picks += 1
      return handle
    },
    async permissionOf() {
      return permission
    },
  }
  return filesystem
}

const SNAPSHOT = '{"schemaVersion":1}\n'

let store: ReturnType<typeof memoryStore>

beforeEach(() => {
  store = memoryStore()
})

describe('状态机', () => {
  it('浏览器不支持 → unsupported，且 write 明确说「不支持」而不是假装成功', async () => {
    const bridge = createWidgetBridge({
      fileSystem: fakeFileSystem({ supported: false }),
      handleStore: store,
    })
    expect(await bridge.status()).toBe('unsupported')
    expect(await bridge.write(SNAPSHOT)).toBe('unsupported')
  })

  it('支持但没连接过 → unconnected；**write 不弹选择框**', async () => {
    const fs = fakeFileSystem()
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store })
    expect(await bridge.status()).toBe('unconnected')
    expect(await bridge.write(SNAPSHOT)).toBe('unconnected')
    expect(fs.picks).toBe(0)
    expect(fs.written).toEqual([])
  })

  it('连接：选目录 → 授权 → 存句柄 → 写出第一份快照', async () => {
    const fs = fakeFileSystem({ permission: 'granted' })
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store })

    const outcome = await bridge.connect(SNAPSHOT)
    expect(outcome).toEqual({ status: 'connected', wrote: true })
    expect(fs.picks).toBe(1)
    expect(fs.written).toEqual([{ name: bridge.fileName, text: SNAPSHOT }])
    expect(store.current).toBeDefined()
    expect(await bridge.status()).toBe('connected')
  })

  it('连接时用户拒绝授权 → needs-permission，**不存句柄、不写盘**', async () => {
    const fs = fakeFileSystem({ permission: 'denied' })
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store })
    expect(await bridge.connect(SNAPSHOT)).toEqual({ status: 'needs-permission', wrote: false })
    expect(fs.written).toEqual([])
    expect(store.current).toBeUndefined()
  })

  it('用户在选择框里取消（拿不到句柄）→ 保持原状态，不算错误', async () => {
    const fs = fakeFileSystem()
    fs.pickDirectory = async () => {
      fs.picks += 1
      return undefined
    }
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store })
    expect(await bridge.connect(SNAPSHOT)).toEqual({ status: 'unconnected', wrote: false })
  })

  it('**权限退回 prompt**（浏览器重启后的常态）→ needs-permission，且不写盘', async () => {
    const fs = fakeFileSystem({ permission: 'granted' })
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store })
    await bridge.connect(SNAPSHOT)

    fs.setPermission('prompt')
    expect(await bridge.status()).toBe('needs-permission')
    expect(await bridge.write(SNAPSHOT)).toBe('needs-permission')
    expect(fs.written).toHaveLength(1) // 只有连接时那一次
  })

  it('写入失败（容器没了）→ failed，不谎报 written', async () => {
    const fs = fakeFileSystem({ permission: 'granted' })
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store })
    await bridge.connect(SNAPSHOT)

    fs.setFailWrite(true)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await bridge.write(SNAPSHOT)).toBe('failed')
    warn.mockRestore()
  })

  it('已连接时覆盖写同一个文件（不是每写一次多一个文件）', async () => {
    const fs = fakeFileSystem({ permission: 'granted' })
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store })
    await bridge.connect(SNAPSHOT)
    expect(await bridge.write('{"second":true}\n')).toBe('written')
    expect(fs.written).toHaveLength(2)
    expect(fs.written.every((item) => item.name === bridge.fileName)).toBe(true)
    expect(fs.written[1]!.text).toBe('{"second":true}\n')
  })

  it('断开只清句柄：盘上那份快照不动（Widget 继续显示上一次的数据）', async () => {
    const fs = fakeFileSystem({ permission: 'granted' })
    const bridge = createWidgetBridge({ fileSystem: fs, handleStore: store })
    await bridge.connect(SNAPSHOT)

    await bridge.disconnect()
    expect(store.current).toBeUndefined()
    expect(await bridge.status()).toBe('unconnected')
    expect(fs.written).toHaveLength(1)
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
  })
})
