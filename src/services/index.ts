/**
 * 后端接口统一入口——**目前是空壳，没有调用方**。
 * 现阶段所有业务数据都由七个 store 直接读写 localStorage（Pinia → localStorage），
 * 页面与 store 之间没有经过这一层；这里只是 Phase 9（腾讯云 CloudBase + PostgreSQL）
 * 接后端时替换数据访问的预留位置。等真正有实现时再写它的调用口径，不提前描述没做到的事。
 */
export const api = {}
