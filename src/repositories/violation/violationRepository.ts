/**
 * 违纪事件仓储（v3.8.0 · Phase 1A）。
 *
 * 数据源：`teacherdesk:violations`（**本次新增的键**，一份数组装全部违纪事件）。
 *
 * ## 为什么不播种示例数据
 *
 * 与 `holidayRepository` / `fundRepository` 同一处置：**不播种、读不到键时不写盘**。
 * 两条理由：
 * 1. 违纪是**教师对学生的负面记录**。凭空给他造几条示例违纪，他只会以为自己
 *    上次误点过、或者以为程序出错了——预置的示例数据在这里不是「demo」，是「脏数据」。
 * 2. 「键不存在」对云同步有意义：它表示这台设备还没有违纪数据，`decideKey` 据此走
 *    「本地无此键 → 采纳云端」。加载时顺手写一个 `[]` 进去，新设备就变成「有一份空违纪表」，
 *    与云端那份真实数据撞成首次同步冲突（与假期 / 班费同一个坑）。
 *
 * ## 为什么整份数组放一个键
 *
 * 与既有所有模块一致：一个存储键 = 一份云文档 = 一个同步单元。违纪记录是**事件流**，
 * 单条追加 / 修改的频率远低于「每敲一个字写一次盘」的量级，整份数组的写盘与同步代价
 * 可以接受；换成「一条记录一个键」会让云端文档数随违纪次数线性增长，且现有
 * `RemotePort.pull` 是**一次拉全量**（`limit(100)`），那条路走不通。
 *
 * 事件 id 由 store 生成、随记录一起落盘与同步，**读取路径不重新生成**（`normalize` 只在
 * id 缺失时补一个），因此跨设备 / 导入导出后仍是同一个事件（备份合并按 id 对齐）。
 *
 * ## v3.8.0 修正：读出来的是**混合数组**
 *
 * `reviveViolationRecords` 返回 `ViolationStoredRecord[]`（合法事件 + 因**未知严重程度**
 * 被隔离的原始记录）。这不是类型上的马虎，而是刻意的：Store 的单一数据源就是这份数组，
 * 写盘 / 广播 / 云同步 / 备份都从它序列化。只返回合法事件的话，隔离记录会在下一次
 * 任意编辑写盘时被整条丢掉（再顺着同步传播出去）——那是比重算等级更严重的数据丢失。
 */
import { appConfig } from '@/config'
import { reviveViolationRecords } from '@/utils/violation'
import type { ViolationStoredRecord } from '@/types/violation'

import { localStorageAdapter } from '../adapters/LocalStorageAdapter'
import { createCollectionRepository } from '../base/createCollectionRepository'

const VIOLATIONS_KEY = `${appConfig.storageKeyPrefix}:violations`

const repository = createCollectionRepository<ViolationStoredRecord[]>({
  key: VIOLATIONS_KEY,
  adapter: localStorageAdapter,
  reviveList: reviveViolationRecords,
})

export { VIOLATIONS_KEY }

export const violationRepository = {
  ...repository,

  /**
   * 读违纪记录（混合数组：合法事件 + 隔离的原始记录）；键不存在（这台设备还没有
   * 违纪数据）或内容损坏时都返回空列表，且**一个字节都不写盘**
   * （云同步据此走「采纳云端」，见文件头说明）。
   */
  load(): ViolationStoredRecord[] {
    return repository.load() ?? []
  },
}
