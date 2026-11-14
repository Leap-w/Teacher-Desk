/**
 * 违纪自定义预设仓储（v3.8.1 · Phase 3）。
 *
 * 数据源：`teacherdesk:violationPresets`（新增的独立键，一份数组装全部自定义预设）。
 *
 * ## 不播种、读不到键不写盘
 *
 * 与违纪事件 / 假期 / 班费同一处置：自定义预设是教师自己攒的数据，凭空造示例只会
 * 让人以为程序出错；「键不存在 = 这台设备还没有自定义预设」也是云同步第一次对齐时
 * 「采纳云端」的前提（加载时顺手写 `[]` 会与云端真实数据撞成首次同步冲突）。
 *
 * ## 读出来的是**混合数组**
 *
 * `reviveViolationCustomPresets` 返回合法预设 + 因**未知默认严重程度**被隔离的原始记录。
 * Store 的单一数据源就是这份数组，写盘 / 广播 / 云同步 / JSON 备份都从它序列化——
 * 只返回合法预设的话，隔离记录会在下一次任意编辑时被整条丢掉。
 */
import { appConfig } from '@/config'
import { reviveViolationCustomPresets } from '@/utils/violationPreset'
import type { ViolationPresetStoredRecord } from '@/types/violation'

import { localStorageAdapter } from '../adapters/LocalStorageAdapter'
import { createCollectionRepository } from '../base/createCollectionRepository'

const VIOLATION_PRESETS_KEY = `${appConfig.storageKeyPrefix}:violationPresets`

const repository = createCollectionRepository<ViolationPresetStoredRecord[]>({
  key: VIOLATION_PRESETS_KEY,
  adapter: localStorageAdapter,
  reviveList: reviveViolationCustomPresets,
})

export { VIOLATION_PRESETS_KEY }

export const violationPresetRepository = {
  ...repository,

  /** 读自定义预设（混合数组）；键不存在 / 内容损坏都返回空列表，且不写盘 */
  load(): ViolationPresetStoredRecord[] {
    return repository.load() ?? []
  },
}
