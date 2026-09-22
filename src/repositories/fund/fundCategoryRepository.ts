/**
 * 自定义支出类型仓储（v3.6.0）。
 *
 * 数据源：`teacherdesk:fund:expenseCategories`（规格第十一节）。
 *
 * **它是教师录入的数据，不是界面偏好**：教师自己攒出来的「班服」「运动会」这类分类
 * 花的是他的时间，丢了要一个个重敲。因此它注册进 `BACKUP_MODULES`（备份 / 恢复覆盖它）、
 * 也跟着云同步走——与 `teacherdesk:studentView`（搜索词那种纯界面状态）刻意不同。
 *
 * 列表形状是 `{ id, name }[]` 而不是字符串数组：备份的合并导入按 id 对条目
 * （`utils/backup.ts` 的 idOf），字符串没有 id，导入一次就会把同一批分类再追加一遍。
 */
import { appConfig } from '@/config'
import { reviveFundCategories } from '@/utils/fund'
import type { FundCategory } from '@/types/fund'

import { localStorageAdapter } from '../adapters/LocalStorageAdapter'
import { createCollectionRepository } from '../base/createCollectionRepository'

const FUND_CATEGORIES_KEY = `${appConfig.storageKeyPrefix}:fund:expenseCategories`

const repository = createCollectionRepository<FundCategory[]>({
  key: FUND_CATEGORIES_KEY,
  adapter: localStorageAdapter,
  reviveList: reviveFundCategories,
})

export { FUND_CATEGORIES_KEY }

export const fundCategoryRepository = {
  ...repository,

  /** 读自定义分类；键不存在或内容损坏时都是空列表，且不写盘 */
  load(): FundCategory[] {
    return repository.load() ?? []
  },
}
