/**
 * 传输层路由表（V2.2.2-alpha · Phase Cloud-3）。
 *
 * 为什么要有这一层：`SyncEngine` 的核心（队列 / 状态机 / 事件 / 冲突）必须能在
 * **不认识 CloudBase 的前提下**被测试与复用——所以核心不 import 任何云模块。
 * 运行时由接线层（`autoSync.ts`，只有 `main.ts` 引它）把云传输注册进来：
 *
 *   有注册 → 引擎的 push/pull/cycle 走真实云端通道
 *   没注册 → 走内置的「空传输」（成功但什么都不做），引擎保持空闲 `LocalOnly`
 *
 * 这样单元测试只 import `@/sync` 就能跑，不会把 CloudBase SDK 拖进 node 测试环境。
 */
import type { SyncTransport } from './types'

let active: SyncTransport | null = null

/** 注册运行时传输（接线层调用一次） */
export function setActiveTransport(transport: SyncTransport | null): void {
  active = transport
}

/** 当前运行时传输（未注册为 null） */
export function activeTransport(): SyncTransport | null {
  return active
}

/** 是否已接入真实传输（诊断 / 测试用） */
export function hasActiveTransport(): boolean {
  return active !== null
}
