import { ref } from 'vue'
import { defineStore } from 'pinia'

import { dashboardRepository } from '@/repositories'
import type { Todo } from '@/types/dashboard'

/**
 * 工作台状态（Phase 4）：今日待办。
 * 本阶段只有勾选（勾选即持久化）；新增 / 删除 / 编辑 / 跨天归档均未实现（§9.6 未实现）。
 * 派生值（已完成条数、是否全部完成）不在此暴露 —— 只有今日待办卡片用，就近在卡片内计算，
 * 避免同一条规则在 store 与组件里各写一遍（口径分叉）。
 * 数据访问经 `dashboardRepository`（Phase Cloud-1 起，Repository First）。
 */
export const useDashboardStore = defineStore('dashboard', () => {
  const todos = ref<Todo[]>(dashboardRepository.load())

  // 写盘 + 跨标签页同步（Phase 9A）：本页改动写盘后广播键名，别的入口改了则重读并规范化
  dashboardRepository.bind(todos)

  /** 切换一条待办的完成状态；目标不存在返回 false */
  function toggle(id: string): boolean {
    const target = todos.value.find((item) => item.id === id)
    if (!target) return false
    todos.value = todos.value.map((item) => (item.id === id ? { ...item, done: !item.done } : item))
    return true
  }

  return { todos, toggle }
})
