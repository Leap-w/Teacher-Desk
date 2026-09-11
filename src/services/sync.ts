/**
 * 跨标签页 / 双入口同步（Phase 9A，技术债 #2）：同一台设备上开两个入口时，
 * 一个改了数据，另一个立刻跟上——不再出现「两个窗口各改各的，后写的把先写的整份覆盖掉」。
 *
 * 覆盖的场景：同一个浏览器里的两个标签页、浏览器标签页与已安装的 PWA 独立窗口。
 * **不覆盖**（写进开发手册的边界，别让教师以为开了两个入口就一定同步）：
 * - 换设备 / 换浏览器——那是 Phase 9 后端接入要解决的；
 * - iOS 的 Safari 与「添加到主屏幕」的 PWA：两者**存储本来就是隔离的分区**，
 *   前端读不到同一份 localStorage，这里做什么都无效——只有后端能统一。
 *
 * 协议：只广播**键名**，不广播数据。接收方从（同源的）localStorage 重读最新值，
 * 再走各 store 既有的 `normalize*`。好处有二：消息极小；旧版本 PWA 写下的数据
 * 也会被当前版本的规范化逻辑收拾一遍，不会因为两个入口版本不同而把脏数据吃进内存。
 *
 * 与写盘的关系见 `services/storage.ts` 的 `writeJSON`：它幂等，所以「收到远端更新 →
 * 替换内存 → 触发写盘」这条链会在第二次写盘处自然终止，不会两个入口互相触发形成乒乓。
 */
import { watch, type Ref } from 'vue'

import { appConfig } from '@/config'
import { keyLabel, readListStrict, writeJSON } from '@/services/storage'

/** 频道名（同源、同浏览器）；导出给自检脚本，用来扮演「另一个标签页」 */
export const SYNC_CHANNEL_NAME = `${appConfig.storageKeyPrefix}:sync`

export type SyncMessage =
  /** 这些键变了，请重读（只广播键名，数据自己去 localStorage 取） */
  | { kind: 'keys'; keys: string[] }
  /** 数据被整批替换（导入备份 / 清空数据），请整页重载而不是逐键对齐 */
  | { kind: 'reload' }

/** 键名 → 「拿到新值后怎么更新内存」的回调（每个持久化的 store 注册一个） */
const keyHandlers = new Map<string, Set<(raw: unknown[]) => void>>()

/** 整批替换时的处理（应用入口注册：整页重载） */
let reloadHandler: (() => void) | null = null

/** 「本页有东西变了」的处理（云端同步注册：把变更推上去） */
let dirtyHandler: ((key: string) => void) | null = null

let channel: BroadcastChannel | null = null

/**
 * 取通道（惰性创建：模块导入时不碰它，SSR / 自检脚本导入本模块不会有副作用）。
 * 没有 BroadcastChannel 时**静默降级为「不同步」**——这是体验降级，不该让应用起不来。
 */
function getChannel(): BroadcastChannel | null {
  if (channel) return channel
  if (typeof BroadcastChannel !== 'function') return null
  try {
    channel = new BroadcastChannel(SYNC_CHANNEL_NAME)
    channel.addEventListener('message', handleMessage)
    return channel
  } catch (error) {
    console.warn('[sync] 无法建立跨标签页通道，本次运行不做同步：', error)
    return null
  }
}

function handleMessage(event: MessageEvent): void {
  const message: unknown = event.data
  if (typeof message !== 'object' || message === null) return
  const kind = (message as { kind?: unknown }).kind
  if (kind === 'reload') {
    reloadHandler?.()
    return
  }
  if (kind !== 'keys') return
  const keys = (message as { keys?: unknown }).keys
  if (!Array.isArray(keys)) return
  applySyncKeys(keys)
}

/**
 * 「这些键在别处变了」的统一处理：重读盘上内容 → 归一化 → 替换内存状态。
 *
 * **不对外导出给业务用**（只有 `handleMessage` 与 `services/cloudSync.ts` 两个调用方）：
 * 盘上内容变化只有两个来源——同设备另一个入口（广播消息），或云端拉下来的更新。
 * 两条路必须落到同一个函数上，否则「同步后内存怎么更新」会长出第二份实现，
 * 而它跟首屏加载用的 `reviveXxx` 一旦分叉，同一份数据在三条路径上会有三种样子。
 */
export function applySyncKeys(keys: readonly string[]): void {
  for (const key of keys) {
    if (typeof key !== 'string') continue
    const handlers = keyHandlers.get(key)
    if (!handlers) {
      // 收到一个没人订的键：要么是键名写错（写盘广播两处对不上，数据永远不会同步，
      // 而界面上看不出任何异常），要么是同源页面在跑旧版本。两种情况都该有人知道，
      // 但**不能中断**——别人发的消息不该影响这一页的其余处理。
      console.warn(`[sync] 收到「${keyLabel(key)}」的变更，但本页没有 store 订阅它`)
      continue
    }
    // 读到「键不存在」（对方那边被删了）或「内容损坏」时都**不动内存**：
    // 整批删除走的是 reload 消息；内容损坏时盘上原文保留，等下一次真实写入，
    // 拿一次读取失败去覆盖内存里的好数据只会把原文冲掉（Phase 9A 交付前审查修复）
    const raw = readListStrict(key)
    if (raw === null) continue
    for (const handler of handlers) handler(raw)
  }
}

/**
 * 已被 store 接进同步的键（按注册顺序）。
 *
 * 给 `services/cloudSync.ts` 用：云端同步要同步哪些键，不该另立一张写死的键名清单
 * （那种清单一定会漏掉将来新增的 store，而漏掉的表现是「这个模块就是不同步」，
 * 界面上完全看不出来）。以注册表为准，`syncPersisted` 接了几个就同步几个。
 */
export function syncedKeys(): string[] {
  return [...keyHandlers.keys()]
}

/** 广播「这些键变了」。写盘真的发生后才调用（见 syncPersisted） */
export function broadcastKeys(keys: string[]): void {
  if (keys.length === 0) return
  getChannel()?.postMessage({ kind: 'keys', keys } satisfies SyncMessage)
}

/** 广播「数据被整批替换了，请整页重载」（导入备份 / 清空数据后调用） */
export function broadcastReload(): void {
  getChannel()?.postMessage({ kind: 'reload' } satisfies SyncMessage)
}

/**
 * 订阅某个键的远端变更（拿到的是重读+解析后的原始列表，调用方负责规范化）。
 *
 * **不对外导出**：唯一的注册路径是 `syncPersisted`。手写订阅很容易漏掉写盘那一半，
 * 而「收到远端更新后本页也写盘」正是幂等写要终止回声的那条链——漏了它，这一页就成了
 * 只进不出的黑洞：改了不广播，别人也永远等不到它。
 */
function onSyncKeys(key: string, handler: (raw: unknown[]) => void): void {
  getChannel()
  const handlers = keyHandlers.get(key) ?? new Set()
  handlers.add(handler)
  keyHandlers.set(key, handlers)
}

/** 订阅「整批替换」消息（应用入口注册：整页重载） */
export function onSyncReload(handler: () => void): void {
  getChannel()
  reloadHandler = handler
}

/**
 * 订阅「本页有东西需要同步出去」。两种时刻会触发，二者都是**真的变了**：
 * 1. 本页写盘成功（幂等写返回 true 才会调，所以纯回声不会触发）；
 * 2. 一个新 store 第一次接进同步（`syncPersisted` 注册时）——store 是懒加载的，
 *    它一被打开就会播种示例数据，那时必须让云端同步看一眼：若云上已有真实数据，
 *    就得把它们拿下来，而不是把刚播种的示例推上去。
 *
 * 只有一个消费者（`services/cloudSync.ts`），也就不需要做成订阅列表——
 * 多消费者会带来「谁先谁后」的问题，而这里语义上就该只有一个。
 */
export function onSyncDirty(handler: (key: string) => void): void {
  dirtyHandler = handler
}

/**
 * 某个键上挂了几个订阅者（**只给自检脚本用**）。
 *
 * 为什么值得为自检开一个口子：自检里有一类是「这个键变化后，本页不该有任何写盘 / 广播」
 * 的**否定式断言**——键名要是写错了，谁都订不上，断言会一路绿灯地假通过。
 * 有了它，自检可以先把「这个键真的有且只有一个 store 订上」立成前置条件。
 * 顺带还能挡住重复订阅（同一个 store 不小心调了两次 `syncPersisted`）：那会让远端更新
 * 被规范化两遍，是难查的隐患。
 */
export function syncSubscriberCount(key: string): number {
  return keyHandlers.get(key)?.size ?? 0
}

/**
 * 把一个持久化状态接进同步（store 侧的**一行**接入，替代原先各自手写的写盘 watch）：
 * 1. 本页改了 → 写盘（幂等）→ 真的写了才广播；
 * 2. 别的入口改了 → 重读 → `revive` 规范化 → 替换内存状态。
 *
 * `revive` 必须是该 store 加载时用的**同一个**规范化函数（见各 store 的 `reviveXxx`）——
 * 与首屏加载共用一份实现，规则才不会在「加载」和「同步」两条路径上分叉（§11.1）。
 */
export function syncPersisted<T>(key: string, source: Ref<T>, revive: (raw: unknown[]) => T): void {
  watch(
    source,
    (value) => {
      if (!writeJSON(key, value)) return
      broadcastKeys([key])
      dirtyHandler?.(key)
    },
    { deep: true },
  )

  onSyncKeys(key, (raw) => {
    source.value = revive(raw)
  })

  // 注册本身就是一次「有东西需要同步出去」：这个键刚被 store 载入（首次打开时它已经
  // 播种了示例数据），云端同步必须立刻看一眼，否则示例数据会被推上去盖掉云上的真实数据
  dirtyHandler?.(key)
}
