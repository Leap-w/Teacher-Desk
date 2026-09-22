/**
 * 班费流水仓储（v3.6.0）。
 *
 * 数据源：`teacherdesk:fund:records`。
 *
 * **本仓库第一个不播种示例数据的业务模块**（其余六个模块首次打开都会种几条示例）：
 * 请假记录、值日安排是「事情」，示例数据一看就知道是假的；班费是**钱**——
 * 凭空在教师账上记一笔 3100 元收入、一笔 86 元支出，他不会当成示例，
 * 只会当成「这软件怎么乱记我的账」。空态给引导，账本从第一笔真实收支开始。
 *
 * 由此带出一条与别处不同的行为：**读不到键时不写盘**（不写 `[]`）。
 * 键在盘上不存在 = 这台设备还没有任何班费数据，云同步据此走「本地无此键 → 采纳云端」
 * （`decideKey`，见 services/cloudSync.ts）——这正是「新设备装上就该看到已有账本」
 * 要走的那条路。若在加载时写一个 `[]` 进去，新设备就变成「有一份空账本」，
 * 与云端那份真实数据撞成「首次同步冲突」，要教师逐键裁决才肯拉下来。
 */
import { appConfig } from '@/config'
import { reviveFundRecords } from '@/utils/fund'
import type { FundRecord } from '@/types/fund'

import { localStorageAdapter } from '../adapters/LocalStorageAdapter'
import { createCollectionRepository } from '../base/createCollectionRepository'

const FUND_RECORDS_KEY = `${appConfig.storageKeyPrefix}:fund:records`

const repository = createCollectionRepository<FundRecord[]>({
  key: FUND_RECORDS_KEY,
  adapter: localStorageAdapter,
  reviveList: reviveFundRecords,
})

export { FUND_RECORDS_KEY }

export const fundRepository = {
  ...repository,

  /** 读流水；键不存在（这台设备还没有账本）或内容损坏时都是空列表，且**一个字节都不写盘** */
  load(): FundRecord[] {
    return repository.load() ?? []
  },
}
