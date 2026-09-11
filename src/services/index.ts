/**
 * 后端接口统一入口——**目前是空壳，没有调用方**。
 * 现阶段所有业务数据都由八个 store 经 `services/storage.ts` 读写本机存储
 * （Pinia → storage → localStorage）；这一层是 Phase 9B（腾讯云 CloudBase 接入）
 * 替换数据访问的预留位置。等真正有实现时再写它的调用口径，不提前描述没做到的事。
 */
export const api = {}
