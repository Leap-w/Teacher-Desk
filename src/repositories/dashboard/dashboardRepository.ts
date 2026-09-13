/**
 * 工作台待办仓储（V2.2.0-alpha · Phase Cloud-1）。
 * 数据源：`teacherdesk:dashboard:todos`（键名不变）；首次启动播种示例待办并登记基线。
 */
import { appConfig } from '@/config'
import { createSeedTodos } from '@/services/mock'
import { createId } from '@/utils/id'
import type { Todo } from '@/types/dashboard'

import { localStorageAdapter } from '../adapters/LocalStorageAdapter'
import { createCollectionRepository } from '../base/createCollectionRepository'

const TODOS_KEY = `${appConfig.storageKeyPrefix}:dashboard:todos`

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

/** 把盘上的原始列表规范成内存里的待办表；同一 id 只保留首条（v-for key 冲突防御） */
export function reviveTodos(raw: unknown[]): Todo[] {
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

const repository = createCollectionRepository<Todo[]>({
  key: TODOS_KEY,
  adapter: localStorageAdapter,
  reviveList: reviveTodos,
})

export const dashboardRepository = {
  ...repository,

  /** 读待办；首次启动（键不存在）时播种示例待办 */
  load(): Todo[] {
    const stored = repository.load()
    if (stored !== null) return stored
    return repository.writeSeed(createSeedTodos())
  },
}
