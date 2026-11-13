/**
 * Widget 快照的**写入桥**（v3.7.0；v3.7.8 重做授权状态机）
 *
 * ## 它解决的是什么问题
 *
 * Web/PWA 跑在浏览器的沙箱里，**写不进原生 App 的位置**——所以「PWA 直接喂给 Widget」
 * 这条路不能靠 `localStorage` 或路径约定硬来。本机只有一台 Mac、一个人用，于是走
 * 规格 §六 的方案 B：**一个固定位置的 JSON 文件**，用浏览器唯一被允许的写入通道
 * File System Access API 写它：
 *
 *     用户点一次「连接」→ 在系统选择框里选中快照**目录**（路径见 appConfig.widget.containerDir）
 *        ↓ 授权 readwrite 并落盘句柄（IndexedDB，句柄本身可结构化克隆）
 *     之后每次课程表变化 / 应用启动 → **静默覆写**同一个文件
 *
 * ## v3.7.8 修的是什么（2026-11-13 实测）
 *
 * 现场证据：Chrome 里存下来的句柄 `name` 是 `widget-snapshot.json`，**指向文件而不是目录**，
 * 于是 `getFileHandle(name, { create: true })` 必然抛 `TypeMismatchError`；而旧版 `connect()`
 * 把「写入失败」折成 `needs-permission`，界面因此永远说「没有拿到写入权限」——一句误报。
 *
 * 现在的三条纪律：
 *
 * 1. **选中的必须是目录**：句柄落盘前先 `inspect()`（`kind === 'file'` / 名字等于快照文件名 /
 *    名字不等于目标目录名 → 一律 `wrong-folder`），**校验不过绝不覆盖原有句柄**；
 * 2. **写入失败就是失败**：`failed` 带上真实的 `error.name` / `error.message`，
 *    不再冒充「没授权」；
 * 3. **能复用就不重选**：已存句柄有效时，`granted` 直接写；`prompt` 在**用户手势**里补一次
 *    `requestPermission()`（浏览器重启后权限退回 prompt 是常态，不该逼教师每次重选目录）。
 *
 * ## v3.7.8 P3 加的闸门（2026-11-13）
 *
 * **「目录身份验证通过」是 `connected` 的必要条件**，而且**每次会话都要重验**：
 *
 * · 名字对（`inspect`）、权限有、能写文件——三条加起来**都不再构成连接成功的理由**；
 * · 只有 `verifier.verify(handle)` 返回 `verified`，才把句柄落盘、写快照、报 `connected`；
 * · 验证记录只放在内存（`verifiedHandle`），**不落 IndexedDB**：页面一刷新就回到
 *   `needs-verify`，用户点一次即在该句柄上原地重验（不弹选择框）；
 * · `write()`（自动同步 / 仅同步）同样要过这道闸：没验过就返回 `needs-verify`、一个字节不写。
 *
 * 为什么不做成持久标记：目录身份是「这个句柄指向的目录 == 扩展真正读的容器」，
 * 只有当场问宿主才算数；盘上一个 `verified: true` 下次启动就不再是证据。
 *
 * ## 为什么不是「每次都弹一次选择框」
 *
 * `showDirectoryPicker()` 必须由用户手势触发，不能每次同步都弹。所以句柄要存下来复用
 * （IndexedDB），权限用 `queryPermission` 查询：`granted` 就静默写，`prompt` 就告诉界面
 * 「需要你点一下重新授权」（这是**浏览器的规矩**，不是本模块的取舍）。
 *
 * ## 依赖注入是为了什么
 *
 * 文件系统与句柄存储都走端口（`WidgetFileSystemPort` / `WidgetHandleStore`）：
 * 生产环境接浏览器 API，自检里接内存假体——于是「未连接 / 需要授权 / 选错目录 / 写入失败 /
 * 已连接」这几种状态机**能在 node 里跑**，不必开浏览器点一遍。
 */
import { appConfig } from '@/config'
import {
  createWidgetDirectoryVerifier,
  type WidgetDirectoryVerificationResult,
} from '@/services/widgetDirectoryVerifier'

/**
 * 桥的状态（界面直接显示它，每种说法必须都能区分开）
 *
 * 注意：`failed` / `verifying` / `verify-failed` / `verify-timeout` 只会由**一次具体的
 * 连接或写入**产生，`status()` 不返回它们——它们描述的是「刚才那次操作」，
 * 不是可查询的持久状态。
 */
export type WidgetBridgeStatus =
  /** 浏览器不支持 File System Access API（Safari 等）→ 只能走「下载快照」兜底 */
  | 'unsupported'
  /** 支持，但还没连接过 */
  | 'unconnected'
  /** 连接过，但权限不在（浏览器重启后退回 prompt 是常态）→ 需要用户点一下 */
  | 'needs-permission'
  /** 存着句柄，但它指向的不是目标目录（例如指向了快照文件本身）→ 需要重选 */
  | 'wrong-folder'
  /**
   * 存着句柄、权限也在，但**本次会话还没验证过身份**（v3.7.8 P3）。
   *
   * 为什么不做成持久标记：目录身份是「这个句柄指向的目录 == 扩展真正读的容器」，
   * 这件事只有当场问宿主才能确认；一次性的 `verified: true` 存下来，
   * 下次页面启动就不再是证据了。
   */
  | 'needs-verify'
  /** 正在验证（只在 `connect()` 期间短暂出现，界面用来说「正在确认小组件目录…」） */
  | 'verifying'
  /** 宿主明确说「这个目录不是容器」，或响应不合协议 */
  | 'verify-failed'
  /** 12 秒内没拿到有效响应 —— **不等于选错目录** */
  | 'verify-timeout'
  /** 句柄与权限都在，但**这一次**没写进去（磁盘满 / 目录被删 / 系统拒绝写） */
  | 'failed'
  /** 已验证 + 权限在手 → 静默同步可用 */
  | 'connected'

/** 一次静默写入的结果 */
export type WidgetWriteResult =
  | 'written'
  | 'needs-permission'
  | 'unconnected'
  | 'unsupported'
  /** 存着的句柄指向的不是目标目录 */
  | 'wrong-folder'
  /** 有句柄但本次会话还没验证过身份 → **不写盘** */
  | 'needs-verify'
  /** 真的写了但失败了（磁盘 / 系统拒绝 / 句柄失效） */
  | 'failed'

/** 真实错误的最小快照（`name` 用来区分 TypeMismatchError / NotAllowedError / NotFoundError） */
export interface WidgetBridgeError {
  name: string
  message: string
}

/** 一次写入的结果 + 失败时的真实错误（**不吞异常**，界面要能说清是哪一种失败） */
export interface WidgetWriteOutcome {
  result: WidgetWriteResult
  error?: WidgetBridgeError
}

/** 选错目录的两种情形（文案要分开说，见 `widgetBridgeFeedback`） */
export interface WidgetFolderProblem {
  /** `file` = 选中的就是快照文件本身；`name` = 选了另一个文件夹 */
  kind: 'file' | 'name'
  /** 用户实际选中的名字（拿不到就是空串） */
  picked: string
  /** 应该选中的目录名（`TeacherDesk`） */
  expected: string
}

/** 一次「连接」的结果 */
export interface WidgetConnectOutcome {
  /** 连接后的状态（见 `WidgetBridgeStatus` 的说明） */
  status: WidgetBridgeStatus
  /** 快照是否真的写进去了——**这是唯一可以报「成功」的依据** */
  wrote: boolean
  /** 这次是复用了已存句柄（没有重新弹选择框） */
  reused?: boolean
  /** 用户在选择框里取消了（不是错误，也不该覆盖任何东西） */
  cancelled?: boolean
  /** 选错了目录（此时**没有**覆盖原有句柄） */
  wrongFolder?: WidgetFolderProblem
  /** 写入 / 验证失败的真实原因 */
  error?: WidgetBridgeError
  /** 宿主在验证响应里给的失败码（`request-missing` 等），只用于诊断与文案 */
  verifyErrorCode?: string
  /**
   * 这次连接已被**更新的一次连接**取代（v3.7.8 P3.3）。
   *
   * 语义是「这次的结果已经过期」：调用方**不得**用它写状态、弹提示或清 `busy`——
   * 收尾由新的那次负责。典型场景是双击按钮、或在验证途中又点了一次。
   */
  superseded?: boolean
}

/**
 * 一次「断开」的结果（v3.7.8 P3.8）。
 *
 * 断开要清掉 IndexedDB 里的句柄，这一步**可能失败**（存储不可用 / 事务中止）。
 * 失败时不能装作断开成功：句柄还在盘上，下次开页面会又冒出「需要验证目录」。
 */
export interface WidgetDisconnectOutcome {
  ok: boolean
  error?: WidgetBridgeError
}

/** 目录句柄里我们真正用到的几个能力（不声明全局类型，避免与浏览器 lib 打架） */
export interface WidgetDirectoryHandleLike {
  /** 选中的条目名（拿不到就是 undefined）。用来识别「选错文件夹 / 选成文件」——见 `inspect` */
  name?: string
  /** `file` = 这是一个文件句柄（正常路径下永远是 `directory`） */
  kind?: 'file' | 'directory'
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
  /**
   * 弹系统选择框让用户选**目录**；用户取消时返回 undefined。
   *
   * 这里刻意只用 `showDirectoryPicker`（不提供「选文件」的口子）：快照目录是固定的，
   * 一旦允许选文件，就会复现 v3.7.8 之前那个「句柄指向 widget-snapshot.json」的故障。
   */
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

/**
 * 目录身份验证端口（v3.7.8 P3）。
 *
 * 生产环境接 `createWidgetDirectoryVerifier()`（P2 的挑战—应答）；
 * 自检里接假体——于是「验证没通过就不能变成 connected」这条闸门能在 node 里跑。
 */
export interface WidgetDirectoryVerifierPort {
  verify(handle: WidgetDirectoryHandleLike): Promise<WidgetDirectoryVerificationResult>
  /** 取消进行中的验证（页面卸载 / 用户取消） */
  cancel(): void
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
   * **只有小组件没变**——那是极难自己查出来的一类问题。
   */
  readonly expectedFolderName: string
  /** 快照**目录**（给界面复制、给教师在选择框里「前往」） */
  readonly containerDir: string
  /** 快照文件在容器里的完整路径（展示用，`~` 开头） */
  readonly filePathLabel: string
  /** 当前状态（查询权限，不写盘、不弹窗） */
  status(): Promise<WidgetBridgeStatus>
  /**
   * 连接（**必须在用户手势里调用**）：
   * ① 先复用已存句柄（已授权就直接验证；prompt 在手势里补授权再验证）；
   * ② 复用不了才弹选择框 → 校验是不是目标目录 → 授权 → **验证目录身份** → 存句柄 → 写第一份。
   *
   * **v3.7.8 P3 起，「目录身份验证通过」是 `connected` 的必要条件**：
   * 名字对、权限有、能写文件，都不再构成连接成功的理由。
   * `wrongFolder` / 验证失败时**什么都没覆盖**（原句柄与原有连接原样保留）。
   */
  connect(text: string): Promise<WidgetConnectOutcome>
  /**
   * 静默写（已验证时）。未连接 / 需要授权 / 需要验证都不抛异常，
   * 返回结果让界面决定说什么；**未经本次会话验证的句柄一律不写盘**。
   */
  write(text: string): Promise<WidgetWriteOutcome>
  /** 断开（清掉句柄与本次会话的验证记录；不动盘上已有的快照文件） */
  disconnect(): Promise<WidgetDisconnectOutcome>
  /** 取消进行中的目录身份验证（页面卸载 / 用户取消时调用） */
  cancelVerification(): void
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
      // `mode: 'readwrite'` 让选完就带写权限；`id` 让系统记住上次的位置（重选时少点几下）
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
      // 这里**不把异常折成 'denied'**：调用方要能区分「用户拒绝」与「API 抛错」
      // （例如缺少用户手势时 requestPermission 会抛 SecurityError）
      console.warn('[widget] 查询快照目录权限失败：', error)
      throw error
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
    // **不吞**：句柄没落盘就是没落盘，由上层决定怎么报（v3.7.8 P3.7）
    if (!db) throw new Error('打不开句柄库（浏览器存储不可用）')
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).put(handle, IDB_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('保存目录句柄失败'))
      tx.onabort = () => reject(tx.error ?? new Error('保存目录句柄的事务被中止'))
    })
  },
  async clear() {
    const db = await openDb()
    // 同 `write`：清不掉就说清不掉，别让上层以为断开成功了（v3.7.8 P3.8）
    if (!db) throw new Error('打不开句柄库（浏览器存储不可用）')
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).delete(IDB_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('清除目录句柄失败'))
      tx.onabort = () => reject(tx.error ?? new Error('清除目录句柄的事务被中止'))
    })
  },
}

/** 把任意异常收成可展示的 `{ name, message }`（**保留真实错误名**，不吞异常） */
export function describeWidgetError(error: unknown): WidgetBridgeError {
  if (error && typeof error === 'object') {
    const name = (error as { name?: unknown }).name
    const message = (error as { message?: unknown }).message
    return {
      name: typeof name === 'string' && name.length > 0 ? name : 'Error',
      message: typeof message === 'string' && message.length > 0 ? message : String(error as Error),
    }
  }
  return { name: 'Error', message: String(error) }
}

/** 创建一个快照桥（端口可替换，见文件顶部说明） */
export function createWidgetBridge(options: {
  fileSystem: WidgetFileSystemPort
  handleStore: WidgetHandleStore
  fileName?: string
  containerDir?: string
  /** 目录身份验证端口（v3.7.8 P3）；不传就用 P2 的真实实现 */
  verifier?: WidgetDirectoryVerifierPort
}): WidgetBridge {
  const fileName = options.fileName ?? appConfig.widget.snapshotFileName
  const containerDir = options.containerDir ?? appConfig.widget.containerDir
  const filePathLabel = `${containerDir.replace(/\/+$/, '')}/${fileName}`
  // 目标目录名（`.../Application Support/TeacherDesk` 的最后一段）
  const expectedFolderName = containerDir.replace(/\/+$/, '').split('/').pop() ?? 'TeacherDesk'

  const verifier: WidgetDirectoryVerifierPort = options.verifier ?? createWidgetDirectoryVerifier()

  /**
   * **本次会话**已验证通过的句柄（v3.7.8 P3）。
   *
   * 刻意只放在内存里、**不落 IndexedDB**：目录身份是「这个句柄 == 扩展真正读的容器」，
   * 只有当场问宿主才算数；存一个 `verified: true` 到盘上，下次启动它就不再是证据。
   * 于是页面一刷新就回到 `needs-verify`，用户点一次即可原地重新验证（不弹选择框）。
   */
  let verifiedHandle: WidgetDirectoryHandleLike | undefined

  /**
   * 连接请求序号（v3.7.8 P3.3）。
   *
   * 每次 `connect()` 进来先自增；**验证返回之后**再看一眼自己是不是最新那一次：
   * 不是就直接返回 `superseded`，既不落句柄也不写快照。
   *
   * 为什么必须有：验证要等宿主 1–2 秒，这期间用户完全可能再点一次（或双击）。
   * 只靠按钮 `disabled` 兜不住同一帧内的两次点击，而「旧的那次晚一步返回」
   * 会把新连接刚写好的状态盖回去。序号是这里唯一可靠的判据。
   */
  let connectSeq = 0

  /**
   * 句柄写入的**串行队列**（v3.7.8 P3.6）。
   *
   * 为什么不能只靠「写完之后再判一次序号」：`handleStore.write()` 是异步的，
   * 两次写入的完成顺序不保证等于调用顺序；旧请求晚到的 `put` 会把新句柄盖掉。
   * P3.5 用「补偿写入」救过一次，但**补偿本身又是一次异步写**，会被第三次连接再超越
   * （补偿永远追不上）。
   *
   * 改成「排队 + 轮到执行时再判序号」：写入按调用顺序串行落盘；执行那一刻如果已经不是
   * 最新那次，就**一个字节都不写**。于是「最后落地的必然是最新那次」成为结构性事实，
   * 不需要任何补偿。
   */
  let handleWriteChain: Promise<void> = Promise.resolve()

  /**
   * 把句柄排进队列落盘，并**如实回报结果**（v3.7.8 P3.7）。
   *
   * 返回 `written: false` 的两种情形必须分清：
   *  · 轮到自己时已过期（被更新的连接取代）→ 不写，由调用方按 `superseded` 处理；
   *  · 真的写失败（存储不可用 / 事务中止）→ 带 `error`，调用方**不能报成功**。
   */
  function persistHandle(
    handle: WidgetDirectoryHandleLike,
    seq: number,
  ): Promise<{ written: boolean; error?: WidgetBridgeError }> {
    let result: { written: boolean; error?: WidgetBridgeError } = { written: false }
    const run = async () => {
      if (seq !== connectSeq) return // 轮到自己时已过期 → 不写
      try {
        await options.handleStore.write(handle)
        result = { written: true }
      } catch (error) {
        // **不吞**：句柄没落盘，这次连接就不成立
        const described = describeWidgetError(error)
        console.warn(`[widget] 保存目录句柄失败：${described.name}`)
        result = {
          written: false,
          error: { name: 'HandleStoreError', message: described.message },
        }
      }
    }
    const chained = handleWriteChain.then(run)
    handleWriteChain = chained // run 自己兜住了异常，队列不会卡死
    return chained.then(() => result)
  }

  /**
   * 句柄是不是「目标目录」——**落盘前的唯一关卡**（v3.7.8）。
   *
   * 三种拦法，对应现场见过 / 可能见到的三种错：
   * ① `kind === 'file'`：拿到的根本是文件句柄；
   * ② 名字等于快照文件名：教师在选择框里点了 `widget-snapshot.json`（**本次故障的成因**）；
   * ③ 名字不等于目标目录名：选到了**名字不同**的目录（例如 `TeacherDesk-old`、`Data`）。
   *
   * **能力边界（别把这条当已解决）**：`FileSystemDirectoryHandle` 不暴露绝对路径，
   * 这里**只能按目录名排除名字不同的目录**；两个路径不同但**都叫 `TeacherDesk`** 的目录
   * （本机真有：`~/Library/Application Support/TeacherDesk` 是 v1.0.0 遗留的那份）
   * **区分不了**——误选它会校验通过、写入成功、界面报成功，而小组件永远读不到。
   * 想根治得靠「读目录里已有快照的 schemaVersion」之类的额外判据，或者直接清掉遗留目录。
   *
   * 名字拿不到（某些实现）时不做名字判断——宁可通过，也不误伤。
   */
  function inspect(handle: WidgetDirectoryHandleLike): WidgetFolderProblem | undefined {
    const name = handle.name ?? ''
    if (handle.kind === 'file' || (name.length > 0 && name === fileName)) {
      return {
        kind: 'file',
        picked: name.length > 0 ? name : fileName,
        expected: expectedFolderName,
      }
    }
    if (name.length > 0 && name !== expectedFolderName) {
      return { kind: 'name', picked: name, expected: expectedFolderName }
    }
    return undefined
  }

  /**
   * 查 / 要权限的**唯一出口**。
   *
   * 为什么不在端口里把异常折成 `denied`（v3.7.8）：`requestPermission` 抛
   * `SecurityError`（缺用户手势）和「用户点了拒绝」是两件事，界面要说不同的话。
   * 这里把两者分开带出去，但**保证不抛**——`status()` 会在页面加载时被调用，
   * 抛出去就是一个没人接的 Promise。
   */
  async function askPermission(
    handle: WidgetDirectoryHandleLike,
    request: boolean,
  ): Promise<{ state: PermissionState; error?: WidgetBridgeError }> {
    try {
      return { state: await options.fileSystem.permissionOf(handle, request) }
    } catch (error) {
      return { state: 'denied', error: describeWidgetError(error) }
    }
  }

  /**
   * 让宿主确认「这个句柄指向的目录，就是 Widget 扩展真正读的容器」。
   *
   * 返回 `undefined` 表示通过；否则给出该落到的状态与诊断信息。
   * 只有 `verified` 一种结果算通过——`timeout` / `cancelled` 都不算。
   */
  async function verifyHandle(handle: WidgetDirectoryHandleLike): Promise<
    | undefined
    | {
        status: WidgetBridgeStatus
        detail: string
        errorCode?: string
        errorName?: string
        cancelled?: boolean
      }
  > {
    let result: WidgetDirectoryVerificationResult
    try {
      result = await verifier.verify(handle)
    } catch (error) {
      // 验证器本身不该抛（P2 内部已兜底），这里只防万一
      const described = describeWidgetError(error)
      console.warn(`[widget] 目录验证器异常：${described.name}`)
      return { status: 'failed', detail: described.message, errorName: described.name }
    }

    if (result.status === 'verified') return undefined

    if (result.status === 'cancelled') {
      return { status: 'unconnected', detail: '已取消验证', cancelled: true }
    }
    if (result.status === 'timeout') {
      console.warn('[widget] 目录验证超时（12 秒内没收到宿主响应）')
      return { status: 'verify-timeout', detail: '没有收到 macOS 宿主的确认' }
    }

    // failed
    console.warn(
      `[widget] 目录验证失败：reason=${result.reason}${
        result.errorCode ? ` code=${result.errorCode}` : ''
      }${result.errorName ? ` error=${result.errorName}` : ''}`,
    )
    if (result.reason === 'unsupported') {
      return { status: 'unsupported', detail: result.detail ?? '' }
    }
    if (result.reason === 'request-write-failed' || result.reason === 'read-error') {
      // 真实文件系统错误：不是「目录身份不对」，别混为一谈
      return {
        status: 'failed',
        detail: result.detail ?? '',
        ...(result.errorName ? { errorName: result.errorName } : {}),
      }
    }
    return {
      status: 'verify-failed',
      detail: result.detail ?? '',
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
      ...(result.errorName ? { errorName: result.errorName } : {}),
    }
  }

  async function status(): Promise<WidgetBridgeStatus> {
    if (!options.fileSystem.supported()) return 'unsupported'
    const handle = await options.handleStore.read()
    if (!handle) return 'unconnected'
    // 存着的是一个坏句柄（历史遗留）→ 直接说「选错了」，不要拿它去查权限
    if (inspect(handle)) return 'wrong-folder'
    // 有句柄但本次会话没验过身份 → 不许报「已连接」（v3.7.8 P3 的核心闸门）
    if (!verifiedHandle) return 'needs-verify'
    const { state } = await askPermission(verifiedHandle, false)
    return state === 'granted' ? 'connected' : 'needs-permission'
  }

  /** 真正落盘。**失败不抛**，把真实错误名与消息带出去（`TypeMismatchError` 等） */
  async function writeWith(
    handle: WidgetDirectoryHandleLike,
    text: string,
  ): Promise<WidgetWriteOutcome> {
    try {
      const file = await handle.getFileHandle(fileName, { create: true })
      const stream = await file.createWritable()
      await stream.write(text)
      await stream.close()
      return { result: 'written' }
    } catch (error) {
      console.warn('[widget] 写快照失败：', error)
      return { result: 'failed', error: describeWidgetError(error) }
    }
  }

  /** 把一次写入的结果翻成「连接结果」 */
  function finish(outcome: WidgetWriteOutcome, reused: boolean): WidgetConnectOutcome {
    if (outcome.result === 'written') {
      return { status: 'connected', wrote: true, ...(reused ? { reused: true } : {}) }
    }
    return {
      status: 'failed',
      wrote: false,
      ...(reused ? { reused: true } : {}),
      ...(outcome.error ? { error: outcome.error } : {}),
    }
  }

  async function write(text: string): Promise<WidgetWriteOutcome> {
    if (!options.fileSystem.supported()) return { result: 'unsupported' }
    const handle = await options.handleStore.read()
    if (!handle) return { result: 'unconnected' }
    if (inspect(handle)) return { result: 'wrong-folder' }
    // **没验过就不写**：自动同步 / 手动「仅同步」都走这里，闸门只设一次
    if (!verifiedHandle) return { result: 'needs-verify' }
    const { state } = await askPermission(verifiedHandle, false)
    if (state !== 'granted') return { result: 'needs-permission' }
    return writeWith(verifiedHandle, text)
  }

  /** 验证没通过时，把结果原样翻成「连接结果」（**不落盘、不写快照**） */
  function rejectVerification(
    failure: {
      status: WidgetBridgeStatus
      detail: string
      errorCode?: string
      errorName?: string
      cancelled?: boolean
    },
    reused: boolean,
  ): WidgetConnectOutcome {
    return {
      status: failure.status,
      wrote: false,
      ...(reused ? { reused: true } : {}),
      ...(failure.cancelled ? { cancelled: true } : {}),
      ...(failure.errorCode ? { verifyErrorCode: failure.errorCode } : {}),
      ...(failure.errorName ? { error: { name: failure.errorName, message: failure.detail } } : {}),
    }
  }

  return {
    fileName,
    containerDir,
    filePathLabel,
    expectedFolderName,
    status,
    write,

    cancelVerification() {
      verifier.cancel()
    },

    async connect(text) {
      if (!options.fileSystem.supported()) return { status: 'unsupported', wrote: false }

      // 每次连接领一个序号；验证回来之后用它判断自己是不是已经过期
      const seq = ++connectSeq
      const superseded = (): WidgetConnectOutcome => ({
        status: 'unconnected',
        wrote: false,
        cancelled: true,
        superseded: true,
      })

      // ① 复用已存句柄（v3.7.8）：浏览器重启后权限退回 prompt 是常态，
      //    这里在**用户点击**提供的手势上下文里补一次授权，不该逼教师重新选目录。
      const stored = await options.handleStore.read()
      if (stored && !inspect(stored)) {
        const current = await askPermission(stored, false)
        let usable = current.state === 'granted'
        if (current.state === 'prompt') {
          // 只有走到这里才请求权限：`requestPermission` 需要用户手势，
          // 而 `connect()` 只由按钮点击触发（页面加载时绝不调用）。
          const requested = await askPermission(stored, true)
          if (requested.state === 'granted') {
            usable = true
          } else if (requested.error) {
            // 抛错（例如缺用户手势的 SecurityError）→ 是「失败」，不是「没授权」
            return { status: 'failed', wrote: false, error: requested.error }
          } else {
            return { status: 'needs-permission', wrote: false }
          }
        }
        if (usable) {
          // **② 目录身份验证**：权限有了还不够，必须当场问宿主「这是不是容器」
          const failure = await verifyHandle(stored)
          // 验证期间又有人发起连接 → 这次的结果作废（不落句柄、不写快照、不改状态）
          if (seq !== connectSeq) return superseded()
          if (failure) return rejectVerification(failure, true)
          verifiedHandle = stored
          const writeOutcome = await writeWith(stored, text)
          // 写入期间又被超越：这次写入**已经落地**（无法回滚，但落在已验证的目录里），
          // 只是**不再向调用方报成功**——否则界面会被一次过期请求点亮成「已连接」（P3.4）。
          if (seq !== connectSeq) return superseded()
          return finish(writeOutcome, true)
        }
        // denied / 其它 → 句柄已经不可用了，只能重新选
      }

      // ③ 重新选择目录
      const picked = await options.fileSystem.pickDirectory()
      if (!picked) {
        // 用户取消：保持原状（**不覆盖、不删除**已有句柄）
        return { status: await status(), wrote: false, cancelled: true }
      }
      const problem = inspect(picked)
      if (problem) {
        // 选错了：原句柄原样保留，一个字节都不写
        return { status: 'wrong-folder', wrote: false, wrongFolder: problem }
      }
      const requested = await askPermission(picked, true)
      if (requested.state !== 'granted') {
        return requested.error
          ? { status: 'failed', wrote: false, error: requested.error }
          : { status: 'needs-permission', wrote: false }
      }

      // ④ 验证通过才落盘：验证失败时**原句柄与原有连接原样保留**
      const failure = await verifyHandle(picked)
      if (seq !== connectSeq) return superseded()
      if (failure) return rejectVerification(failure, false)

      // 句柄落盘走串行队列：轮到自己时若已不是最新那次，**根本不写**（P3.6）
      const persisted = await persistHandle(picked, seq)
      if (seq !== connectSeq) return superseded()
      if (!persisted.written) {
        // **句柄没落盘，这次连接就不成立**（P3.7）：
        // 不能只把快照写进去就报「已连接」——下次开页面没有句柄，用户会莫名其妙掉线。
        return {
          status: 'failed',
          wrote: false,
          ...(persisted.error ? { error: persisted.error } : {}),
        }
      }
      verifiedHandle = picked
      const writeOutcome = await writeWith(picked, text)
      // 同上：写入落地了，但这次请求已过期 → 不报成功，状态由新的那次决定
      if (seq !== connectSeq) return superseded()
      return finish(writeOutcome, false)
    },

    async disconnect(): Promise<WidgetDisconnectOutcome> {
      // 让任何在途连接作废：排队中的写入会在轮到时被跳过
      connectSeq += 1
      verifiedHandle = undefined
      // **清库也进同一条队列**（P3.7）：必须等「已经开始的写入」落地之后再清，
      // 否则那个写入可能在 clear 之后才提交，把句柄又写回来。
      // 反过来，清库之后的任何新连接都会排在这条 clear 后面，顺序明确。
      //
      // **失败不能污染队列**（P3.8）：这里自己兜住异常，让 `handleWriteChain` 永远是
      // resolved 的——否则一次清库失败就会让后面所有连接都存不进句柄。
      // 但失败本身要如实带出去，不能装作断开成功。
      let error: WidgetBridgeError | undefined
      const clearRun = handleWriteChain.then(async () => {
        try {
          await options.handleStore.clear()
        } catch (caught) {
          error = describeWidgetError(caught)
          console.warn(`[widget] 清除目录句柄失败：${error.name}`)
        }
      })
      handleWriteChain = clearRun
      await clearRun
      return error ? { ok: false, error } : { ok: true }
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
