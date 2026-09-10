import { ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { appConfig } from '@/config'
import { createSeedTodos } from '@/services/mock'
import { createId } from '@/utils/id'
import type { Todo } from '@/types/dashboard'

const STORAGE_KEY = `${appConfig.storageKeyPrefix}:dashboard:todos`

/** 单条待办的健壮化（load 时逐条调用）：文本为空即丢弃；done 非 true 一律视为未完成 */
function normalizeTodo(raw: Partial<Todo>): Todo | null {
  const text = typeof raw.text === 'string' ? raw.text.trim() : ''
  if (!text) return null
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createId(),
    text,
    done: raw.done === true,
  }
}

/** 从 localStorage 读取；首次启动（无缓存）时写入示例待办 */
function loadTodos(): Todo[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) {
      const seed = createSeedTodos()
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed))
      return seed
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      console.warn('[dashboard] localStorage 数据格式异常，已重置为空待办')
      return []
    }
    // 同一 id 只保留首条：外部篡改可能造出重复 id，会让待办列表的 v-for key 冲突
    const seen = new Set<string>()
    return parsed
      .filter((item): item is Partial<Todo> => Boolean(item) && typeof item === 'object')
      .map((item) => normalizeTodo(item))
      .filter((item): item is Todo => item !== null)
      .filter((todo) => {
        if (seen.has(todo.id)) return false
        seen.add(todo.id)
        return true
      })
  } catch (error) {
    console.warn('[dashboard] 读取 localStorage 失败：', error)
    return []
  }
}

/**
 * 工作台状态（Phase 4）：今日待办。
 * 本阶段只有勾选（勾选即持久化）；新增 / 删除 / 编辑 / 跨天归档均未实现（§9.6 未实现）。
 * 派生值（已完成条数、是否全部完成）不在此暴露 —— 只有今日待办卡片用，就近在卡片内计算，
 * 避免同一条规则在 store 与组件里各写一遍（口径分叉）。
 */
export const useDashboardStore = defineStore('dashboard', () => {
  const todos = ref<Todo[]>(loadTodos())

  watch(
    todos,
    (value) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
      } catch (error) {
        console.warn('[dashboard] 写入 localStorage 失败：', error)
      }
    },
    { deep: true },
  )

  /** 切换一条待办的完成状态；目标不存在返回 false */
  function toggle(id: string): boolean {
    const target = todos.value.find((item) => item.id === id)
    if (!target) return false
    todos.value = todos.value.map((item) => (item.id === id ? { ...item, done: !item.done } : item))
    return true
  }

  return { todos, toggle }
})
