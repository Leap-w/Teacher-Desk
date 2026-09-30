/**
 * Widget 快照的**写入桥**（v3.7.0）。
 *
 * ## 它解决的是什么问题
 *
 * Web/PWA 跑在浏览器的沙箱里，**写不进原生 App 的位置**——所以「PWA 直接喂给 Widget」
 * 这条路不能靠 `localStorage` 或路径约定硬来。本机只有一台 Mac、一个人用，于是走
 * 规格 §六 的方案 B：**一个固定位置的 JSON 文件**，用浏览器唯一被允许的写入通道
 * File System Access API 写它：
 *
 *     用户点一次「连接」→ 在系统选择框里选中快照目录（路径见 appConfig.widget.containerDir）
 *        ↓ 授权 readwrite 并落盘句柄（IndexedDB，句柄本身可结构化克隆）
 *     之后每次课程表变化 / 应用启动 → **静默覆写**同一个文件
 *
 * ## 为什么不是「每次都弹一次选择框」
 *
 * `showDirectoryPicker()` 必须由用户手势触发，不能每次同步都弹。所以句柄要存下来复用
 * （IndexedDB），权限用 `queryPermission` 查询：`granted` 就静默写，`prompt` 就告诉界面
 * 「需要你点一下重新授权」（浏览器重启后权限可能退回 prompt，取决于浏览器对持久权限的策略
 * ——这是**浏览器的规矩**，不是本模块的取舍，界面必须把这两种状态说清楚）。
 *
 * ## 依赖注入是为了什么
 *
 * 文件系统与句柄存储都走端口（`WidgetFileSystemPort` / `WidgetHandleStore`）：
 * 生产环境接浏览器 API，自检里接内存假体——于是「未连接 / 需要授权 / 已连接 / 写入失败」
 * 这四种状态机**能在 node 里跑**，不必开浏览器点一遍。
 */
import { appConfig } from '@/config'

/** 桥的状态（界面直接显示它，四种说法必须都能区分开） */
export type WidgetBridgeStatus =
  /** 浏览器不支持 File System Access API（Safari 等）→ 只能走「下载快照」兜底 */
  | 'unsupported'
  /** 支持，但还没连接过 */
  | 'unconnected'
  /** 连接过，但权限不在（浏览器重启后退回 prompt 是常态）→ 需要用户点一下 */
  | 'needs-permission'
  /** 已连接且权限在手 → 静默同步可用 */
  | 'connected'

/** 一次静默写入的结果 */
export type WidgetWriteResult =
  'written' | 'needs-permission' | 'unconnected' | 'unsupported' | 'failed'

/** 目录句柄里我们真正用到的几个能力（不声明全局类型，避免与浏览器 lib 打架） */
export interface WidgetDirectoryHandleLike {
  /** 选中的文件夹名（拿不到就是 undefined）。用来识别「选错文件夹」——见 `expectedFolderName` */
  name?: string
  queryPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<{
    createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>
  }>
}

/** 文件系统端口（生产环境 = 浏览器 API；自检 = 内存假体） */
export interface WidgetFileSystemPort {
  supported(): boolean
  /** 弹系统选择框让用户选目录；用户取消时返回 undefined */
  pickDirectory(): Promise<WidgetDirectoryHandleLike | undefined>
  /** `request = false` 时只查询、不弹窗（查询不需要用户手势） */
  permissionOf(handle: WidgetDirectoryHandleLike, request: boolean): Promise<PermissionState>
}

/** 句柄存储端口（生产环境 = IndexedDB；自检 = 内存 Map） */
export interface WidgetHandleStore {
  read(): Promise<WidgetDirectoryHandleLike | undefined>
  write(handle: WidgetDirectoryHandleLike): Promise<void>
  clear(): Promise<void>
}

export interface WidgetBridge {
  /** 快照文件名（`appConfig.widget.snapshotFileName`） */
  readonly fileName: string
  /**
   * 选择目录时应当选中的**文件夹名**（`TeacherDesk`）。
   *
   * 浏览器不给网页绝对路径，`FileSystemDirectoryHandle.name` 是唯一拿得到的线索。
   * 为什么要在意：快照必须落在**小组件真正读的那个目录**里，而机器上很容易出现另一个
   * 也叫 TeacherDesk 的目录（例如 v1.0.0 那版 macOS 工程留下的
   * `~/Library/Application Support/TeacherDesk/`）。选错之后写是成功的、网页也报成功，
   * **只有小组件没变**——那是极难自己查出来的一类问题，所以这里提前说一句。
   */
  readonly expectedFolderName: string
  /** 快照目录（给界面复制、给教师在选择框里「前往」） */
  readonly containerDir: string
  /** 快照文件在容器里的完整路径（展示用，`~` 开头） */
  readonly filePathLabel: string
  /** 当前状态（查询权限，不写盘、不弹窗） */
  status(): Promise<WidgetBridgeStatus>
  /**
   * 连接（**必须在用户手势里调用**）：选目录 → 要权限 → 存句柄 → 写第一份。
   * `folderWarning` 非空时表示「写入成功了，但选的文件夹名不像目标文件夹」——
   * 界面应把它显示出来（见 `expectedFolderName` 的说明）。
   */
  connect(
    text: string,
  ): Promise<{ status: WidgetBridgeStatus; wrote: boolean; folderWarning?: string }>
  /** 静默写（已连接时）。未连接 / 需要授权都不抛异常，返回状态让界面决定说什么 */
  write(text: string): Promise<WidgetWriteResult>
  /** 断开（清掉句柄；不动盘上已有的快照文件） */
  disconnect(): Promise<void>
  /** 兜底：把快照存成下载文件（不支持 FS API 的浏览器用它 + macos/Tools/install-snapshot.sh） */
  download(text: string): boolean
}

/** 浏览器真实实现。`window` 上那几个 API 不在 TS 的 DOM lib 里，这里做一次窄化取值 */
interface PickerCapableWindow {
  showDirectoryPicker?: (options?: {
    id?: string
    mode?: 'read' | 'readwrite'
    startIn?: string
  }) => Promise<WidgetDirectoryHandleLike>
}

export const browserWidgetFileSystem: WidgetFileSystemPort = {
  supported() {
    if (typeof window === 'undefined') return false
    return typeof (window as unknown as PickerCapableWindow).showDirectoryPicker === 'function'
  },
  async pickDirectory() {
    const picker = (window as unknown as PickerCapableWindow).showDirectoryPicker
    if (typeof picker !== 'function') return undefined
    try {
      return await picker({ id: 'teacherdesk-widget-snapshot', mode: 'readwrite' })
    } catch (error) {
      // 用户点了取消（AbortError）是正常操作，不是故障
      if ((error as { name?: string }).name === 'AbortError') return undefined
      console.warn('[widget] 选择快照目录失败：', error)
      return undefined
    }
  },
  async permissionOf(handle, request) {
    try {
      return request
        ? await handle.requestPermission({ mode: 'readwrite' })
        : await handle.queryPermission({ mode: 'readwrite' })
    } catch (error) {
      console.warn('[widget] 查询快照目录权限失败：', error)
      return 'denied'
    }
  },
}

/**
 * 句柄存 IndexedDB（**不是 localStorage**：FileSystemHandle 不能被序列化成字符串，
 * 只有结构化克隆能装下它）。库名与键名带前缀，避免与将来的其他 IDB 用途撞车。
 */
const IDB_NAME = 'teacherdesk-widget'
const IDB_STORE = 'handles'
const IDB_KEY = 'snapshot-dir'

function openDb(): Promise<IDBDatabase | undefined> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(undefined)
      return
    }
    try {
      const request = indexedDB.open(IDB_NAME, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(IDB_STORE)) {
          request.result.createObjectStore(IDB_STORE)
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => {
        console.warn('[widget] 打不开句柄库（隐私模式？）：', request.error)
        resolve(undefined)
      }
    } catch (error) {
      console.warn('[widget] 打不开句柄库：', error)
      resolve(undefined)
    }
  })
}

export const indexedDbHandleStore: WidgetHandleStore = {
  async read() {
    const db = await openDb()
    if (!db) return undefined
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const request = tx.objectStore(IDB_STORE).get(IDB_KEY)
      request.onsuccess = () => resolve(request.result as WidgetDirectoryHandleLike | undefined)
      request.onerror = () => resolve(undefined)
    })
  },
  async write(handle) {
    const db = await openDb()
    if (!db) return
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).put(handle, IDB_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => {
        console.warn('[widget] 保存目录句柄失败：', tx.error)
        resolve()
      }
    })
  },
  async clear() {
    const db = await openDb()
    if (!db) return
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).delete(IDB_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  },
}

/** 创建一个快照桥（端口可替换，见文件顶部说明） */
export function createWidgetBridge(options: {
  fileSystem: WidgetFileSystemPort
  handleStore: WidgetHandleStore
  fileName?: string
  containerDir?: string
}): WidgetBridge {
  const fileName = options.fileName ?? appConfig.widget.snapshotFileName
  const containerDir = options.containerDir ?? appConfig.widget.containerDir
  const filePathLabel = `${containerDir.replace(/\/+$/, '')}/${fileName}`
  // 目标目录名（`.../Application Support/TeacherDesk` 的最后一段）
  const expectedFolderName = containerDir.replace(/\/+$/, '').split('/').pop() ?? 'TeacherDesk'

  async function status(): Promise<WidgetBridgeStatus> {
    if (!options.fileSystem.supported()) return 'unsupported'
    const handle = await options.handleStore.read()
    if (!handle) return 'unconnected'
    const permission = await options.fileSystem.permissionOf(handle, false)
    return permission === 'granted' ? 'connected' : 'needs-permission'
  }

  async function write(text: string): Promise<WidgetWriteResult> {
    if (!options.fileSystem.supported()) return 'unsupported'
    const handle = await options.handleStore.read()
    if (!handle) return 'unconnected'
    const permission = await options.fileSystem.permissionOf(handle, false)
    if (permission !== 'granted') return 'needs-permission'
    return writeWith(handle, text)
  }

  async function writeWith(
    handle: WidgetDirectoryHandleLike,
    text: string,
  ): Promise<WidgetWriteResult> {
    try {
      const file = await handle.getFileHandle(fileName, { create: true })
      const stream = await file.createWritable()
      await stream.write(text)
      await stream.close()
      return 'written'
    } catch (error) {
      console.warn('[widget] 写快照失败：', error)
      return 'failed'
    }
  }

  return {
    fileName,
    containerDir,
    filePathLabel,
    expectedFolderName,
    status,
    async connect(text) {
      if (!options.fileSystem.supported()) return { status: 'unsupported', wrote: false }
      const handle = await options.fileSystem.pickDirectory()
      if (!handle) {
        // 用户在系统选择框里取消了 → 保持原状，不当作错误
        return { status: await status(), wrote: false }
      }
      const permission = await options.fileSystem.permissionOf(handle, true)
      if (permission !== 'granted') {
        return { status: 'needs-permission', wrote: false }
      }
      await options.handleStore.write(handle)
      const result = await writeWith(handle, text)
      // 文件夹名对不上就说一句（写是写成功了，但小组件多半读不到——见 expectedFolderName）
      const folderWarning =
        handle.name && handle.name !== expectedFolderName
          ? `写入成功，但你选的文件夹叫「${handle.name}」，小组件读的是「${expectedFolderName}」。请确认选对了目录。`
          : undefined
      return {
        status: result === 'written' ? 'connected' : 'needs-permission',
        wrote: result === 'written',
        ...(folderWarning ? { folderWarning } : {}),
      }
    },
    write,
    async disconnect() {
      await options.handleStore.clear()
    },
    download(text) {
      if (typeof document === 'undefined' || typeof URL === 'undefined') return false
      try {
        const blob = new Blob([text], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = fileName
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        // 立刻回收会让部分浏览器来不及取数据，放到下一帧之后
        window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
        return true
      } catch (error) {
        console.warn('[widget] 下载快照失败：', error)
        return false
      }
    },
  }
}

/** 应用里用的那一个（浏览器实现） */
export const widgetBridge = createWidgetBridge({
  fileSystem: browserWidgetFileSystem,
  handleStore: indexedDbHandleStore,
})
