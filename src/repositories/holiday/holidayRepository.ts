/**
 * 自定义假期仓储（v3.6.1）。
 *
 * 数据源：`teacherdesk:holidays`（**本次新增的键**）。
 *
 * 与班费流水同一个体例（见 `fund/fundRepository.ts` 的说明）：**不播种示例数据，读不到键时不写盘**。
 * 理由在这里更硬一层——假期是教师**自己定义的时间容器**，凭空给他种一个「国庆」，
 * 他只会以为自己上次建过。空态给引导，列表从他的第一个真假期开始。
 *
 * 「不写盘」还带着云同步的意义：键在盘上不存在 = 这台设备还没有假期数据，
 * 云同步据此走「本地无此键 → 采纳云端」（`decideKey`）。加载时先写一个 `[]` 进去，
 * 新设备就变成「有一份空假期表」，与云端那份真实数据撞成「首次同步冲突」。
 *
 * 周末**不在这里**：它是虚拟假期，由周六日期键派生，一条记录都不落库（见 `utils/holiday.ts`）。
 */
import { appConfig } from '@/config'
import { reviveHolidays } from '@/utils/holiday'
import type { Holiday } from '@/types/holiday'

import { localStorageAdapter } from '../adapters/LocalStorageAdapter'
import { createCollectionRepository } from '../base/createCollectionRepository'

const HOLIDAYS_KEY = `${appConfig.storageKeyPrefix}:holidays`

const repository = createCollectionRepository<Holiday[]>({
  key: HOLIDAYS_KEY,
  adapter: localStorageAdapter,
  reviveList: reviveHolidays,
})

export { HOLIDAYS_KEY }

export const holidayRepository = {
  ...repository,

  /** 读假期；键不存在（这台设备还没有任何假期）或内容损坏时都是空列表，且**一个字节都不写盘** */
  load(): Holiday[] {
    return repository.load() ?? []
  },
}
