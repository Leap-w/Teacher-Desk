/**
 * 值日安排仓储（V2.2.0-alpha · Phase Cloud-1）。
 *
 * 数据源：`teacherdesk:duty`（键名不变）——**值日组与轮换设置同存一个数组**
 * （见 types/duty.ts 顶部说明：备份 / 合并 / 清空 / 概览因此都能直接复用）。
 * 复活规则与播种守卫自 stores/duty.ts 原样迁入，行为零变化。
 */
import { appConfig } from '@/config'
import { createSeedDuty } from '@/services/mock'
import { isDutyGroup, isDutySettings, normalizeDutyRecord, withSettings } from '@/utils/duty'
import type { DutyRecord, DutySettings } from '@/types/duty'
import type { Student } from '@/types'

import { localStorageAdapter } from '../adapters/LocalStorageAdapter'
import { createCollectionRepository } from '../base/createCollectionRepository'

const DUTY_KEY = `${appConfig.storageKeyPrefix}:duty`

/**
 * 把盘上的原始列表规范成内存里的值日记录。
 * 两重唯一性：同一 id 只保留首条；设置记录也只认第一条（settings 是单例）。
 * 末尾保证数组里有设置记录（不写盘，只在内存里补）。
 */
export function reviveDutyRecords(raw: unknown[]): DutyRecord[] {
  const seen = new Set<string>()
  const records = raw
    .map((item) => normalizeDutyRecord(item))
    .filter((item): item is DutyRecord => item !== null)
    .filter((record) => {
      if (seen.has(record.id)) return false
      seen.add(record.id)
      return true
    })
  let settingsSeen = false
  const unique = records.filter((record) => {
    if (!isDutySettings(record)) return true
    if (settingsSeen) return false
    settingsSeen = true
    return true
  })
  if (unique.length < raw.length) {
    console.warn(`[duty] 丢弃 ${raw.length - unique.length} 条不合法的值日记录（缓存原文保留）`)
  }
  return withSettings(unique)
}

const repository = createCollectionRepository<DutyRecord[]>({
  key: DUTY_KEY,
  adapter: localStorageAdapter,
  reviveList: reviveDutyRecords,
})

export const dutyRepository = {
  ...repository,

  /**
   * 读值日与设置；首次启动（无缓存）时写入示例值日安排。
   *
   * 播种条件比学生 / 课表严一档（同请假）：值日组引用学生主键，
   * 只在示例学生**都还在读**时才播种——否则从 v0.9.0 升级上来的教师
   * 会凭空多出三个自己班上没有的学生的值日组（§11.3）。不播种时不写盘。
   * 缓存损坏（非 JSON / 非数组）时降级为空、**不重播示例**（§3.2）。
   */
  load(students: Student[]): DutyRecord[] {
    const stored = repository.load()
    if (stored !== null) return stored

    const seed = createSeedDuty()
    // 「档案里还在」= **在读**：软删除的学生仍留在 `students` 数组里（同 §9.17 周末管理的修复）
    const inSchoolIds = new Set(students.filter((item) => !item.deletedAt).map((item) => item.id))
    const referenced = seed.flatMap((record) => (isDutyGroup(record) ? record.studentIds : []))
    if (!referenced.every((id) => inSchoolIds.has(id))) return []
    // 播种写盘并记下基线（Phase 9C），理由见 services/storage.ts 的 writeSeedJSON
    return repository.writeSeed(seed)
  },

  /** 轮换设置守卫：编排动作后保证仍有设置记录（自 stores/duty.ts 上移，见 utils/duty.ts） */
  ensureSettings(records: DutyRecord[], fallback?: Partial<DutySettings>): DutyRecord[] {
    return withSettings(records, fallback)
  },
}
