/**
 * 假浏览器环境（Phase 9C 常驻自检的底座）。
 *
 * 受测代码（`services/storage.ts`、`services/sync.ts`、`services/cloudSync.ts`）在几处
 * 直接摸浏览器：`window.localStorage`、`BroadcastChannel`、`window.addEventListener('online')`、
 * `document.visibilitychange`、`navigator.onLine`。自检在 Node 里跑，这几样一个都没有。
 *
 * **不用 jsdom**，理由是自检要验的东西恰好是「真实浏览器里造不出来的处境」：
 * 「另一个标签页发来一条消息」「写到一半断网」「刷新之后盘上还剩什么」——
 * jsdom 给的是**真的** localStorage 与真的通道（跨 test 串味、难清），
 * 而这里给的是**能按秒表控制的替身**：
 * - 内存版存储，可数写入次数（幂等断言靠它：内容没变时**一次都不该写**）；
 * - 假通道只记录消息，不自动投递——投递是显式的 `emit()`，代表「另一个标签页发了这条」；
 * - `setOnline(false)` 能真的让 `statusOfError` 判成「连不上」。
 *
 * 自检**不依赖真实 CloudBase**（§十五）：`vi.mock('@/services/cloudbase')` 把远端换成
 * 内存假云端，本文件只负责浏览器那一半。
 */

/** 内存版 Storage：`localStorage` / `sessionStorage` 的替身，带写入计数 */
export class MemoryStorage {
  private readonly map = new Map<string, string>()
  private readonly writeCounts = new Map<string, number>()

  /** 自检用：`setItem` 一共被调用了几次（含存储层自己的「写盘时刻」表） */
  writes = 0
  /** 自检用：`removeItem` 被调用了几次 */
  removes = 0

  get length(): number {
    return this.map.size
  }

  /** 自检用：**某一个键**被写了几次。幂等断言看的是它——那一刻的写入也会顺带写写盘时刻表 */
  writesFor(key: string): number {
    return this.writeCounts.get(key) ?? 0
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.writes += 1
    this.writeCounts.set(key, this.writesFor(key) + 1)
    this.map.set(key, String(value))
  }

  removeItem(key: string): void {
    this.removes += 1
    this.map.delete(key)
  }

  clear(): void {
    this.map.clear()
  }

  /** 自检用：盘上现在有什么（断言不经过被测代码读，避免「用被测对象验证自己」） */
  entries(): Record<string, string> {
    return Object.fromEntries(this.map)
  }

  /** 自检用：直接塞一份原文进去，扮演「上一次运行留下的缓存」 */
  seed(key: string, value: string): void {
    this.map.set(key, value)
  }

  /** 自检用：计数器清零（只在断言前后测量一段区间时用） */
  resetCounters(): void {
    this.writes = 0
    this.removes = 0
    this.writeCounts.clear()
  }
}

/** 广播通道收到的消息（`SyncMessage` 的形状，这里不 import 是为了不改动被测模块的导出面） */
export interface PostedMessage {
  kind: string
  keys?: string[]
}

type MessageListener = (event: { data: unknown }) => void

/**
 * 假广播通道：**只记录，不投递**。
 *
 * 自动投递会让「另一个标签页」在本进程里凭空出现，把单标签页的断言搅乱
 * （比如幂等性测试：自己广播的消息绕回来又改一次数据）。所以投递必须显式调用
 * `emit()`——那一行就代表「另一个标签页发来了这条消息」，出现在测试里比藏在替身里清楚。
 *
 * `vi.resetModules()` 模拟刷新时，`services/sync.ts` 会重新建一个通道实例：
 * 于是同一个进程里存在多个实例，正好对应「刷新前的那个标签页」与「刷新后的这个」。
 */
export class FakeBroadcastChannel {
  /** 本进程里建过的全部通道，按创建顺序（最后一个 = 最近一次加载出来的那个标签页） */
  static all: FakeBroadcastChannel[] = []

  readonly name: string
  /** 这个标签页**广播出去**的消息 */
  readonly posted: PostedMessage[] = []
  private readonly listeners = new Set<MessageListener>()

  constructor(name: string) {
    this.name = name
    FakeBroadcastChannel.all.push(this)
  }

  addEventListener(_type: string, listener: MessageListener): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: string, listener: MessageListener): void {
    this.listeners.delete(listener)
  }

  postMessage(data: unknown): void {
    this.posted.push(data as PostedMessage)
  }

  close(): void {
    this.listeners.clear()
  }

  /** 扮演「另一个标签页发来一条消息」（只发给这一个标签页的监听者） */
  emit(data: unknown): void {
    for (const listener of [...this.listeners]) listener({ data })
  }

  /** 最后一次加载出来的通道（即「当前这个标签页」）；没建过则为 null */
  static latest(): FakeBroadcastChannel | null {
    return FakeBroadcastChannel.all.at(-1) ?? null
  }

  /** 全部标签页广播过的消息条数 */
  static postedTotal(): number {
    return FakeBroadcastChannel.all.reduce((sum, channel) => sum + channel.posted.length, 0)
  }

  static reset(): void {
    FakeBroadcastChannel.all = []
  }
}

type Listener = (...args: unknown[]) => void

/** 假 `window` / `document` / `BroadcastChannel` 的宿主，一次装好，测试里随时取用 */
export class FakeBrowser {
  readonly localStorage = new MemoryStorage()
  readonly sessionStorage = new MemoryStorage()
  /** `document.visibilityState`：自检可以把它改成 `hidden` 再派发事件 */
  visibilityState = 'visible'

  readonly window: Record<string, unknown>
  readonly document: Record<string, unknown>

  private readonly windowListeners = new Map<string, Set<Listener>>()
  private readonly documentListeners = new Map<string, Set<Listener>>()

  constructor() {
    // 类字段在上面已初始化完（字段初始化先于构造体），所以这些箭头函数可以放心用 `this`
    this.window = {
      localStorage: this.localStorage,
      sessionStorage: this.sessionStorage,
      addEventListener: (type: string, listener: Listener) => {
        const set = this.windowListeners.get(type) ?? new Set<Listener>()
        set.add(listener)
        this.windowListeners.set(type, set)
      },
      removeEventListener: (type: string, listener: Listener) => {
        this.windowListeners.get(type)?.delete(listener)
      },
      // 共享时钟（`useToday.ts`）用 `window.setInterval` 每 30 秒翻一页：这里转给 Node
      // 自己的定时器。**不假装成空实现**——一个「装上了却永远不走」的时钟会让将来
      // 依赖它的用例得出莫名其妙的结果；Node 的定时器由 vitest 在收工时统一清掉。
      setInterval: (handler: () => void, timeout?: number) => setInterval(handler, timeout),
      clearInterval: (id: unknown) => clearInterval(id as never),
      setTimeout: (handler: () => void, timeout?: number) => setTimeout(handler, timeout),
      clearTimeout: (id: unknown) => clearTimeout(id as never),
    }
    this.document = {
      addEventListener: (type: string, listener: Listener) => {
        const set = this.documentListeners.get(type) ?? new Set<Listener>()
        set.add(listener)
        this.documentListeners.set(type, set)
      },
      removeEventListener: (type: string, listener: Listener) => {
        this.documentListeners.get(type)?.delete(listener)
      },
    }
    // 用取值器而不是写死的快照：改 `visibilityState` 后派发 `visibilitychange`，
    // 被测代码读到的必须是**改过之后**的值（否则「回到前台」这条路径永远测不到）
    Object.defineProperty(this.document, 'visibilityState', {
      get: () => this.visibilityState,
    })
  }

  /**
   * 断网 / 恢复网络。
   *
   * 两件事一起做，因为它们代表同一个外部事实：`navigator.onLine` 立即翻面，
   * 恢复时派发 `online` 事件（`startCloudSync` 就是靠它触发补推的）。
   * 不派发 `online` 而只翻 `onLine`，等于「网回来了但没人通知应用」——
   * 那种状态在浏览器里不存在，测出来的是个假处境。
   */
  setOnline(online: boolean): void {
    const nav = globalThis.navigator
    if (nav !== undefined) {
      Object.defineProperty(nav, 'onLine', { value: online, configurable: true, writable: true })
    }
    if (online) this.dispatchWindow('online')
  }

  /** 派发一个 window 事件（`online` 用） */
  dispatchWindow(type: string): void {
    for (const listener of [...(this.windowListeners.get(type) ?? [])]) listener()
  }

  /** 派发一个 document 事件（`visibilitychange` 用）；改 `visibilityState` 后调用 */
  dispatchDocument(type: string): void {
    for (const listener of [...(this.documentListeners.get(type) ?? [])]) listener()
  }
}

/**
 * 装上假浏览器，返回它的句柄。每个 `beforeEach` 调一次即可：
 * 存储、通道、监听器全部换新，测试之间不串味。
 */
export function installFakeBrowser(): FakeBrowser {
  const browser = new FakeBrowser()
  const g = globalThis as unknown as Record<string, unknown>

  FakeBroadcastChannel.reset()
  g.window = browser.window
  g.document = browser.document
  Object.defineProperty(g, 'BroadcastChannel', {
    value: FakeBroadcastChannel,
    configurable: true,
    writable: true,
  })
  // 默认判成「有网」：断网要显式摆出来（`setOnline(false)`），
  // 否则一条「没连上」的断言可能在真断网的机器上假通过
  browser.setOnline(true)
  return browser
}
