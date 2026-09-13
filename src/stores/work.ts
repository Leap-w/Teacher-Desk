import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { useNow } from '@/composables/useToday'
import { taskRepository } from '@/repositories'
import { createId } from '@/utils/id'
import {
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

/** 新增 / 编辑结果：失败时给出可读原因（页面直接 toast 出来） */
export type WorkMutation = { ok: true; work: WorkItem } | { ok: false; reason: string }

/** 工作清单落库结果（Excel 导入的唯一出口） */
export type WorkImportOutcome =
  { ok: true; added: number; skipped: number } | { ok: false; reason: string }

/**
 * 工作清单状态（V1.1.3「工作管理」的第二个板块）：读写唯一入口。
 * 数据访问经 `taskRepository`（Phase Cloud-1 起，Repository First）——复活 / 不播种
 * 的口径都在仓储里；「今天」由共享时钟 `useNow()` 解析（跨零点自动翻页）。
 */
export const useWorkStore = defineStore('work', () => {
  const works = ref<WorkItem[]>(taskRepository.load())
  const now = useNow()

  // 写盘 + 跨标签页同步（Phase 9A）：本页改动写盘后广播键名，别的入口改了则重读并规范化
  taskRepository.bind(works)

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
