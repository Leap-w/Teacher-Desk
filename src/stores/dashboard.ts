import { ref } from 'vue'
import { defineStore } from 'pinia'

import { appConfig } from '@/config'
import { createSeedTodos } from '@/services/mock'
import { readList, writeJSON } from '@/services/storage'
import { syncPersisted } from '@/services/sync'
import { createId } from '@/utils/id'
import type { Todo } from '@/types/dashboard'

const STORAGE_KEY = `${appConfig.storageKeyPrefix}:dashboard:todos`

/** 单条待办的健壮化：文本为空即丢弃；done 非 true 一律视为未完成 */
function normalizeTodo(raw: Partial<Todo>): Todo | null {
  const text = typeof raw.text === 'string' ? raw.text.trim() : ''
  if (!text) return null
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createId(),
    text,
    done: raw.done === true,
  }
}

/**
 * 把盘上的原始列表规范成内存里的待办表（**首屏加载与跨标签页同步共用**，§11.1）。
 * 同一 id 只保留首条：外部篡改可能造出重复 id，会让待办列表的 v-for key 冲突。
 */
function reviveTodos(raw: unknown[]): Todo[] {
  const seen = new Set<string>()
  return raw
    .filter((item): item is Partial<Todo> => Boolean(item) && typeof item === 'object')
    .map((item) => normalizeTodo(item))
    .filter((item): item is Todo => item !== null)
    .filter((todo) => {
      if (seen.has(todo.id)) return false
      seen.add(todo.id)
      return true
    })
}

/** 读待办；首次启动（键不存在）时写入示例待办 */
function loadTodos(): Todo[] {
  const stored = readList(STORAGE_KEY)
  if (stored === null) {
    const seed = createSeedTodos()
    writeJSON(STORAGE_KEY, seed)
    return seed
  }
  return reviveTodos(stored)
}

/**
 * 工作台状态（Phase 4）：今日待办。
 * 本阶段只有勾选（勾选即持久化）；新增 / 删除 / 编辑 / 跨天归档均未实现（§9.6 未实现）。
 * 派生值（已完成条数、是否全部完成）不在此暴露 —— 只有今日待办卡片用，就近在卡片内计算，
 * 避免同一条规则在 store 与组件里各写一遍（口径分叉）。
 */
export const useDashboardStore = defineStore('dashboard', () => {
  const todos = ref<Todo[]>(loadTodos())

  // 写盘 + 跨标签页同步（Phase 9A）：本页改动写盘后广播键名，别的入口改了则重读并规范化
  syncPersisted(STORAGE_KEY, todos, reviveTodos)

  /** 切换一条待办的完成状态；目标不存在返回 false */
  function toggle(id: string): boolean {
    const target = todos.value.find((item) => item.id === id)
    if (!target) return false
    todos.value = todos.value.map((item) => (item.id === id ? { ...item, done: !item.done } : item))
    return true
  }

  return { todos, toggle }
})
