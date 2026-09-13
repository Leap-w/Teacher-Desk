/**
 * 同步引擎统一出口（V2.2.1-alpha · Phase Cloud-2）。
 *
 * **Sync Engine First**：CloudBase、Widget、跨设备同步、定时同步都只从这里拿能力，
 * 不得直接调用 `CloudAdapter`（那是数据通道，不是同步策略）。
 *
 * **本文件保持零云依赖**（不 import CloudBase SDK）：核心能在 node 测试里直接跑。
 * 云通道与自动同步接线在 `./CloudTransport.ts` 与 `./autoSync.ts`——
 * 只有 `main.ts` 与云相关测试引它们，业务代码不要直接引（要走引擎）。
 */
export { SyncEngine, createSimulatedTransport, syncEngine } from './SyncEngine'
export { activeTransport, hasActiveTransport, setActiveTransport } from './transportRegistry'
export { SyncQueue } from './SyncQueue'
export { SyncStateMachine } from './SyncState'
export { ConflictResolver } from './ConflictResolver'
export { SyncEvents } from './SyncEvents'
export type { SyncEventListener, SyncEventName, SyncEventPayload } from './SyncEvents'
export { SyncState } from './types'
export type {
  OutboxEntry,
  SerializedQueue,
  ConflictInput,
  ConflictResolution,
  ConflictStrategy,
  SyncEngineOptions,
  SyncOp,
  SyncSnapshot,
  SyncTask,
  SyncTransport,
  TransportOutcome,
} from './types'
