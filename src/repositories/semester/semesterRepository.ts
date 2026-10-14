/**
 * 学期设置仓储（v3.7.5）。
 *
 * 数据源：`teacherdesk:semester`（**单元素数组**，对齐备份 / 同步「一个键 = 一个数组」
 * 的硬约束）。键不存在时按 `DEFAULT_SEMESTER` 处理且**不写盘**——默认值不是教师的数据，
 * 首次编辑才落盘（与 appSettings 同一口径）；换设备同步时「本地无键 + 云有」会采纳云端那份。
 */
import { appConfig } from '@/config'
import type { SemesterSettings } from '@/types/semester'
import { DEFAULT_SEMESTER, normalizeSemester, reviveSemesterList } from '@/utils/semester'

import { localStorageAdapter } from '../adapters/LocalStorageAdapter'
import { createCollectionRepository } from '../base/createCollectionRepository'

const SEMESTER_KEY = `${appConfig.storageKeyPrefix}:semester`

const repository = createCollectionRepository<SemesterSettings[]>({
  key: SEMESTER_KEY,
  adapter: localStorageAdapter,
  reviveList: reviveSemesterList,
})

export const semesterRepository = {
  ...repository,

  /** 读学期设置：缺键 / 读不动一律回默认值（不写盘，不影响下次启动再试） */
  load(): SemesterSettings[] {
    try {
      const raw = localStorageAdapter.readRaw(SEMESTER_KEY)
      if (raw === null) return [{ ...DEFAULT_SEMESTER }]
      const parsed: unknown = JSON.parse(raw)
      const source = Array.isArray(parsed) ? parsed[0] : parsed
      return [normalizeSemester(source)]
    } catch (error) {
      console.warn('[semester] 读不出来，按默认学期设置处理：', error)
      return [{ ...DEFAULT_SEMESTER }]
    }
  },
}
