/**
 * 假期登记仓储（v3.6.1）。
 *
 * 数据源：`teacherdesk:holidayRecords`（**本次新增的键**）——装两样东西：
 * **周末的留校**与**全部自定义假期的登记**（回家与留校都在这里）。
 *
 * 周末的**回家**记录不在这里，仍在老键 `teacherdesk:weekendReturns`
 * （`weekend/weekendRepository.ts`）。为什么把周末拆成两个键装，见 `types/holiday.ts`
 * 顶部那段说明：老键的形状一旦被新字段污染，混合版本期间可能整批丢数据。
 *
 * 不播种、读不到键不写盘，理由同 `holiday/holidayRepository.ts`。
 */
import { appConfig } from '@/config'
import { reviveHolidayRecords } from '@/utils/holiday'
import type { HolidayRecord } from '@/types/holiday'

import { localStorageAdapter } from '../adapters/LocalStorageAdapter'
import { createCollectionRepository } from '../base/createCollectionRepository'

const HOLIDAY_RECORDS_KEY = `${appConfig.storageKeyPrefix}:holidayRecords`

const repository = createCollectionRepository<HolidayRecord[]>({
  key: HOLIDAY_RECORDS_KEY,
  adapter: localStorageAdapter,
  reviveList: reviveHolidayRecords,
})

export { HOLIDAY_RECORDS_KEY }

export const holidayRecordRepository = {
  ...repository,

  /** 读登记；键不存在或内容损坏时都是空列表，且**一个字节都不写盘** */
  load(): HolidayRecord[] {
    return repository.load() ?? []
  },
}
