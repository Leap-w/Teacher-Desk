/**
 * 同步引擎公共类型（V2.2.1-alpha · Phase Cloud-2）。
 *
 * **Sync Engine First（长期规范）**：CloudBase、跨设备同步、定时同步等
 * 一切同步能力只能调用 `SyncEngine`，不得直接调用 `CloudAdapter`——
 * 后者永远只是「数据通道」，同步策略（排队 / 重试 / 冲突 / 状态）始终集中在这一层。
 *
 * 本阶段**全部为本地模拟**：不联网、不读写 localStorage、不影响既有 cloudSync 链路。
 */

/**
 * 同步状态机（比 Cloud-1 `repositories` 的 SyncStatus 更完整——那个只有运行时快照，
 * 这里多了「有本地改动等着推」的 SyncPending）。
 *
 *   LocalOnly ──enqueue──► SyncPending ──flush/sync──► Syncing ─┬─► Synced
 *        ▲                                                       │
 *        └────────────── reset / clear ◄──────────── Error ◄──────┘（重试耗尽）
 */
export enum SyncState {
  /** 本地模式：未启用云同步（当前运行时默认；也是引擎空闲态） */
  LocalOnly = 'local-only',
  /** 有本地改动排队等待推送 */
  SyncPending = 'sync-pending',
  /** 正在同步（flush 执行中） */
  Syncing = 'syncing',
  /** 已与远端一致（本阶段由模拟传输给出） */
  Synced = 'synced',
  /** 同步失败（重试耗尽或不可重试错误） */
  Error = 'error',
}

/** 队列里的一次同步任务（一个键 + 一次操作） */
export interface SyncTask {
  /** 任务 id（自增，队列内唯一） */
  id: number
  /** 数据键（与 Repository 的 key 同源，如 `teacherdesk:students`） */
  key: string
  /** 操作类型；本阶段只用到 push（pull 留给 Cloud-3） */
  op: SyncOp
  /** 入队时间（毫秒时间戳） */
  enqueuedAt: number
  /** 已尝试次数（含首次执行） */
  attempts: number
  /** 负载（可选；模拟阶段不携带真实数据，避免误传） */
  payload?: unknown
}

export type SyncOp = 'push' | 'pull'

/** 冲突解决策略：本阶段只有 Local Wins；Cloud Wins / Merge 留给后续阶段 */
export type ConflictStrategy = 'local-wins' | 'cloud-wins' | 'merge'

/** 冲突输入：同一个键的两份内容（模拟阶段只记键与两端版本号） */
export interface ConflictInput {
  key: string
  localVersion: number
  remoteVersion: number
}

/** 冲突裁决结果 */
export interface ConflictResolution {
  strategy: ConflictStrategy
  /** 赢家（local / cloud / merged） */
  winner: 'local' | 'cloud' | 'merged'
  reason: string
}

/** 传输层结果（模拟传输与未来 CloudAdapter 的共同形状） */
export type TransportOutcome =
  { ok: true; at: number } | { ok: false; error: string; retryable: boolean }

/**
 * 传输层接口：同步引擎眼中的「数据通道」。
 * 运行时注入**模拟传输**（`createSimulatedTransport`）；Cloud-3 起注入 CloudAdapter 实现。
 * 引擎自身不认识 localStorage / CloudBase / fetch。
 */
export interface SyncTransport {
  readonly kind: 'simulated' | 'cloud'
  /** 推送一个任务；失败时用 retryable 标记是否值得重试 */
  push(task: SyncTask): Promise<TransportOutcome>
  /** 拉取一个键（Cloud-3 起使用；模拟阶段返回空快照） */
  pull(key: string): Promise<TransportOutcome>
  /**
   * 整轮对账（可选能力）：拉全量 → 按记账裁决 → 推脏键 / 采纳远端。
   * 只有「有全量语义」的通道才实现它（CloudTransport 实现；模拟传输不实现）。
   * 引擎的 `runCycle()` 会透传调用它——**引擎核心不认识云端**，只认这个可选方法。
   */
  sync?(): Promise<TransportOutcome>
}

/** 引擎对外快照（UI 只读这一份，别直接摸内部字段） */
export interface SyncSnapshot {
  state: SyncState
  pending: number
  /** 最近一次成功同步时刻（毫秒；从未成功过为 null） */
  lastSyncedAt: number | null
  /** 最近一次错误文案（无错误为 null） */
  lastError: string | null
  /** 累计成功 / 失败（诊断用） */
  succeeded: number
  failed: number
}

/**
 * Outbox 条目（Cloud-4）：队列里一条待同步任务的可读视图。
 * 界面（同步诊断）读的就是这一份，不直接摸队列内部。
 */
export interface OutboxEntry {
  key: string
  op: SyncOp
  /** 已经失败过几次（0 = 还没试过） */
  attempts: number
  enqueuedAt: number
}

/** 队列的可持久化快照（Cloud-4：刷新 / 关标签 / 重启后继续同步） */
export interface SerializedQueue {
  nextId: number
  items: SyncTask[]
}

/** 引擎配置 */
export interface SyncEngineOptions {
  transport: SyncTransport
  /** 单任务最大尝试次数（含首次）；默认 3 */
  maxAttempts?: number
  /**
   * 重试退避基数（毫秒）：第 n 次失败后等 `retryDelayMs × 2^(n-1)`——
   * 默认 1000 → 1s → 2s → 4s（避免瞬间连续请求）。0 = 立即重试（测试友好）。
   */
  retryDelayMs?: number
  /** 单次通道调用的超时（毫秒）；默认 20000。超时按「可重试失败」处理 */
  timeoutMs?: number
  /** 冲突策略；默认 local-wins */
  conflictStrategy?: ConflictStrategy
  /** 时钟注入（测试可控）；默认 Date.now */
  now?: () => number
}
