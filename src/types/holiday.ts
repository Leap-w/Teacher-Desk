/**
 * 假期管理领域类型（v3.6.1）。
 *
 * 边界（开发手册 §2.2）：本文件描述的是**假期这个容器**与**某个假期里的登记事实**，
 * 与「学生档案里的家庭所在地」严格分开——`familyLocation` / `scope` 说的是学生家在哪儿，
 * 这里的 `returnHome` 说的是**这一次**他回没回。**代码中永不出现由 `scope` 推导去向的写法**。
 *
 * 与既有 `types/weekend.ts` 的关系（v3.6.1 的结构性决定）：
 * 周末**不是**这里的一条 `Holiday` 记录，而是一个**虚拟假期**——由周六日期键派生
 * （`id = 'weekend:<周六日期键>'`，见 `utils/holiday.ts` 的 `buildWeekendHoliday`），
 * **不落库**。周末的「回家」记录仍然住在老键 `teacherdesk:weekendReturns`
 * （`WeekendReturnRecord`），一个字段都没动；本文件的 `HolidayRecord` 只装
 * **周末的留校**与**全部自定义假期的登记**。
 *
 * 为什么不让周末也变成一个实体、把老数据迁过来：`src/services/sync.ts` 收到跨标签广播时
 * 会把 revive 的结果写回磁盘并推云，而旧版本客户端的 `normalizeWeekendReturn`
 * 会丢弃 `weekendDate` 不是周六的记录、并按白名单丢掉不认识的字段。老键一旦被新形状污染，
 * 一个长驻旧标签页或离线手机回线就可能**整批抹掉**这些记录再顺着「最后写入胜出」推到云端。
 * 冻结老键之后，「旧数据一条不丢」是结构保证，不靠迁移脚本。
 */
import type { WeekendKey } from '@/types/weekend'

/**
 * 一条自定义假期（教师在「假期管理」里自己建的）。
 *
 * 字段严格按 v3.6.1 规格，**不许多**：没有人人数上限、没有颜色、没有「每周重复」。
 * 起止日期都是日期键（`YYYY-MM-DD`），跨天的长假就是 `startDate < endDate`。
 */
export interface Holiday {
  id: string
  /** 假期名（教师填，如「国庆」「州庆」）；trim 后非空，否则这条假期不成立 */
  name: string
  /** 起始日（含） */
  startDate: string
  /** 结束日（含）——单日假期时与 `startDate` 相等 */
  endDate: string
  /** 备注（可空；空串**不写这个字段**，与班费流水同口径） */
  note?: string
  createdAt: string
  updatedAt: string
}

/**
 * 一个学生在某个假期里的登记记录。
 *
 * 与 `WeekendReturnRecord` 的两处形状差异，都是为了装下「三态」：
 * - 有 `holidayId`（周末的虚拟 id 也在这里），所以一条记录能回答「属于哪个假期」；
 * - 有 `returnHome`，所以「留校」也是一个**落了库的事实**，不再是与「未登记」混在一起的补集。
 */
export interface HolidayRecord {
  id: string
  /** 所属假期。周末是 `'weekend:<周六日期键>'`（虚拟 id，见 utils/holiday.ts） */
  holidayId: string
  studentId: string
  /** 学生姓名快照「姓名（学号后四位）」，写入时生成（同 WeekendReturnRecord） */
  studentName: string
  /**
   * **代表日**快照：周末 = 周六日期键；自定义假期 = 建这条记录那一刻的 `startDate`。
   *
   * 它同时承担两件事——归月（`date.startsWith('YYYY-MM')`，本月的回家人次按它算）与
   * 「假期已被删 / 云端只到达了记录那一份时，这条记录还认得出自己属于哪一天」。
   * 不存假期名：假期改名后记录不该跟着显示旧名（要显示名字时查假期表，查不到就是孤儿）。
   */
  date: string
  /** true = 回家，false = 留校。**「未登记」= 没有这条记录**，不是第三种取值 */
  returnHome: boolean
  createdAt: string
}

/** 一个学生在一个假期里的三态去向 */
export type HolidayStatus = 'home' | 'stay' | 'unregistered'

/** 新建 / 编辑假期时的可写字段（id 与两个时间戳由 store 生成） */
export interface HolidayInput {
  name: string
  startDate: string
  endDate: string
  note?: string
}

/**
 * 列表里的一项：自定义假期，或一个**虚拟周末假期**。
 *
 * `kind` 区分两者，是为了让页面知道该不该给「编辑 / 删除假期」入口——
 * 周末不是可删对象（它的日期由日历决定），周日的登记要清就清登记本身。
 */
export interface HolidayEntry {
  kind: 'weekend' | 'custom'
  /** 自定义假期是库里的那条；虚拟周末是内存对象（`id = 'weekend:<周六键>'`），刷新即重算 */
  holiday: Holiday
  /** 仅 `kind === 'weekend'`：该周末的周六日期键（= 虚拟 id 去掉前缀） */
  weekendKey?: WeekendKey
}
