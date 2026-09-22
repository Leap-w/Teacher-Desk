/**
 * 收费批次仓储（v3.6.0）。
 *
 * 数据源：`teacherdesk:fund:collections`。
 * 与流水同一个处置：**不播种、读不到键时不写盘**（理由见 `fundRepository.ts`）。
 */
import { appConfig } from '@/config'
import { reviveFundCollections } from '@/utils/fund'
import type { FundCollection } from '@/types/fund'

import { localStorageAdapter } from '../adapters/LocalStorageAdapter'
import { createCollectionRepository } from '../base/createCollectionRepository'

const FUND_COLLECTIONS_KEY = `${appConfig.storageKeyPrefix}:fund:collections`

const repository = createCollectionRepository<FundCollection[]>({
  key: FUND_COLLECTIONS_KEY,
  adapter: localStorageAdapter,
  reviveList: reviveFundCollections,
})

export { FUND_COLLECTIONS_KEY }

export const fundCollectionRepository = {
  ...repository,

  /** 读批次；键不存在或内容损坏时都是空列表，且不写盘 */
  load(): FundCollection[] {
    return repository.load() ?? []
  },
}
