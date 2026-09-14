/**
 * Repository 层公共类型（V2.2.0-alpha · Phase Cloud-1）。
 *
 * **Repository First 规范**：任何新功能（CloudBase、导入导出、同步）
 * 都不允许直接访问数据源（localStorage / 未来云端），必须经过 Repository——
 * Web（当前）、CloudBase（未来）、PostgreSQL（未来）
 * 共享同一套数据访问规范，而不是四套逻辑。
 *
 * 本层只定义契约；当前唯一实现在 `adapters/LocalStorageAdapter.ts`。
 * 云同步不走这一层——它经 `src/sync/SyncEngine` + 注入的 `SyncTransport`（见
 * `docs/ARCHITECTURE.md` 的同步层），Repository 因此始终只面对本地存储。
 */
import type { Ref } from 'vue'

/**
 * 同步状态（Phase Cloud-1 仅准备）：当前全链路只有 LocalStorage，
 * 因此运行时恒为 LocalOnly；Cloud-2 接入后由 adapter 如实上报，UI 暂不消费。
 */
export enum SyncStatus {
  /** 仅本地（未登录 / 未启用云同步）——当前唯一可能的状态 */
  LocalOnly = 'local-only',
  /** 同步进行中 */
  Syncing = 'syncing',
  /** 已与云端一致 */
  Synced = 'synced',
  /** 同步出错（冲突 / 断网 / 凭据失效） */
  Error = 'error',
}

/**
 * 数据源适配器：Repository 眼中的「存储长什么样」。
 * 换数据载体（localStorage → 本地缓存 + 云端）时只换 adapter，Repository 与 Store 不动。
 *
 * 契约与 `services/storage.ts` 现有语义一一对应（那是全应用唯一写盘点，本层不另起炉灶）：
 * - `readList`：键不存在 → `null`（据此播种）；内容损坏 → `[]`（原文保留，宁可不认不可丢）；
 * - `writeJSON`：幂等（内容相同不写盘），返回是否真的写入；
 * - `writeSeed`：播种写盘并登记基线（首次云同步据此认出「本机只有示例数据」）；
 * - `bindCollection`：把响应式集合接进「写盘 + 广播 + 云端同步」注册表（当前 = `syncPersisted`）。
 */
export interface DataSourceAdapter {
  /** 适配器标识：日志与状态上报用 */
  readonly kind: 'local-storage' | 'cloud'

  readRaw(key: string): string | null
  readList(key: string): unknown[] | null
  /** 幂等写：内容相同不写盘并返回 false */
  writeJSON(key: string, value: unknown): boolean
  /** 原样删除（可能抛异常，调用方按需捕获） */
  remove(key: string): void
  /** 播种写盘并登记基线 */
  writeSeed(key: string, value: unknown): void
  /**
   * 绑定响应式集合进同步注册表（写盘 + 跨标签页广播 + 云端同步）。
   * `revive` 缺省用仓储的默认复活规则；个别模块（请假 / 周末）要在同步路径上
   * 追加姓名快照刷新，可传覆盖版。
   */
  bindCollection<T>(key: string, source: Ref<T>, revive: (raw: unknown[]) => T): void
}

/**
 * 集合仓储：一个键一个列表的最小契约。
 * 模块仓储（student/seat/…）在它之上组合出各自的 `load` / 播种守卫，
 * **播种与否的业务判断留在模块仓储**（它知道「示例学生是否还在读」这类规则），本层只管读写。
 */
export interface CollectionRepository<T> {
  readonly key: string
  /** 当前同步状态（Cloud-1 恒 LocalOnly；Cloud-2 起由 adapter 上报） */
  readonly syncStatus: SyncStatus
  /** 读盘 + 复活；键不存在 → `null`（调用方据此播种）；内容损坏 → `[]`（复活空列表） */
  load(): T | null
  /** 播种写盘并登记基线，返回种子值 */
  writeSeed(value: T): T
  /**
   * 把响应式集合接进同步注册表。`revive` 缺省用仓储默认复活规则；
   * 请假 / 周末等要在同步路径上刷新姓名快照的模块可传覆盖版。
   */
  bind(source: Ref<T>, revive?: (raw: unknown[]) => T): void
}
