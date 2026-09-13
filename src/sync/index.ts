/**
 * 同步引擎统一出口（V2.2.1-alpha · Phase Cloud-2）。
 *
 * **Sync Engine First**：CloudBase、Widget、跨设备同步、定时同步都只从这里拿能力，
 * 不得直接调用 `CloudAdapter`（那是数据通道，不是同步策略）。
 */
export { SyncEngine, createSimulatedTransport, syncEngine } from './SyncEngine'
export { SyncQueue } from './SyncQueue'
export { SyncStateMachine } from './SyncState'
export { ConflictResolver } from './ConflictResolver'
export { SyncEvents } from './SyncEvents'
export type { SyncEventListener, SyncEventName, SyncEventPayload } from './SyncEvents'
export { SyncState } from './types'
export type {
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
