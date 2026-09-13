/**
 * 座位方案仓储（V2.2.0-alpha · Phase Cloud-1）。
 *
 * 数据源：`teacherdesk:seatPlans`（键名不变）。
 * 复活规则（含「同屏至多一个当前方案」守卫）自 stores/seat.ts 原样迁入。
 * **播种不在本仓储**：「开学初」方案要按学生 store 的当前档案自动就座，
 * 依赖 Pinia 运行时上下文——由 seat store 组合 `load()` 与 `writeSeed()` 完成。
 */
import { appConfig } from '@/config'
import { normalizeSeatPlan } from '@/utils/seat'
import type { SeatPlan } from '@/types/seat'

import { localStorageAdapter } from '../adapters/LocalStorageAdapter'
import { createCollectionRepository } from '../base/createCollectionRepository'

const SEAT_PLANS_KEY = `${appConfig.storageKeyPrefix}:seatPlans`

/** 同屏至多一个当前方案：无 isCurrent 则首个补位，多个则仅保留第一个 */
function ensureSingleCurrent(plans: SeatPlan[]): SeatPlan[] {
  if (plans.length === 0) return plans
  const firstCurrent = plans.findIndex((plan) => plan.isCurrent)
  return plans.map((plan, index) => {
    const shouldBeCurrent = firstCurrent === -1 ? index === 0 : index === firstCurrent
    return plan.isCurrent === shouldBeCurrent ? plan : { ...plan, isCurrent: shouldBeCurrent }
  })
}

/** 把盘上的原始列表规范成内存里的座位方案表（**首屏加载与跨标签页同步共用**，§11.1） */
export function reviveSeatPlans(raw: unknown[]): SeatPlan[] {
  return ensureSingleCurrent(
    raw
      .filter((item): item is SeatPlan => Boolean(item) && typeof item === 'object')
      .map((item) => normalizeSeatPlan(item as Partial<SeatPlan>)),
  )
}

const repository = createCollectionRepository<SeatPlan[]>({
  key: SEAT_PLANS_KEY,
  adapter: localStorageAdapter,
  reviveList: reviveSeatPlans,
})

export const seatRepository = {
  ...repository,
}
