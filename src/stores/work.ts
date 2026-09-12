import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { appConfig } from '@/config'
import { useNow } from '@/composables/useToday'
import { readRaw } from '@/services/storage'
import { syncPersisted } from '@/services/sync'
import { createId } from '@/utils/id'
import {
  isValidIsoDate,
  isValidWorkCategory,
  isValidWorkPriority,
  isValidWorkStatus,
  isoDateOf,
  isSameWork,
  isWorkOverdue,
  isWorkInputValid as isValidWorkInput,
  sortWorks,
  todayWorks,
  weekWorks,
  workSummary,
} from '@/utils/work'
import type { WorkInput, WorkItem } from '@/types/work'

const STORAGE_KEY = `${appConfig.storageKeyPrefix}:works`

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
 * 把盘上的原始列表规范成内存里的工作清单（**首屏加载与跨标签页同步共用**，§11.1）。
 * 同一 id 只保留首条：外部篡改可能造出重复 id，会让列表的 v-for key 冲突。
 */
function reviveWorks(raw: string | null): WorkItem[] {
  if (raw === null) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const seen = new Set<string>()
  return (parsed as unknown[])
    .filter((item): item is Partial<WorkItem> => Boolean(item) && typeof item === 'object')
    .map((item) => normalizeWork(item))
    .filter((item): item is WorkItem => item !== null)
    .filter((work) => {
      if (seen.has(work.id)) return false
      seen.add(work.id)
      return true
    })
}

/** syncPersisted 需要的统一形状（`(raw: unknown[]) => WorkItem[]`） */
function reviveWorksFromList(raw: unknown[]): WorkItem[] {
  return reviveWorks(JSON.stringify(raw))
}

/**
 * 读工作清单。**首次启动不播种示例数据**（与课表 / 座位不同）：
 * 工作清单是教师自己的事，凭空出现「批改数学作业」会被当成真任务去做。
 * 键不存在 → 空数组，且**不写盘**（不制造一个空键）。
 */
function loadWorks(): WorkItem[] {
  const stored = readRaw(STORAGE_KEY)
  if (stored === null) return []
  return reviveWorks(stored)
}

/** 新增 / 编辑结果：失败时给出可读原因（页面直接 toast 出来） */
export type WorkMutation = { ok: true; work: WorkItem } | { ok: false; reason: string }

/** 工作清单落库结果（Excel 导入的唯一出口） */
export type WorkImportOutcome =
  { ok: true; added: number; skipped: number } | { ok: false; reason: string }

/**
 * 工作清单状态（V1.1.3「工作管理」的第二个板块）：读写唯一入口。
 * 数据源 `teacherdesk:works`；「今天」由共享时钟 `useNow()` 解析（跨零点自动翻页）。
 */
export const useWorkStore = defineStore('work', () => {
  const works = ref<WorkItem[]>(loadWorks())
  const now = useNow()

  // 写盘 + 跨标签页同步（Phase 9A）：本页改动写盘后广播键名，别的入口改了则重读并规范化
  syncPersisted(STORAGE_KEY, works, reviveWorksFromList)

  /** 今天（本地日历日 YYYY-MM-DD） */
  const today = computed(() => isoDateOf(now.value))

  /** 全部工作（排序后的只读视图：未完成在前 → 日期 → 优先级） */
  const sortedWorks = computed(() => sortWorks(works.value))

  /** 今日要做的（归属日期 ≤ 今天且未完成） */
  const todayList = computed(() => todayWorks(works.value, today.value))

  /** 本周剩余（明天起、本周日止） */
  const weekList = computed(() => weekWorks(works.value, today.value))

  /** 概览数字（工作台卡片与页头共用一份口径） */
  const summary = computed(() => workSummary(works.value, today.value))

  /** 今日未完成数（工作台「今日工作」卡片直接读它）：与 `summary.todayOpen` 同一口径 */
  const todayOpenCount = computed(() => todayList.value.length)

  /** 已逾期的未完成数 */
  const overdueCount = computed(
    () => works.value.filter((work) => isWorkOverdue(work, today.value)).length,
  )

  /** 新增工作：内容不合法即拒绝（返回原因） */
  function addWork(input: WorkInput): WorkMutation {
    if (!isValidWorkInput(input)) return { ok: false, reason: '请填写工作名称与合法日期' }
    const nowIso = new Date().toISOString()
    const work: WorkItem = {
      ...input,
      title: input.title.trim(),
      description: input.description?.trim() || undefined,
      id: createId(),
      createdAt: nowIso,
      updatedAt: nowIso,
    }
    works.value = [...works.value, work]
    return { ok: true, work }
  }

  /** 更新工作：id 不存在或内容不合法时返回原因 */
  function updateWork(id: string, patch: Partial<WorkInput>): WorkMutation {
    const index = works.value.findIndex((item) => item.id === id)
    if (index === -1) return { ok: false, reason: '这条工作不存在，请刷新后重试' }
    const next: WorkItem = { ...works.value[index]!, ...patch, id }
    if (!isValidWorkInput(next)) return { ok: false, reason: '请填写工作名称与合法日期' }
    next.title = next.title.trim()
    next.description = next.description?.trim() || undefined
    next.updatedAt = new Date().toISOString()
    works.value = [...works.value.slice(0, index), next, ...works.value.slice(index + 1)]
    return { ok: true, work: next }
  }

  /** 删除工作；目标不存在返回 false */
  function removeWork(id: string): boolean {
    const index = works.value.findIndex((item) => item.id === id)
    if (index === -1) return false
    works.value = [...works.value.slice(0, index), ...works.value.slice(index + 1)]
    return true
  }

  /**
   * 点一下勾选 / 取消勾选：已完成 → 回到待完成；其余状态 → 直接完成。
   * 「进行中」由编辑弹窗设置（列表上的圆形按钮只表达「做完没有」这一件事）。
   */
  function toggleDone(id: string): WorkItem | undefined {
    const target = works.value.find((item) => item.id === id)
    if (!target) return undefined
    const nextStatus = target.status === 'done' ? 'todo' : 'done'
    const result = updateWork(id, { status: nextStatus })
    return result.ok ? result.work : undefined
  }

  /**
   * 批量导入（**Excel 导入的唯一落库入口**）：**一次赋值** = 一次写盘 + 一次广播。
   * 同日同名的条目直接跳过（教师把同一份清单导入两次不该得到两份任务）；
   * 任一条不合法 → 整批拒绝（导入层已校验，这里防其他入口绕过）。
   */
  function applyWorkImport(inputs: readonly WorkInput[]): WorkImportOutcome {
    if (inputs.length === 0) return { ok: false, reason: '没有可写入的工作' }
    for (const input of inputs) {
      if (!isValidWorkInput(input)) {
        return { ok: false, reason: `工作数据不合法：${input.title || '（缺名称）'}` }
      }
    }
    const nowIso = new Date().toISOString()
    const created: WorkItem[] = []
    let skipped = 0
    for (const input of inputs) {
      if (works.value.some((work) => isSameWork(work, input))) {
        skipped += 1
        continue
      }
      created.push({
        ...input,
        title: input.title.trim(),
        description: input.description?.trim() || undefined,
        id: createId(),
        createdAt: nowIso,
        updatedAt: nowIso,
      })
    }
    if (created.length > 0) works.value = [...works.value, ...created]
    return { ok: true, added: created.length, skipped }
  }

  return {
    works,
    today,
    sortedWorks,
    todayList,
    weekList,
    summary,
    todayOpenCount,
    overdueCount,
    addWork,
    updateWork,
    removeWork,
    toggleDone,
    applyWorkImport,
  }
})
