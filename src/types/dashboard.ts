/**
 * 工作台领域类型（Phase 4 引入）。
 * 本阶段只有今日待办：勾选状态本地持久化，不支持新增 / 删除 / 编辑（见开发手册 §9.6）。
 */

/** 一条今日待办 */
export interface Todo {
  id: string
  text: string
  done: boolean
}
