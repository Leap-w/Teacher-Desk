/**
 * 云端同步引擎（Phase 9B）：把本机这份数据与云上那份对齐。
 *
 * **拍板口径**（需求方 2026-09-11，见开发手册 §9.19 / §10）：单教师单班级、离线优先、
 * 冲突＝**最后写入胜出**。本模块是这套口径的实现，不含别的策略。
 *
 * 三个承重设计，改了任意一个都会让同步出错：
 *
 * 1. **同步单元 = 一个存储键**（与 Phase 9A 同设备同步完全一致）。云端一份文档装一个
 *    键的整份数组，不做字段级合并——教师改哪一页都是他一个人改的，字段级合并的复杂度
 *    换不来任何可见的好处，却会引入「两边各改了一半、合起来谁都没写过」这种查不出的状态。
 * 2. **本地磁盘就是待发队列**。没有单独的发送队列、没有内存里的待办列表：写盘即入队，
 *    推成功后记下「这份原文已经和云端对齐过」（`seen`）。于是断网期间照常使用，
 *    联网后一次同步把积压全部带上；进程被杀、页面刷新也不会丢队列（队列在盘上）。
 * 3. **归一化只有一份**。采纳远端数据后刷新内存走的是 `sync.ts` 的 `applySyncKeys`——
 *    和同设备跨标签页同步、和首屏加载用的是同一条路（§11.1 不许重复实现）。
 *
 * **边界（写进文档，不在这里掩饰）**：
 * - 两端系统时间差会直接变成胜负偏差（`updatedAt` 由写入方产生）；
 * - 首次同步某一键时**本机只有初始化内容**（键不存在 / 空列表 / 还是播种的那份原文）
 *   则以云端为准（新设备装上就该看到已有数据，而不是把示例数据推上去）；
 * - **本机已有教师录入的数据、云端也有**时**不静默覆盖**（Phase 9C 收紧的一条，见
 *   `decideKey` 的冲突分支与 `resolveConflicts`）：两边都可能是真的，只有教师知道留哪一份。
 *   这是 9B 交付时被审查列为待拍板的那条（手册 §9.20 边界②、开发计划 §五 #16）。
 * - 云上没有的键、本地也没改过时**不动本地**：不把「云端缺失」当成删除指令，
 *   否则云端一次误删会顺着所有设备把数据清干净。
 */
import { nextTick, readonly, ref } from 'vue'

import { appConfig } from '@/config'
import {
  createCloudBaseRemote,
  currentUser,
  isCloudConfigured,
  signInWithEmail,
  signInWithUsername,
  signOutCloud,
} from '@/services/cloudbase'
import type { RemoteDoc, RemotePort } from '@/services/remote'
import {
  isSeededText,
  keyLabel,
  lastWriteAt,
  localStoragePort,
  readRaw,
  writeJSON,
} from '@/services/storage'
import { applySyncKeys, broadcastKeys, onSyncDirty, syncedKeys } from '@/services/sync'

/** 同步状态（界面据此显示；不含数据本身） */
export type CloudSyncStatus =
  /** 没配环境 ID：云端同步整块不启用 */
  | 'disabled'
  /** 配了但没登录 */
  | 'signedOut'
  | 'syncing'
  /** 上一次同步成功（空闲） */
  | 'idle'
  /** 连不上：断网或请求发不出去 */
  | 'offline'
  /** 连上了但被拒（鉴权、权限、集合不存在……）——这类错不会自己好，要让教师看见 */
  | 'error'

export interface CloudSyncState {
  status: CloudSyncStatus
  /**
   * 有没有跑完过至少一轮同步（不论成败）。
   *
   * 界面靠它区分「还没问过云端」和「问过了，确实没登录」：少了这一位，应用每次
   * 启动都会先闪一下登录表单，再被异步查出来的登录状态换掉——看起来就像掉线了。
   */
  checked: boolean
  /** 当前登录的账号（用户名 → 邮箱 → uid，逐级退；控制台建的账号通常只有用户名）。未登录为 `null` */
  account: string | null
  /** 上一次同步**成功**的时刻；从没成功过为 `null` */
  lastSyncedAt: number | null
  /** 上一次失败的原因（成功即清空） */
  error: string | null
  /** 最近一轮里推上去几个键 */
  pushedCount: number
  /** 最近一轮里从云端采纳几个键 */
  adoptedCount: number
  /**
   * 等教师裁决的键（存储键名）：首次同步时本机有教师录入的数据、云端也有对应数据。
   * 这些键**既不推也不采纳**，同步照常跑其余键——空数组＝没有待裁决的事。
   *
   * 与 `status` 正交：`status` 说的是「这一轮和云端通不通、有没有被拒」，
   * 这一位说的是「有个问题只有教师能回答」。两个都得让教师看见（界面据此显示「需要确认」）。
   */
  conflicts: string[]
}

const state = ref<CloudSyncState>({
  status: isCloudConfigured() ? 'signedOut' : 'disabled',
  checked: false,
  account: null,
  lastSyncedAt: null,
  error: null,
  pushedCount: 0,
  adoptedCount: 0,
  conflicts: [],
})

/** 同步状态（只读；界面直接绑它） */
export const cloudSyncState = readonly(state)

/** 每个键「上次与云端对齐」的记账 */
interface KeyMeta {
  /**
   * 上次同步之后盘上那份**原文**。与当前盘上原文不同 = 本地又改了。
   * 存原文而不是哈希：比对是精确的，且出问题时能直接与备份文件对照着看。
   */
  seen: string | null
  /** 该键最后一次与云端对齐的时间（毫秒） */
  syncedAt: number
  /** 本地最后一次真的写盘的时刻，与远端的 `updatedAt` 比大小决定谁赢 */
  localUpdatedAt: number
}

type SyncMeta = Record<string, KeyMeta>

const META_KEY = `${appConfig.storageKeyPrefix}:cloud:meta`

/** 记账读失败时按「什么都没记过」处理：最坏结果是重新对齐一次，不会丢数据 */
function readMeta(): SyncMeta {
  try {
    const raw = readRaw(META_KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return parsed as SyncMeta
  } catch (error) {
    console.warn('[cloud] 同步记账读不出来，本轮按首次同步处理：', error)
    return {}
  }
}

function writeMeta(meta: SyncMeta): void {
  writeJSON(META_KEY, meta)
}

/**
 * 删掉盘上的记账（登出时用）。
 *
 * 记账里存着「本机这份原文已经和云端对齐过」——那是**账号级**的事实，不是设备级的。
 * 不清掉的话，下一个在这台设备上登录的账号会沿用上一个账号的对齐状态：本机的班级数据
 * 被当成「早就对齐过、没改过」而既不下发也不上传，教师看到的是上一个班的名单，
 * 而他一编辑就会把上一个班的数据推进新账号的库。
 */
function clearMeta(): void {
  try {
    localStoragePort.remove(META_KEY)
  } catch (error) {
    console.warn('[cloud] 记账未能清除，下次登录可能沿用上一个账号的对齐状态：', error)
  }
}

/** 本轮对某个键的判定 */
type Decision =
  | { kind: 'skip'; reason: string }
  | { kind: 'push' }
  | { kind: 'adopt'; doc: RemoteDoc; reason: string }
  /**
   * 首次同步时本机已有教师录入的数据，而云端也有这个键——**两边都不动**，等教师裁决
   * （见 `resolveConflicts`）。这是 Phase 9C 收紧的那一条：以前这里直接采纳云端，
   * 本机那份真实数据（不备份、不入云）就被整份换掉了。
   */
  | { kind: 'conflict'; doc: RemoteDoc; reason: string }

/**
 * 本机这一份算不算「没有教师录入的数据」：键不存在、内容是空列表、或还是**当初播种的那一份**
 * （见 `storage.ts` 的 `isSeededText`）。
 *
 * 这是首次同步唯一要向本机问的问题，所以判定收在一处。空列表也算「没有」：教师把记录
 * 清空之后本机确实没有东西可保，此时把云端那份取回来与既有口径一致——「无删除传播」
 * 那条边界不变（一台设备上删空的意图不会传到另一台，也不反过来把本机清空）。
 */
function hasNoLocalData(key: string, localText: string | null): boolean {
  if (localText === null) return true
  if (isSeededText(key, localText)) return true
  try {
    const parsed: unknown = JSON.parse(localText)
    return Array.isArray(parsed) && parsed.length === 0
  } catch {
    // 解析不了就是「有东西但认不出」：按「本机有数据」处理，宁可多问教师一句
    return false
  }
}

/**
 * 判定一个键该推还是该采纳（纯函数：只吃「本地原文 + 远端文档 + 记账 + 当前时刻 +
 * 本机这份是不是初始化内容」）。
 *
 * 抽成纯函数的理由与排座求解器相同：这是整个同步里唯一会出错的地方，
 * 而纯函数能在自检里被穷举各种组合（含时间先后、首次同步、云端缺失），
 * 不用去搭真实的网络和真环境。**「本机是不是初始化内容」由调用方判定后传进来**
 * （`hasNoLocalData` 要读盘），纯函数自己不碰存储。
 */
export function decideKey(
  localText: string | null,
  doc: RemoteDoc | undefined,
  meta: KeyMeta | undefined,
  now: number,
  localIsInitial: boolean,
): Decision {
  // 本地这个键不存在（还没被任何一个 store 播种过）
  if (localText === null) {
    // 云上有 → 拿下来；云上也没有 → 无话可说
    return doc
      ? { kind: 'adopt', doc, reason: '本地无此键，以云端为准' }
      : { kind: 'skip', reason: '两边都没有' }
  }

  const seen = meta?.seen ?? null
  const dirty = localText !== seen

  // 云上没有这个键
  if (!doc) {
    // 本地有内容且没对齐过 → 推上去（首次上传走这条）
    return dirty ? { kind: 'push' } : { kind: 'skip', reason: '云端无此键且本地未变' }
  }

  if (!dirty) {
    // 本地没动：云端更新过就采纳
    const remoteNewer = meta === undefined || doc.updatedAt > meta.syncedAt
    return remoteNewer
      ? { kind: 'adopt', doc, reason: '本地未变，云端更新' }
      : { kind: 'skip', reason: '两边都没变' }
  }

  // 本地改了，云上也变了 → 这才是真正的冲突
  const firstSync = meta === undefined
  if (firstSync) {
    // 首次同步（这台设备还没有任何对齐记录）分两种处境：
    // - 本机只有初始化内容（新设备 / 刚清过数据）→ 以云端为准：新设备装上就该看到已有数据，
    //   而不是把它自己播种的示例推上去把真实数据盖掉；
    // - 本机已有教师录入的数据 → **不静默覆盖**（Phase 9C）：两边都可能是真的
    //   （本机这份可能是没网时录了一周的，云端那份可能是另一台设备上的），
    //   只有教师知道该留哪一份。这里只把冲突**报上去**，一个字节都不动。
    return localIsInitial
      ? { kind: 'adopt', doc, reason: '首次同步，本机只有初始化内容，以云端为准' }
      : { kind: 'conflict', doc, reason: '首次同步，本机已有数据且云端也有，等教师裁决' }
  }

  if (doc.updatedAt > meta.syncedAt) {
    // 两边都改过（非首次同步）：按拍板口径比「本地写盘时刻」与「云端写入时刻」，晚的赢；
    // 平局判云端赢（规则写在这里，不靠巧合）
    const localAt = meta.localUpdatedAt || now
    return doc.updatedAt >= localAt
      ? { kind: 'adopt', doc, reason: '冲突：云端写入更晚' }
      : { kind: 'push' }
  }

  // 云端没动过，只是本地改了 → 推
  return { kind: 'push' }
}

/**
 * 采纳一个键：**先落到盘上，再让内存跟上**（内存永远以盘为准，两条路才不会分叉），
 * 并把「本机这份已与云端对齐」记进记账。返回 `false` 表示**没有采纳**（写盘失败）。
 *
 * `writeJSON` 返回 false 有两种含义——内容本就相同（幂等，等于已经对齐），或写盘
 * 失败（配额满 / 隐私模式）。**读回来比对才能分开**，而盘上实际是什么正是要记进
 * `seen` 的东西。写失败的这一份不能算采纳：盘上还是旧内容、内存也没换，此刻若记下
 * 「已与云端对齐」，下一轮就会把旧内容当成本地改动推上去，把云端那份盖掉。
 */
function adoptToDisk(key: string, doc: RemoteDoc, meta: SyncMeta): boolean {
  const wanted = JSON.stringify(doc.payload)
  writeJSON(key, doc.payload)
  const onDisk = safeRead(key)
  if (onDisk !== wanted) return false
  meta[key] = {
    seen: onDisk,
    syncedAt: doc.updatedAt,
    localUpdatedAt: meta[key]?.localUpdatedAt ?? 0,
  }
  return true
}

/** 推一个键的结果：成功 / 本地这份推不了（原文保留）/ 请求失败 */
type PushResult =
  | { kind: 'pushed' }
  | { kind: 'skipped' }
  | { kind: 'failed'; status: CloudSyncStatus; error: string }

/**
 * 把某个键的本地原文推上云，成功则记下记账。推不了的两种情况（不是合法 JSON / 不是列表）
 * 只跳过、**不算失败**：那是本机盘上的内容有问题，云端没参与，报成「同步失败」会让教师
 * 以为网络出了事（原文一律保留，原因在日志里）。
 */
async function pushKey(
  port: RemotePort,
  key: string,
  localText: string,
  now: number,
  meta: SyncMeta,
): Promise<PushResult> {
  let payload: unknown
  try {
    payload = JSON.parse(localText)
  } catch (error) {
    console.warn(`[cloud] 「${keyLabel(key)}」本地内容解析失败，本轮不推（原文保留）：`, error)
    return { kind: 'skipped' }
  }
  if (!Array.isArray(payload)) {
    console.warn(`[cloud] 「${keyLabel(key)}」本地内容不是列表，本轮不推（原文保留）`)
    return { kind: 'skipped' }
  }
  try {
    await port.push({ key, payload, updatedAt: now })
  } catch (error) {
    // 一个键推失败不该让其余七个陪着失败：调用方继续走，把原因记下来，轮末据此不报「已同步」
    return { kind: 'failed', status: statusOfError(error), error: errorText(error) }
  }
  meta[key] = { seen: localText, syncedAt: now, localUpdatedAt: lastWriteAt(key) ?? now }
  return { kind: 'pushed' }
}

let remote: RemotePort | null = null

/**
 * 待裁决冲突的**云端那一份**（存储键 → 远端文档），只活在内存里。
 *
 * 冲突不是常驻状态：`state.conflicts` 只列键名，教师按下「保留云端」时得知道云端那份是什么。
 * 页面刷新后这份就没了——那没关系，冲突会在下一轮同步里被重新发现（该键记账里没有条目，
 * 走的还是「首次同步 + 本机有数据」那条分支），教师看到的是同一道题。
 */
const pendingConflicts = new Map<string, RemoteDoc>()
/** 正在进行中的那一轮（空闲时为 `null`）。`await` 它就等于等「这一轮真的跑完了」 */
let running: Promise<void> | null = null
/** 同步进行中又来了新请求：跑完这一轮再补一轮，避免「最后一次修改刚好被丢掉」 */
let rerun = false

function setState(patch: Partial<CloudSyncState>): void {
  state.value = { ...state.value, ...patch }
}

/** 判断一次失败算「连不上」还是「被拒」：前者会自己好，后者要教师去处理 */
function statusOfError(error: unknown): CloudSyncStatus {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline'
  const message = error instanceof Error ? error.message : String(error)
  return /network|timeout|failed to fetch|NetworkError/i.test(message) ? 'offline' : 'error'
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * 跑一轮同步。**不重入**：进行中再调用只会置一个标记，本轮结束补跑一次。
 * 这样界面上的「立即同步」按钮连点、或写盘触发与联网触发撞在一起，都不会发出两份并发请求
 * 各自把对方的判定作废。
 */
export async function syncNow(): Promise<void> {
  if (!isCloudConfigured()) {
    setState({ status: 'disabled' })
    return
  }
  if (running) {
    rerun = true
    // **不在这里直接返回**：调用方（工具箱的「立即同步」）等的是「同步跑完了」这个事实，
    // 立刻返回会让它读到中途的 `syncing`，于是一次正常的同步被报成失败（9B 交付前独立
    // 审查抓出来的）。等这一轮结束再返回，读到的一定是结果，不是过程。
    await running
    return
  }
  running = runCycle()
  try {
    await running
  } finally {
    running = null
    // 跑完一轮（不管成没成）就算「问过云端了」：界面据此不再显示「正在检查登录状态」
    setState({ checked: true })
    if (rerun) {
      rerun = false
      void syncNow()
    }
  }
}

async function runCycle(): Promise<void> {
  setState({ status: 'syncing' })

  let user
  try {
    user = await currentUser()
  } catch (error) {
    setState({ status: statusOfError(error), error: errorText(error) })
    return
  }
  if (!user) {
    // 未登录时把句柄丢掉。适配器本身不持有账号（每次调用现取当前会话），所以真正的
    // 账号隔离来自 SDK 会话——这里置空不会「防住」写错账号，只是让「下次登录重新建一个」
    // 显式化：留着它没有害处，但会让人以为它绑定了某个账号。
    remote = null
    // 没登录就没有「云端那份」可言：上一个账号留下的待裁决冲突到此为止
    pendingConflicts.clear()
    setState({ status: 'signedOut', account: null, error: null, conflicts: [] })
    return
  }
  const port = (remote ??= createCloudBaseRemote())
  setState({ account: user.username ?? user.email ?? user.uid })

  const keys = syncedKeys()
  let docs: RemoteDoc[]
  try {
    docs = await port.pull()
  } catch (error) {
    setState({ status: statusOfError(error), error: errorText(error) })
    return
  }

  const byKey = new Map(docs.map((doc) => [doc.key, doc]))
  const meta = readMeta()
  const now = Date.now()
  const adopted: string[] = []
  /** 本轮等教师裁决的键（见 `decideKey` 的冲突分支）：本机这份与云端那份都原样留着 */
  const conflicts: string[] = []
  pendingConflicts.clear()
  let pushed = 0
  /**
   * 本轮第一个失败（推失败 / 采纳时写盘失败）。
   * 有它就不能在轮末报「已同步」——否则教师看到绿点与「已同步 10:04」，以为整批都上云了，
   * 放心去换设备，而那个模块的改动还留在本机，要等下一次写盘或回到前台才补上。
   * 只记第一个：同一轮里的失败多半是同一个原因（断网、集合没建），逐条报只会淹没重点。
   */
  let failure: { status: CloudSyncStatus; error: string } | null = null

  for (const key of keys) {
    const localText = safeRead(key)

    // 「本地这份是什么时候写的」以盘上的实际写盘记录为准（本次会话写过就有），
    // 记账里那份只是上一轮留下的旧值、仅在跨会话时兜底。不刷新它，冲突判定就会拿
    // **上一轮**的时刻去比，于是「更早的写入赢」——正好把「最后写入胜出」判反：
    // 老师刚在这台设备上改完，却被另一台稍早的推送盖掉。
    //（自检里「电脑刚加完的学生被云上旧那份覆盖」抓出来的。）
    const record = meta[key]
    const written = lastWriteAt(key)
    if (record && written !== null && record.localUpdatedAt !== written) {
      record.localUpdatedAt = written
    }

    // 「本机这份是不是初始化内容」要读盘（播种基线存在 localStorage 里），因此在这里
    // 判定后传进去——`decideKey` 自己不碰存储，才能被穷举着测
    const decision = decideKey(
      localText,
      byKey.get(key),
      record,
      now,
      hasNoLocalData(key, localText),
    )
    if (decision.kind === 'skip') continue

    if (decision.kind === 'conflict') {
      // **一个字节都不动**：本机这份与云端那份都留着，等教师在工具箱里选（resolveConflicts）。
      // 推上去会盖掉云端那份、采纳会盖掉本机这份——这处境下丢哪一份都不是同步该替教师做的决定。
      conflicts.push(key)
      pendingConflicts.set(key, decision.doc)
      continue
    }

    if (decision.kind === 'adopt') {
      if (!adoptToDisk(key, decision.doc, meta)) {
        console.warn(`[cloud] 「${keyLabel(key)}」取回云端内容时写盘失败，本键本轮未采纳`)
        failure ??= {
          status: 'error',
          error: `${keyLabel(key)}：本地写入失败，云端那份没能取回来`,
        }
        continue
      }
      adopted.push(key)
      continue
    }

    if (localText === null) continue
    const result = await pushKey(port, key, localText, now, meta)
    if (result.kind === 'pushed') pushed += 1
    else if (result.kind === 'failed') failure ??= { status: result.status, error: result.error }
  }

  if (adopted.length > 0) {
    // 本页内存跟上（同一条路：重读 → reviveXxx → 替换），并让同设备的其它入口也跟上
    applySyncKeys(adopted)
    broadcastKeys(adopted)

    // **顺序要紧**：归一化（各 store 的 reviveXxx）会把内容改写成自己的口径
    //（比如请假记录补上姓名快照），这一步是内存替换触发的 watch 完成的、异步发生。
    // 必须等它写完盘**再**记 `seen`，否则记的是归一化前的原文，下一轮就会把这次
    // 归一化当成「本地又改了」再推一次——两台设备之间于是来回多推一轮。
    //（顺序写反过一版，是自检里「采纳之后又推了一个键」抓出来的。）
    await nextTick()
    for (const key of adopted) {
      meta[key] = { ...(meta[key] ?? { syncedAt: now, localUpdatedAt: 0 }), seen: safeRead(key) }
    }
  }

  writeMeta(meta)

  if (failure) {
    // 部分成功：推上去的那些已经记进记账了（上一行），失败的那个键留给下一轮重试。
    // `lastSyncedAt` **不**更新：它表的是「上一次整批对齐成功的时刻」，部分成功不算。
    setState({
      status: failure.status,
      error: failure.error,
      pushedCount: pushed,
      adoptedCount: adopted.length,
      conflicts,
    })
    return
  }

  setState({
    status: 'idle',
    lastSyncedAt: Date.now(),
    error: null,
    pushedCount: pushed,
    adoptedCount: adopted.length,
    conflicts,
  })
}

/** 读盘：读不了（隐私模式等）按「没有这个键」处理——同步不该因此崩掉 */
function safeRead(key: string): string | null {
  try {
    return readRaw(key)
  } catch (error) {
    console.warn(`[cloud] 读取「${keyLabel(key)}」失败，本轮跳过：`, error)
    return null
  }
}

/* ---------- 首次同步冲突的处置（Phase 9C） ---------- */

/** 教师在冲突提示里选的处置：留本机这份，还是留云端那份 */
export type ConflictChoice = 'local' | 'remote'

/**
 * 处置待裁决的冲突：`local` = 把本机这份推上云，`remote` = 把云端那份取下来覆盖本机。
 *
 * **只在教师按了按钮之后调用**（工具箱的确认弹窗），同步流程自己永远不走这条路：
 * 「本机与云端都有真实数据」这处境里，没有哪一份是同步可以替教师丢掉的。
 *
 * 逐键处理、各自成败：一个键推失败（断网）不影响其余键，失败的键**留在冲突列表里**
 * 等下一次；处置好的摘掉。没登录 / 手上没有云端那份时什么都不动、也不清列表
 * ——不猜教师的意图，更不假装处置过。
 */
export async function resolveConflicts(choice: ConflictChoice): Promise<void> {
  const keys = [...state.value.conflicts]
  if (keys.length === 0) return
  // 同步正在进行就先等它跑完：并发处置会让两边的记账互相作废
  if (running) await running
  const port = remote
  if (!port) {
    console.warn('[cloud] 还没登录，冲突先留着')
    return
  }

  const meta = readMeta()
  const now = Date.now()
  const adopted: string[] = []
  const settled: string[] = []
  let failure: { status: CloudSyncStatus; error: string } | null = null

  for (const key of keys) {
    if (choice === 'local') {
      const localText = safeRead(key)
      // 等待期间本机这份没了（教师清空过数据 / 手工改过缓存）：没有可推的东西，
      // 这个键的冲突到此为止——下一轮同步按它自己的判定走
      if (localText === null) {
        settled.push(key)
        continue
      }
      const result = await pushKey(port, key, localText, now, meta)
      // `skipped`（本机这份不是合法列表，推不上去）也算处置过：它推不了，不该一直挂着
      if (result.kind === 'failed') failure ??= { status: result.status, error: result.error }
      else settled.push(key)
      continue
    }

    const doc = pendingConflicts.get(key)
    if (!doc) {
      // 云端那一份只活在内存里（见 pendingConflicts 的说明）。这里的兜底是「手上没有就不动本地」，
      // 让下一轮同步重新判定——**不拿别的东西顶替**，那会变成用一份谁都没看过的数据覆盖本机
      failure ??= { status: 'error', error: `${keyLabel(key)}：云端那份已不在手上，请再同步一次` }
      continue
    }
    if (!adoptToDisk(key, doc, meta)) {
      failure ??= { status: 'error', error: `${keyLabel(key)}：本地写入失败，云端那份没能取回来` }
      continue
    }
    adopted.push(key)
    settled.push(key)
  }

  if (adopted.length > 0) {
    // 与同步轮走同一条路：重读 → reviveXxx → 替换，并让同设备的其它入口也跟上
    applySyncKeys(adopted)
    broadcastKeys(adopted)
    // **顺序要紧**（同 `runCycle` 的说明）：等归一化写完盘**再**记 `seen`
    await nextTick()
    for (const key of adopted) {
      meta[key] = { ...(meta[key] ?? { syncedAt: now, localUpdatedAt: 0 }), seen: safeRead(key) }
    }
  }

  writeMeta(meta)

  for (const key of settled) pendingConflicts.delete(key)
  setState({
    conflicts: state.value.conflicts.filter((key) => !settled.includes(key)),
    ...(failure ? { status: failure.status, error: failure.error } : {}),
  })
}

/* ---------- 触发与生命周期 ---------- */

/** 写盘后多久同步一次：合并连续编辑（每敲一个字都发一次请求既费流量也没意义） */
export const SYNC_DEBOUNCE_MS = 1500

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let started = false

function scheduleSync(delay = SYNC_DEBOUNCE_MS): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void syncNow()
  }, delay)
}

/**
 * 启动云端同步（应用入口 `main.ts` 调用一次）。
 *
 * 触发时机就是「可能不一致」的全部时刻：
 * - 应用启动（这一轮负责把云上的数据拿下来）；
 * - 本页写盘后（防抖：把本地改动推上去）；
 * - **一个新 store 第一次接进同步时**——store 是懒加载的，它一被打开就会播种示例数据，
 *   而那时如果不去拉云端，示例数据就会被当成「本地新数据」推上去，把云上的真实数据盖掉；
 * - 重新联网、页面回到前台（断网期间改的东西在这两个时刻补推）。
 */
export function startCloudSync(): void {
  if (started) return
  started = true

  // 只关心「有个键变了」，不关心是哪个：一轮同步会把所有脏键一起带上，
  // 按键盘去精细调度省不下任何请求，反而多一份要维护的状态。
  // 记账键（META_KEY）不走 syncPersisted，因此永远不会到这里——
  // 它的写入是本机对齐记录，不是教师的数据，本就不该触发同步。
  onSyncDirty(() => scheduleSync())

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => scheduleSync(0))
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') scheduleSync(0)
    })
  }

  scheduleSync(0)
}

/**
 * 登录并立刻对齐一次。失败**不吞**：登录这种教师主动发起的动作，
 * 必须让他看到「为什么没成」（登录方式没开、用户名或密码错、账号没建……）。
 */
export async function signInAndSync(username: string, password: string): Promise<void> {
  await signInWithUsername(username, password)
  remote = null
  await syncNow()
}

/** 登出：清掉远端句柄与记账（见 `clearMeta`），避免下一个账号沿用上一个账号的对齐状态 */
export async function signOutAndStop(): Promise<void> {
  await signOutCloud()
  remote = null
  clearMeta()
  // 待裁决的冲突是**这个账号**的数据处境，跟着一起清（同一个键在新账号里该重新判定）
  pendingConflicts.clear()
  setState({
    status: 'signedOut',
    account: null,
    error: null,
    lastSyncedAt: null,
    pushedCount: 0,
    adoptedCount: 0,
    conflicts: [],
  })
}

/* ==================== Cloud-3：单键通道 / 邮箱登录 / 首次初始化判定 ==================== */

/**
 * 云同步是否**可用**：配了环境 ID、查过登录状态、且当前有账号。
 * 同步引擎的调度层据此决定「要不要把脏键入队」——本地模式下不入队，
 * 引擎状态因此保持 `LocalOnly`，界面不会被无谓的失败打扰。
 */
export function isCloudReady(): boolean {
  if (!isCloudConfigured()) return false
  const snapshot = state.value
  return snapshot.checked && snapshot.account !== null
}

/** 单键同步结果（Cloud-3 快通道：引擎队列里一个脏键的即时推送） */
export type KeySyncOutcome =
  | { ok: true; pushed: boolean }
  | { ok: false; status: CloudSyncStatus; error: string; retryable: boolean }

/** 错误是否值得重试：断网 / 超时算，被拒（鉴权、权限、集合不存在）不算 */
function isRetryableStatus(status: CloudSyncStatus): boolean {
  return status === 'offline' || status === 'syncing'
}

/**
 * 上传**一个**键（Cloud-3）：同步引擎队列的快通道。
 * 与整轮 `syncNow()` 的差别只在于「不拉全量、不裁决其它键」——
 * 记账口径完全一致（`pushKey` 内部同一份实现），所以两条路径不会打架。
 */
export async function pushKeyNow(key: string): Promise<KeySyncOutcome> {
  if (!isCloudReady()) {
    return { ok: false, status: 'signedOut', error: '未登录云端', retryable: false }
  }
  const port = (remote ??= createCloudBaseRemote())
  const localText = safeRead(key)
  if (localText === null) return { ok: true, pushed: false }
  const meta = readMeta()
  const outcome = await pushKey(port, key, localText, Date.now(), meta)
  if (outcome.kind === 'failed') {
    return {
      ok: false,
      status: outcome.status,
      error: outcome.error,
      retryable: isRetryableStatus(outcome.status),
    }
  }
  if (outcome.kind === 'pushed') {
    writeMeta(meta)
    return { ok: true, pushed: true }
  }
  // skipped（本地内容不是列表 / 解析失败）：不重试，留给整轮同步按裁决流程处置
  return { ok: true, pushed: false }
}

/**
 * 拉取**一个**键的云端文档（Cloud-3）：给引擎的 `pull` 用。
 * 只读不写盘——是否采纳由调用方按 LWW 判定（真实处置仍在整轮同步里）。
 */
export async function pullKeyNow(key: string): Promise<RemoteDoc | null> {
  if (!isCloudReady()) return null
  const port = (remote ??= createCloudBaseRemote())
  const docs = await port.pull()
  return docs.find((doc) => doc.key === key) ?? null
}

/**
 * 把本机**全部已注册键**推上云（首次初始化的「确认」按钮走这条）。
 * 与逐键裁决无关：教师已经明确回答了「用本机这份初始化云端」，这里照办。
 * 返回成功 / 失败条数，调用方据此给出可读结果。
 */
export async function pushAllLocalNow(): Promise<{ pushed: number; failed: number }> {
  if (!isCloudReady()) return { pushed: 0, failed: 0 }
  const port = (remote ??= createCloudBaseRemote())
  const meta = readMeta()
  const now = Date.now()
  let pushed = 0
  let failed = 0
  for (const key of syncedKeys()) {
    const localText = safeRead(key)
    if (localText === null) continue
    const result = await pushKey(port, key, localText, now, meta)
    if (result.kind === 'pushed') pushed += 1
    else if (result.kind === 'failed') failed += 1
  }
  writeMeta(meta)
  setState({
    status: failed > 0 ? 'error' : 'idle',
    lastSyncedAt: failed > 0 ? state.value.lastSyncedAt : now,
    error: failed > 0 ? `${failed} 个模块初始化失败，稍后会自动重试` : null,
    pushedCount: pushed,
  })
  return { pushed, failed }
}

/** 首次同步的处境（界面据此决定「要不要问教师一句」） */
export type FirstSyncSituation =
  /** 两边都没有数据：正常开始 */
  | 'empty'
  /** 本机有真实数据、云端空：**要问**「是否用本机数据初始化云端」 */
  | 'local-only'
  /** 云端有、本机空（新设备）：直接拉取 */
  | 'cloud-only'
  /** 两边都有：交给首次同步的裁决流程（需教师确认保留哪一份） */
  | 'both'
  /** 已经对齐过（记账齐全、无差异）：不用问也不用拉 */
  | 'aligned'

/**
 * 判定首次同步处境（Cloud-3）：**只读**，不写盘、不推不拉。
 * 用既有的 `hasNoLocalData`（播种基线 + 空列表判定）区分「真实数据 / 初始化内容」，
 * 与整轮同步的判定同源，不会出现「弹窗说本地有数据、同步却不这么认为」。
 */
export async function probeFirstSync(): Promise<FirstSyncSituation> {
  if (!isCloudConfigured()) return 'empty'
  if (!isCloudReady()) return 'empty'

  const keys = syncedKeys()
  const localReal = keys.filter((key) => !hasNoLocalData(key, safeRead(key)))
  const meta = readMeta()

  let docs: RemoteDoc[]
  try {
    const port = (remote ??= createCloudBaseRemote())
    docs = await port.pull()
  } catch (error) {
    console.warn('[cloud] 首次同步处境判定失败（按无云端数据处理）：', error)
    return localReal.length > 0 ? 'local-only' : 'empty'
  }

  const cloudReal = docs.filter((doc) => Array.isArray(doc.payload) && doc.payload.length > 0)

  if (localReal.length === 0 && cloudReal.length === 0) {
    return Object.keys(meta).length > 0 ? 'aligned' : 'empty'
  }
  if (localReal.length > 0 && cloudReal.length === 0) return 'local-only'
  if (localReal.length === 0 && cloudReal.length > 0) return 'cloud-only'
  return 'both'
}

/**
 * 邮箱 + 密码登录并立刻对齐一次（Cloud-3 的登录形态）。
 * 失败**不吞**：登录是教师主动发起的动作，必须让他看到原因。
 */
export async function signInWithEmailAndSync(email: string, password: string): Promise<void> {
  await signInWithEmail(email, password)
  remote = null
  await syncNow()
}
