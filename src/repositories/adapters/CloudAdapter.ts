/**
 * 云端数据源适配器（V2.2.0-alpha · Phase Cloud-1 占位）。
 *
 * **空实现，禁止接网络**（Phase Cloud-1 拍板：先抽象，再同步）。
 * 四个能力的接入顺序与语义约定先写死在这里，Phase Cloud-2 按需填充：
 *
 * - `connect`   建立云端会话（登录 / 凭据 / 环境选择）；
 * - `pull`      拉取远端快照（按 key），交给 Repository 的 revive 规范化；
 * - `push`      推送本地变更（按 key，携带 services/storage.ts 的写盘时刻做最后写入胜出）；
 * - `sync`      双向对账（冲突时沿用既有「最后写入胜出 + 示例数据豁免」口径，
 *               见 services/cloudSync.ts——那套逻辑届时应整体迁入本适配器）。
 *
 * 所有可能被误调的方法都**故意抛错**：在 Cloud-2 之前，任何代码路径碰到云端
 * 适配器都应当场炸出来，而不是安静地返回空数据把本地数据盖掉。
 * 当前运行时唯一在用的适配器是 `localStorageAdapter`。
 */
import type { DataSourceAdapter } from '../base/types'

function notImplemented(method: string): never {
  throw new Error(
    `[CloudAdapter] ${method} 尚未接入（Phase Cloud-2 占位，当前请用 localStorageAdapter）`,
  )
}

export const cloudAdapter: DataSourceAdapter = {
  kind: 'cloud',

  readRaw() {
    notImplemented('readRaw/pull')
  },
  readList() {
    notImplemented('readList/pull')
  },
  writeJSON() {
    notImplemented('writeJSON/push')
  },
  remove() {
    notImplemented('remove')
  },
  writeSeed() {
    notImplemented('writeSeed')
  },
  bindCollection() {
    notImplemented('bindCollection/sync')
  },
}

/** 云端会话（Phase Cloud-2 实现：登录 / 凭据 / 环境选择） */
// TODO(Cloud-2): export async function connect(): Promise<void>

/** 拉取远端快照（Phase Cloud-2 实现：按 key 拉取 + 交给 Repository revive） */
// TODO(Cloud-2): export async function pull(key: string): Promise<unknown>

/** 推送本地变更（Phase Cloud-2 实现：携带写盘时刻做最后写入胜出） */
// TODO(Cloud-2): export async function push(key: string, value: unknown): Promise<void>

/** 双向对账（Phase Cloud-2 实现：整体迁入 services/cloudSync.ts 的冲突口径） */
// TODO(Cloud-2): export async function sync(): Promise<void>
