/**
 * 周末返家仓储（V2.2.0-alpha · Phase Cloud-1）。
 *
 * 数据源：`teacherdesk:weekendReturns`（键名不变）。
 * 复活规则与播种守卫自 stores/weekend.ts 原样迁入，行为零变化。
 */
import { appConfig } from '@/config'
import { createSeedWeekendReturns } from '@/services/mock'
import { normalizeWeekendReturn } from '@/utils/weekend'
import type { WeekendReturnRecord } from '@/types/weekend'
import type { Student } from '@/types'

import { localStorageAdapter } from '../adapters/LocalStorageAdapter'
import { createCollectionRepository } from '../base/createCollectionRepository'

const WEEKEND_KEY = `${appConfig.storageKeyPrefix}:weekendReturns`

/**
 * 把盘上的原始列表规范成内存里的返家记录。
 * 两重去重，都只保留首条：同一 id；同一「学生 + 周末」——本模块的不变量是
 * 一条记录对应一个学生一个周末（留校 = 在读人数 − 在读返家人数以此为前提）。
 */
export function reviveReturns(raw: unknown[]): WeekendReturnRecord[] {
  const seenIds = new Set<string>()
  const seenPairs = new Set<string>()
  const records = raw
    .map((item) => normalizeWeekendReturn(item))
    .filter((item): item is WeekendReturnRecord => item !== null)
    .filter((item) => {
      const pair = `${item.studentId}|${item.weekendDate}`
      if (seenIds.has(item.id) || seenPairs.has(pair)) return false
      seenIds.add(item.id)
      seenPairs.add(pair)
      return true
    })
  if (records.length < raw.length) {
    console.warn(`[weekend] 丢弃 ${raw.length - records.length} 条不合法的返家记录（缓存原文保留）`)
  }
  return records
}

const repository = createCollectionRepository<WeekendReturnRecord[]>({
  key: WEEKEND_KEY,
  adapter: localStorageAdapter,
  reviveList: reviveReturns,
})

export const weekendRepository = {
  ...repository,

  /**
   * 读周末返家记录；首次启动（无缓存）时写入示例数据。
   *
   * 播种条件比学生 / 课表严一档（同请假、值日）：`teacherdesk:weekendReturns`
   * 是 Phase 7 新增的键。返家记录引用学生主键，只在示例学生**都还在读**时
   * （即学生档案同为示例数据）才播种（§11.3）；不播种时**不写盘**，下次启动还会再判一次。
   * 缓存损坏（非 JSON / 非数组）时降级为空列表，不重播示例数据（§3.2）。
   */
  load(students: Student[]): WeekendReturnRecord[] {
    const stored = repository.load()
    if (stored !== null) return stored

    const seed = createSeedWeekendReturns()
    // 「档案里还在」= **在读**：软删除的学生仍留在 `students` 数组里，
    // 只看 id 是否存在，会把「已把示例学生全部退档」的教师也算成「档案仍是示例数据」，
    // 于是给人家凭空播种 5 条已退档学生的返家记录。退档不算在档案里（§9.17 审查修复）
    const inSchoolIds = new Set(students.filter((item) => !item.deletedAt).map((item) => item.id))
    if (!seed.every((item) => inSchoolIds.has(item.studentId))) return []
    // 播种写盘并记下基线（Phase 9C），理由见 services/storage.ts 的 writeSeedJSON
    return repository.writeSeed(seed)
  },
}
