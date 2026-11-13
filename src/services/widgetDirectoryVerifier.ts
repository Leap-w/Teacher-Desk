/**
 * 网页端的**目录身份验证器**（v3.7.8 P2）
 *
 * ## 它解决的是什么
 *
 * 机器上可能有两个都叫 `TeacherDesk` 的目录，而 `FileSystemDirectoryHandle` 不暴露绝对路径，
 * 网页端只能比目录名——两个一样，分不清。于是走「挑战—应答」：
 *
 *      <用户选中的目录>/td-verify-<nonce>.req      ← 本模块写
 *            ↓ teacherdesk://verify?nonce=<nonce>
 *      宿主只在自己的 Widget 容器里找这个 .req
 *            ↓
 *      <容器>/td-verify-<nonce>.res                ← 宿主写（P1）
 *            ↓ 网页在**自己选中的目录**里读
 *      读到且 nonce/协议都对 → 证明「选中的目录 == 扩展真正读的目录」
 *
 * 选错目录时，响应写进了容器，网页在错误目录里永远读不到 → **表现为 timeout**。
 * 所以 `timeout` 绝不能翻译成「你选错了目录」——它也可能是宿主没装、没响应、或用户没确认。
 *
 * ## 本阶段的边界（P2 不接闸门）
 *
 * 这里**只提供能力**：不改 `widgetBridge.ts` 的连接条件、不改 `connect()` 的落盘时机、
 * 不改 `write()`/`status()`、不改卡片交互。谁在什么时候调用它，是 P3 的事。
 * 因此本模块**不 import 项目里的任何东西**（连 `appConfig` 都不），纯到可以在 node 里跑。
 *
 * ## 协议常量必须与原生端逐字段一致
 *
 * 对端：`macos/Shared/ContainerVerifier.swift`。改一处就要两边一起改，
 * 否则表现是「宿主明明写了响应、网页却说超时」。
 */

/** 协议版本（与 Swift 侧 `WidgetVerifyProtocol.version` 同值） */
export const WIDGET_VERIFY_PROTOCOL = 1
/** 请求文件的 `type` */
export const WIDGET_VERIFY_REQUEST_TYPE = 'teacherdesk.widget.verify'
/** 响应文件的 `type` */
export const WIDGET_VERIFY_RESPONSE_TYPE = 'teacherdesk.widget.verify.result'
/** 文件名前缀 / 后缀（与 Swift 侧同名常量同值） */
export const WIDGET_VERIFY_FILE_PREFIX = 'td-verify-'
export const WIDGET_VERIFY_REQUEST_SUFFIX = '.req'
export const WIDGET_VERIFY_RESPONSE_SUFFIX = '.res'
/** 轮询间隔与总超时（宿主冷启动通常 1–2 秒；12 秒是留给「浏览器弹协议确认框」的余量） */
export const WIDGET_VERIFY_POLL_INTERVAL_MS = 300
export const WIDGET_VERIFY_TIMEOUT_MS = 12_000
/** 连续几次读不出合法响应就放弃（宿主是原子写，正常情况下一次就该读到） */
const MAX_CONSECUTIVE_BAD_RESPONSES = 3
/** 连续几次读文件报错就放弃（`NotFoundError` 不算错，那是「还没写」） */
const MAX_CONSECUTIVE_READ_ERRORS = 3

/* ==================== 句柄（只声明用到的那几个能力） ==================== */

export interface WidgetVerifyWritable {
  write(data: string): Promise<void>
  close(): Promise<void>
}

export interface WidgetVerifyFileHandle {
  createWritable(): Promise<WidgetVerifyWritable>
  /** 真实 `FileSystemFileHandle` 有；测试假体可以不实现 */
  getFile?(): Promise<{ text(): Promise<string> }>
}

export interface WidgetVerifyDirectoryHandle {
  readonly name?: string
  getFileHandle(name: string, options?: { create?: boolean }): Promise<WidgetVerifyFileHandle>
  /** 真实目录句柄有；没有就跳过清理（只影响临时文件，不影响判定） */
  removeEntry?(name: string): Promise<void>
}

/* ==================== 结果 ==================== */

/**
 * 失败原因——**每一种都单独可辨**，不统一成「授权失败」。
 *
 * `timeout` 与 `cancelled` 是独立的状态（不在这个联合里），因为它们不是「失败原因」，
 * 而是「没得出结论」和「主动放弃」。
 */
export type WidgetVerifyFailureReason =
  /** 浏览器没有 File System Access API */
  | 'unsupported'
  /** 本地生成的 nonce 不合法（正常不会发生，纯防御） */
  | 'invalid-nonce'
  /** 请求文件写不进去（磁盘 / 权限 / 目录被删） */
  | 'request-write-failed'
  /** 深链发不出去（宿主没装时浏览器通常静默失败，走到这里是抛了异常） */
  | 'host-not-reached'
  /** 宿主明确回了 `ok: false`（带 `errorCode`） */
  | 'rejected'
  /** 响应存在但内容不合协议（nonce/protocol/type 不符，或反复读不出合法 JSON） */
  | 'bad-response'
  /** 读响应文件时报了 `NotFoundError` 以外的错（权限被收回等） */
  | 'read-error'

export type WidgetDirectoryVerificationResult =
  | { status: 'verified'; nonce: string }
  | {
      status: 'failed'
      reason: WidgetVerifyFailureReason
      detail?: string
      /** 宿主给的失败码（`rejected` 时才有） */
      errorCode?: string
      /** 真实文件系统错误名（`request-write-failed` / `read-error` 时才有） */
      errorName?: string
      /**
       * 请求写入卡在哪一步（v3.7.8 P3 诊断用）。
       *
       * 起因：P2.1 联调里出现过一次 7ms 的 `request-write-failed / NotFoundError`，
       * 之后 8 次都没复现。加上这一步之后，万一再来一次，日志能直接说明是
       * `getFileHandle`（句柄失效 / 目录被删）还是 `createWritable`（权限被收回）……
       * 而不是只有一个笼统的 NotFoundError。
       */
      stage?: WidgetVerifyWriteStage
    }
  /** 12 秒内没读到有效响应：**不代表选错目录**，见文件头 */
  | { status: 'timeout'; nonce: string }
  | { status: 'cancelled'; nonce?: string }

/** 写请求文件的四个步骤（失败时带出去，便于定位） */
export type WidgetVerifyWriteStage = 'getFileHandle' | 'createWritable' | 'write' | 'close'

/* ==================== 环境（可注入，便于在 node 里跑） ==================== */

export interface WidgetVerifyEnvironment {
  /** 浏览器是否支持 File System Access API */
  supported(): boolean
  /** 生成一次性 nonce（生产 = `crypto.randomUUID()`） */
  createNonce(): string
  /** 唤起宿主（生产 = 跳 `teacherdesk://verify`） */
  notifyHost(nonce: string): void
  /** 当前时间（毫秒） */
  now(): number
  /** 可中断的等待 */
  sleep(ms: number, signal?: AbortSignal): Promise<void>
}

/** 等一会儿，且能被 `AbortSignal` 立刻打断（取消不该再等满 300ms） */
function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(finish, ms)
    function finish() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    signal?.addEventListener('abort', finish, { once: true })
  })
}

/** 生成 nonce：优先 `crypto.randomUUID()`（36 位、含连字符，天然合法） */
function defaultCreateNonce(): string {
  const crypto = globalThis.crypto
  if (crypto?.randomUUID) return crypto.randomUUID()
  // 退路：32 位十六进制，同样落在「16…64 位 [A-Za-z0-9-]」的合法范围里
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const defaultEnvironment: WidgetVerifyEnvironment = {
  supported() {
    if (typeof window === 'undefined') return false
    const picker = (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker
    return typeof picker === 'function'
  },
  createNonce: defaultCreateNonce,
  notifyHost(nonce) {
    if (typeof window === 'undefined') return
    // 与 `openWidgetHostRefresh()` 同一种调用方式（用户手势里跳转，浏览器才允许拉起外部协议）
    window.location.href = `teacherdesk://verify?nonce=${encodeURIComponent(nonce)}`
  },
  now: () => Date.now(),
  sleep: defaultSleep,
}

/* ==================== nonce / 文件名 / 报文 ==================== */

/**
 * nonce 合法性：**必须与 Swift 侧 `ContainerVerifier.isValidNonce` 一致**。
 *
 * 字符集是硬约束——nonce 会被拼进文件名，`../` 这类东西在这里就挡掉，
 * 不能指望后面的路径拼接「应该没问题」。
 */
export function isValidVerifyNonce(nonce: string): boolean {
  return /^[A-Za-z0-9-]{16,64}$/.test(nonce)
}

/** 请求文件名：`td-verify-<nonce>.req` */
export function verifyRequestFileName(nonce: string): string {
  return `${WIDGET_VERIFY_FILE_PREFIX}${nonce}${WIDGET_VERIFY_REQUEST_SUFFIX}`
}

/** 响应文件名：`td-verify-<nonce>.res` */
export function verifyResponseFileName(nonce: string): string {
  return `${WIDGET_VERIFY_FILE_PREFIX}${nonce}${WIDGET_VERIFY_RESPONSE_SUFFIX}`
}

export interface WidgetVerifyRequestPayload {
  protocol: number
  type: string
  nonce: string
  createdAt: string
}

/** 构造请求报文（`createdAt` 用 `toISOString()`，与宿主认的格式一致） */
export function buildVerifyRequest(nonce: string, at: Date): WidgetVerifyRequestPayload {
  return {
    protocol: WIDGET_VERIFY_PROTOCOL,
    type: WIDGET_VERIFY_REQUEST_TYPE,
    nonce,
    createdAt: at.toISOString(),
  }
}

/** 响应解析结果：**`incomplete` 与 `mismatch` 必须分开**——前者可以重试，后者不能 */
export type WidgetVerifyResponseParse =
  | { kind: 'ok' }
  | { kind: 'rejected'; errorCode: string; detail: string }
  | { kind: 'mismatch'; detail: string }
  | { kind: 'incomplete'; detail: string }

/**
 * 严格解析响应报文。
 *
 * 成功必须**同时**满足：`protocol === 1`、`type` 正确、`nonce` 与本次一致、`ok === true`。
 * 少一条都不算——「文件存在」「能读出来」都不是证据。
 */
export function parseVerifyResponse(
  text: string,
  expectedNonce: string,
): WidgetVerifyResponseParse {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    // 可能是宿主还没写完（虽然有原子写，仍留一次重试机会）
    return { kind: 'incomplete', detail: '响应还不是完整 JSON' }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { kind: 'mismatch', detail: '响应不是 JSON 对象' }
  }
  const value = raw as Record<string, unknown>
  if (value.protocol !== WIDGET_VERIFY_PROTOCOL) {
    return { kind: 'mismatch', detail: `响应 protocol 不是 ${WIDGET_VERIFY_PROTOCOL}` }
  }
  if (value.type !== WIDGET_VERIFY_RESPONSE_TYPE) {
    return { kind: 'mismatch', detail: '响应 type 不符' }
  }
  if (value.nonce !== expectedNonce) {
    return { kind: 'mismatch', detail: '响应 nonce 与本次请求不一致' }
  }
  if (typeof value.ok !== 'boolean') {
    return { kind: 'mismatch', detail: '响应缺少布尔字段 ok' }
  }
  if (value.ok) return { kind: 'ok' }
  return {
    kind: 'rejected',
    errorCode: typeof value.errorCode === 'string' ? value.errorCode : 'unknown',
    detail: typeof value.detail === 'string' ? value.detail : '',
  }
}

/* ==================== 主流程 ==================== */

function describeError(error: unknown): { name: string; message: string } {
  if (error && typeof error === 'object') {
    const name = (error as { name?: unknown }).name
    const message = (error as { message?: unknown }).message
    return {
      name: typeof name === 'string' && name.length > 0 ? name : 'Error',
      message: typeof message === 'string' && message.length > 0 ? message : String(error),
    }
  }
  return { name: 'Error', message: String(error) }
}

type ReadResult =
  | { kind: 'missing' }
  | { kind: 'text'; text: string }
  | { kind: 'error'; name: string; message: string }

/** 读响应文件；`NotFoundError` 视为「还没写」，其余算真错误 */
async function readResponseFile(
  handle: WidgetVerifyDirectoryHandle,
  name: string,
): Promise<ReadResult> {
  let file: WidgetVerifyFileHandle
  try {
    file = await handle.getFileHandle(name)
  } catch (error) {
    const described = describeError(error)
    return described.name === 'NotFoundError'
      ? { kind: 'missing' }
      : { kind: 'error', name: described.name, message: described.message }
  }
  if (typeof file.getFile !== 'function') {
    return { kind: 'error', name: 'NotSupportedError', message: '句柄不支持读取文件内容' }
  }
  try {
    const blob = await file.getFile()
    return { kind: 'text', text: await blob.text() }
  } catch (error) {
    const described = describeError(error)
    return described.name === 'NotFoundError'
      ? { kind: 'missing' }
      : { kind: 'error', name: described.name, message: described.message }
  }
}

/**
 * 清理本次请求的两个临时文件。
 *
 * **绝不影响已经得出的结论**：删不掉只记一条 warn（页面突然关闭时根本执行不到，
 * 那时靠宿主的 10 分钟残留清理兜底）。
 */
async function cleanupTempFiles(
  handle: WidgetVerifyDirectoryHandle,
  names: readonly string[],
): Promise<void> {
  if (typeof handle.removeEntry !== 'function') return
  for (const name of names) {
    try {
      await handle.removeEntry(name)
    } catch (error) {
      const described = describeError(error)
      if (described.name !== 'NotFoundError') {
        console.warn(`[widget-verify] 清理 ${name} 失败：${described.name} ${described.message}`)
      }
    }
  }
}

export interface VerifyWidgetDirectoryOptions {
  /** 用户通过目录选择器取得的句柄（**不接受任何路径字符串**） */
  handle: WidgetVerifyDirectoryHandle
  signal?: AbortSignal
  /** 测试用：替换时间 / 等待 / 唤起宿主 / nonce 生成 */
  environment?: Partial<WidgetVerifyEnvironment>
}

/**
 * 验证「这个目录是不是 Widget 扩展真正读的容器」。
 *
 * 调用方必须在**用户手势**里调用（内部会跳自定义协议）；页面加载时不得自动调用。
 */
export async function verifyWidgetDirectory(
  options: VerifyWidgetDirectoryOptions,
): Promise<WidgetDirectoryVerificationResult> {
  const env: WidgetVerifyEnvironment = { ...defaultEnvironment, ...options.environment }
  const { handle, signal } = options

  if (!env.supported()) {
    return { status: 'failed', reason: 'unsupported', detail: '当前浏览器不支持文件系统访问' }
  }

  const nonce = env.createNonce()
  if (!isValidVerifyNonce(nonce)) {
    return { status: 'failed', reason: 'invalid-nonce', detail: '生成的 nonce 不合法' }
  }

  const requestName = verifyRequestFileName(nonce)
  const responseName = verifyResponseFileName(nonce)
  const tempNames = [requestName, responseName] as const

  /**
   * 本次验证的清理闸（v3.7.8 P3.3）。
   *
   * 用 `finally` 兜住**所有**结束路径：正常返回、超时、取消，以及任何一步抛出的意外异常
   * （`createWritable` / `getFile` / `text()` / `sleep` 都可能抛）。`cleaned` 保证只执行一次；
   * 清理失败只记 warn，**绝不改变已经得出的结论**。
   */
  let cleaned = false
  const cleanupOnce = async (): Promise<void> => {
    if (cleaned) return
    cleaned = true
    await cleanupTempFiles(handle, tempNames)
  }

  try {
    // ① 写请求文件：**写完才唤起宿主**（顺序反了就是让宿主去找一个还不存在的文件）
    //
    // 四个步骤分别记录 `stage`：`NotFoundError` 出现在 `getFileHandle` 说明句柄已失效
    // （目录被删 / 句柄被回收），出现在 `createWritable` 说明权限被收回——
    // 这两种原因在界面上都是「写不进去」，但排查方向完全不同（v3.7.8 P3）。
    let stage: WidgetVerifyWriteStage = 'getFileHandle'
    try {
      const file = await handle.getFileHandle(requestName, { create: true })
      stage = 'createWritable'
      const writable = await file.createWritable()
      stage = 'write'
      await writable.write(JSON.stringify(buildVerifyRequest(nonce, new Date(env.now()))))
      stage = 'close'
      await writable.close()
    } catch (error) {
      const described = describeError(error)
      console.warn(
        `[widget-verify] 请求写入失败 stage=${stage} name=${described.name} nonce=${nonce}`,
      )
      return {
        status: 'failed',
        reason: 'request-write-failed',
        detail: described.message,
        errorName: described.name,
        stage,
      }
    }

    if (signal?.aborted) {
      return { status: 'cancelled', nonce }
    }

    // ② 唤起宿主（失败不代表验证失败，但也不代表成功——只是没法继续等）
    try {
      env.notifyHost(nonce)
    } catch (error) {
      const described = describeError(error)
      return {
        status: 'failed',
        reason: 'host-not-reached',
        detail: described.message,
        errorName: described.name,
      }
    }

    // ③ 轮询响应：只认**本次 nonce** 的那一个文件
    const deadline = env.now() + WIDGET_VERIFY_TIMEOUT_MS
    let badResponses = 0
    let readErrors = 0

    while (env.now() < deadline) {
      if (signal?.aborted) {
        return { status: 'cancelled', nonce }
      }

      const read = await readResponseFile(handle, responseName)

      if (read.kind === 'error') {
        readErrors += 1
        if (readErrors >= MAX_CONSECUTIVE_READ_ERRORS) {
          return {
            status: 'failed',
            reason: 'read-error',
            detail: read.message,
            errorName: read.name,
          }
        }
      } else if (read.kind === 'text') {
        readErrors = 0
        const parsed = parseVerifyResponse(read.text, nonce)
        if (parsed.kind === 'ok') {
          return { status: 'verified', nonce }
        }
        if (parsed.kind === 'rejected') {
          return {
            status: 'failed',
            reason: 'rejected',
            errorCode: parsed.errorCode,
            detail: parsed.detail,
          }
        }
        if (parsed.kind === 'mismatch') {
          // nonce / protocol / type 不对：**当场拒绝**，不重试、不通过
          return { status: 'failed', reason: 'bad-response', detail: parsed.detail }
        }
        badResponses += 1
        if (badResponses >= MAX_CONSECUTIVE_BAD_RESPONSES) {
          return { status: 'failed', reason: 'bad-response', detail: parsed.detail }
        }
      } else {
        // 还没写出来：继续等
        readErrors = 0
        badResponses = 0
      }

      await env.sleep(WIDGET_VERIFY_POLL_INTERVAL_MS, signal)
    }

    return { status: 'timeout', nonce }
  } finally {
    await cleanupOnce()
  }
}

/**
 * 一次只跑一个验证的会话（给 P3 用）。
 *
 * 解决两件事：**重复点击**（新的取消旧的）与**页面卸载**（调用 `cancel()`）。
 * 注意它不会在页面加载时自动发起任何东西。
 */
export function createWidgetDirectoryVerifier(environment?: Partial<WidgetVerifyEnvironment>) {
  let current: AbortController | undefined

  return {
    /** 发起一次验证；若上一次还没结束，先把它取消掉 */
    async verify(handle: WidgetVerifyDirectoryHandle): Promise<WidgetDirectoryVerificationResult> {
      if (current) {
        console.warn('[widget-verify] 新的验证取代了上一次，旧的已取消')
        current.abort()
      }
      const controller = new AbortController()
      current = controller
      try {
        return await verifyWidgetDirectory({
          handle,
          signal: controller.signal,
          ...(environment ? { environment } : {}),
        })
      } finally {
        if (current === controller) current = undefined
      }
    },
    /** 取消进行中的验证（页面卸载 / 用户点取消时调用） */
    cancel(): void {
      current?.abort()
    },
    /** 是否有验证正在进行 */
    get running(): boolean {
      return current !== undefined
    },
  }
}
