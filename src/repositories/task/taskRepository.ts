/**
 * 工作清单仓储（V2.2.0-alpha · Phase Cloud-1）。
 *
 * 数据源：`teacherdesk:works`（键名不变）。**首次启动不播种**（与课表 / 座位不同）：
 * 工作清单是教师自己的事，凭空出现「批改数学作业」会被当成真任务去做；
 * 键不存在 → 空数组，且不写盘（不制造一个空键）——行为与原 stores/work.ts 完全一致。
 */
import { appConfig } from '@/config'
import { createId } from '@/utils/id'
import {
  isValidIsoDate,
  isValidWorkCategory,
  isValidWorkPriority,
  isValidWorkStatus,
} from '@/utils/work'
import type { WorkItem } from '@/types/work'

import { localStorageAdapter } from '../adapters/LocalStorageAdapter'
import { createCollectionRepository } from '../base/createCollectionRepository'

const WORKS_KEY = `${appConfig.storageKeyPrefix}:works`

/**
 * 单条工作的健壮化（load 时逐条调用）：名称或日期非法即丢弃该条——一条没有日期的工作
 * 在「今日 / 本周」里无处安放，留着只会让教师以为它丢了（与课表 / 座位同一口径：不臆造）。
 * 状态 / 优先级 / 分类是**枚举字段**，认不出时回默认值并保留这条工作（不是在编造事实）。
 */
function normalizeWork(raw: Partial<WorkItem>): WorkItem | null {
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  if (!title) return null
  if (!isValidIsoDate(raw.date)) return null
  const deadline = typeof raw.deadline === 'string' ? raw.deadline.trim() : ''
  const description = typeof raw.description === 'string' ? raw.description.trim() : ''
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createId(),
    title,
    description: description || undefined,
    date: raw.date,
    // 只接受 HH:mm：历史数据里若混进「18:00:00」这类写法，宁可丢掉截止时间也不猜
    deadline: /^([01]\d|2[0-3]):[0-5]\d$/.test(deadline) ? deadline : undefined,
    status: isValidWorkStatus(raw.status) ? raw.status : 'todo',
    priority: isValidWorkPriority(raw.priority) ? raw.priority : 'normal',
    category: isValidWorkCategory(raw.category) ? raw.category : '其他',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
  }
}

/**
 * 把盘上的原始列表规范成内存里的工作清单。同一 id 只保留首条：
 * 外部篡改可能造出重复 id，会让列表的 v-for key 冲突。
 */
export function reviveWorksFromList(raw: unknown[]): WorkItem[] {
  const seen = new Set<string>()
  return raw
    .filter((item): item is Partial<WorkItem> => Boolean(item) && typeof item === 'object')
    .map((item) => normalizeWork(item))
    .filter((item): item is WorkItem => item !== null)
    .filter((work) => {
      if (seen.has(work.id)) return false
      seen.add(work.id)
      return true
    })
}

const repository = createCollectionRepository<WorkItem[]>({
  key: WORKS_KEY,
  adapter: localStorageAdapter,
  reviveList: reviveWorksFromList,
})

export const taskRepository = {
  ...repository,

  /** 读工作清单；键不存在 → 空数组，不写盘 */
  load(): WorkItem[] {
    return repository.load() ?? []
  },
}
