/**
 * 座位约束仓储（V2.2.0-alpha · Phase Cloud-1）。
 *
 * 数据源：`teacherdesk:seatConstraints`（键名不变；全局约束，不属于任何方案）。
 * 复活规则自 stores/constraint.ts 原样迁入；键不存在返回空、首次不写盘（同原实现）。
 */
import { appConfig } from '@/config'
import { createId } from '@/utils/id'
import type { SeatConstraint, SeatConstraintType } from '@/types/constraint'

import { localStorageAdapter } from '../adapters/LocalStorageAdapter'
import { createCollectionRepository } from '../base/createCollectionRepository'

const CONSTRAINTS_KEY = `${appConfig.storageKeyPrefix}:seatConstraints`

/** 全部已知约束类型（load 守卫用；类型值扩展时同步） */
const KNOWN_TYPES: readonly SeatConstraintType[] = [
  'no-deskmate',
  'no-adjacent',
  'back-row',
  'front-row',
  'same-block',
]

/** 单条约束的健壮化：双人型缺第二位学生、类型认不出即丢弃该条 */
function normalizeConstraint(raw: unknown): SeatConstraint | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<SeatConstraint>
  if (typeof item.studentA !== 'string' || !item.studentA) return null
  if (typeof item.type !== 'string' || !KNOWN_TYPES.includes(item.type as SeatConstraintType)) {
    return null
  }
  const studentB = typeof item.studentB === 'string' && item.studentB ? item.studentB : undefined
  const reason = typeof item.reason === 'string' && item.reason.trim() ? item.reason : undefined
  return {
    id: typeof item.id === 'string' && item.id ? item.id : createId(),
    studentA: item.studentA,
    studentB,
    type: item.type as SeatConstraintType,
    enabled: item.enabled !== false,
    reason,
  }
}

/** 把盘上的原始列表规范成内存里的约束表（**首屏加载与跨标签页同步共用**，§11.1） */
export function reviveConstraints(raw: unknown[]): SeatConstraint[] {
  return raw
    .map((item) => normalizeConstraint(item))
    .filter((item): item is SeatConstraint => item !== null)
}

const repository = createCollectionRepository<SeatConstraint[]>({
  key: CONSTRAINTS_KEY,
  adapter: localStorageAdapter,
  reviveList: reviveConstraints,
})

export const seatConstraintRepository = {
  ...repository,

  /** 读约束；键不存在 → 空数组，不写盘（首次不播种，同原实现） */
  load(): SeatConstraint[] {
    return repository.load() ?? []
  },
}
