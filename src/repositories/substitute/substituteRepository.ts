/**
 * 代课记录仓储（v3.7.5）。
 *
 * 数据源：`teacherdesk:substitutes`——**代课台账独立一键**，与课程表
 * （`teacherdesk:timetable`）和换课记录（`teacherdesk:timetable:exchanges`）完全分开。
 * 这样「删代课记录」不可能碰到课表，「换课 / 清空课表」也不可能碰到代课台账（§6 隔离要求）。
 *
 * **不播种示例数据**：代课是「发生过的事实」，凭空造几条假的会污染统计口径
 * （同请假的播种纪律）。键不存在 → 空数组且**一个字节都不写盘**：
 * 键在盘上不存在 = 这台设备还没有代课台账，云同步据此走「本地无此键 → 采纳云端」，
 * 写一个 `[]` 进去会让新设备与云端那份真实台账撞成「首次同步冲突」。
 */
import { appConfig } from '@/config'
import type { SubstituteRecord } from '@/types/substitute'
import { reviveSubstitutes } from '@/utils/substitute'

import { localStorageAdapter } from '../adapters/LocalStorageAdapter'
import { createCollectionRepository } from '../base/createCollectionRepository'

const SUBSTITUTES_KEY = `${appConfig.storageKeyPrefix}:substitutes`

const repository = createCollectionRepository<SubstituteRecord[]>({
  key: SUBSTITUTES_KEY,
  adapter: localStorageAdapter,
  reviveList: reviveSubstitutes,
})

export { SUBSTITUTES_KEY }

export const substituteRepository = {
  ...repository,

  /** 读代课记录：键不存在（还没记过）或内容损坏时都是空列表，且不写盘 */
  load(): SubstituteRecord[] {
    return repository.load() ?? []
  },
}
