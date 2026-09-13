/**
 * 请假记录仓储（V2.2.0-alpha · Phase Cloud-1）。
 *
 * 数据源：`teacherdesk:leaves`（键名不变）。
 * 复活规则与播种守卫自 stores/leave.ts 原样迁入，行为零变化。
 */
import { appConfig } from '@/config'
import { createSeedLeaves } from '@/services/mock'
import { normalizeLeaveRecord } from '@/utils/leave'
import type { LeaveRecord } from '@/types/leave'
import type { Student } from '@/types'

import { localStorageAdapter } from '../adapters/LocalStorageAdapter'
import { createCollectionRepository } from '../base/createCollectionRepository'

const LEAVES_KEY = `${appConfig.storageKeyPrefix}:leaves`

/**
 * 把盘上的原始列表规范成内存里的请假记录。
 * 同一 id 只保留首条（重复 id 会让列表的 v-for key 冲突），丢弃条目时告警但保留缓存原文。
 */
export function reviveLeaves(raw: unknown[]): LeaveRecord[] {
  const seen = new Set<string>()
  const records = raw
    .map((item) => normalizeLeaveRecord(item))
    .filter((item): item is LeaveRecord => item !== null)
    .filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
  if (records.length < raw.length) {
    console.warn(`[leave] 丢弃 ${raw.length - records.length} 条不合法的请假记录（缓存原文保留）`)
  }
  return records
}

const repository = createCollectionRepository<LeaveRecord[]>({
  key: LEAVES_KEY,
  adapter: localStorageAdapter,
  reviveList: reviveLeaves,
})

export const leaveRepository = {
  ...repository,

  /**
   * 读请假记录；首次启动（无缓存）时写入示例数据。
   *
   * 播种条件比学生 / 课表严一档：`teacherdesk:leaves` 是 Phase 5 新增的键，
   * **每个存量用户第一次打开都算「首次启动」**，而无条件播种会让从 v0.7.0 升级上来
   * 的教师凭空多出 3 条别人家学生的请假。请假记录引用学生主键，只在示例学生**都还在读**时
   * （即学生档案同为示例数据）才播种（§11.3）；不播种时不写盘。
   * 缓存损坏（非 JSON / 非数组）时降级为空列表，不重播示例数据（§3.2）。
   */
  load(students: Student[]): LeaveRecord[] {
    const stored = repository.load()
    if (stored !== null) return stored

    const seed = createSeedLeaves()
    // 「档案里还在」= **在读**：软删除的学生仍留在 `students` 数组里（同 §9.17 周末管理的修复）
    const inSchoolIds = new Set(students.filter((item) => !item.deletedAt).map((item) => item.id))
    if (!seed.every((item) => inSchoolIds.has(item.studentId))) return []
    // 播种写盘并记下基线（Phase 9C），理由见 services/storage.ts 的 writeSeedJSON
    return repository.writeSeed(seed)
  },
}
