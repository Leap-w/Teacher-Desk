/**
 * 班费管理领域类型（v3.6.0）。
 *
 * 定位：**班级电子流水账**，不是财务系统。记「这一笔钱怎么进出的」，
 * 不做科目、不做审批、不做报销单（规格「十三、明确不做」）。
 *
 * 两条贯穿全模块的模型约定：
 *
 * ① **余额永远由流水实时算，不落库**（规格第四节）。盘上只有「发生过什么」，
 *    没有「现在是多少」——后者一旦存起来，就必然与前者分叉。
 *    收费批次同理：它的收入金额由「已交人数 × 每人金额」当场算，不存第二份金额。
 *
 * ② **金额一律「正数 + 方向」**：`amount` 只存正整数元（精确到分），
 *    进出由 `type` 决定。存负数会让「收入 -500」这种脏数据在求和时变成支出，
 *    而它到底是记错了方向还是记错了符号，事后无人能判断。
 */
import type { Student } from './index'

/** 收支方向 */
export type FundRecordType = 'income' | 'expense'

/** 一条收支流水（手动录入的那一种） */
export interface FundRecord {
  id: string
  type: FundRecordType
  /** 标题，如「高一9班第一次收班费」「购买扫把」 */
  title: string
  /** 金额（元，正数，最多两位小数）——方向看 `type`，不存负数 */
  amount: number
  /** 发生日期（`YYYY-MM-DD`；按「天」记，不记时刻，与请假 / 值日同一口径） */
  date: string
  /**
   * 分类名（预设项或教师自建项的名字）。
   * **存名字而不是存 id**：分类是可删的自定义列表，删掉一个分类不该让历史流水
   * 失去它的分类——这与请假记录存学生姓名快照是同一个理由（§11.3）。
   */
  category: string
  /** 备注（可选） */
  note?: string
  /** 录入时间（ISO）——同一天多笔时按它稳定排序 */
  createdAt: string
}

/** 新增 / 编辑流水的可写字段（`id` / `createdAt` 由 store 维护，表单不产出） */
export interface FundRecordInput {
  type: FundRecordType
  title: string
  amount: number
  date: string
  category: string
  note?: string
}

/** 收费批次里的一个学生：**只记「交没交」**，不记金额、不记时间 */
export interface FundCollectionEntry {
  studentId: string
  paid: boolean
}

/**
 * 一次收费批次，如「第一次班费（50 元）」。
 *
 * **名单不落库**：在读学生由学生档案当场派生（规格第八节「自动读取 StudentStore 全班学生」），
 * `records` 只保存「标记过的那几个人」的缴费状态。这样新转来的学生**一定**会出现在名单里
 * （未交），而不是因为「建档时他还没来」被漏掉——那正是照抄一份名单快照最容易出的错。
 */
export interface FundCollection {
  id: string
  /** 批次名，如「第一次班费」 */
  title: string
  /** 每人金额（元，正数） */
  amountPerStudent: number
  /** 收费日期（`YYYY-MM-DD`）——流水里那一行的日期 */
  date: string
  /** 标记过的缴费状态；名单本体由学生档案派生，见上方说明 */
  records: FundCollectionEntry[]
  createdAt: string
}

/** 新建 / 编辑批次的可写字段 */
export interface FundCollectionInput {
  title: string
  amountPerStudent: number
  date: string
}

/**
 * 教师自建分类（规格第六节「+ 自定义类型」，第五节「收入……保留自定义分类」）。
 *
 * 存成 `{ id, name }` 而不是字符串数组：备份模块的合并导入**按 id 对条目**
 * （`utils/backup.ts` 的 idOf），纯字符串没有 id，导入一次就会把同一批分类再追加一遍。
 *
 * `type` 标方向：一个键（`teacherdesk:fund:expenseCategories`，规格第十一节的键名）
 * 装两个方向的分类，否则「🧹扫把」会出现在收入分类的选项里。
 * 旧数据没有这个字段时按 `expense` 认——键名本来就只提了支出。
 */
export interface FundCategory {
  id: string
  name: string
  type: FundRecordType
  createdAt: string
}

/** 一个预设分类：名称（落库的就是它）+ 图标（emoji，只用于界面） */
export interface FundCategoryPreset {
  name: string
  icon: string
}

/**
 * 流水列表里的**统一一行**：手记流水与收费批次在这个形状上合并。
 *
 * 收费批次是「虚拟行」——它没有对应的 FundRecord，`amount` 由已交人数当场算出来。
 * 好处是盘上只有一份「谁交了」的事实：勾一个学生，余额当场跟着变，
 * 不存在「勾选改了、金额字段没跟上」的中间态。
 */
export interface FundFlowEntry {
  /** `record:<id>` 或 `collection:<id>`——两者 id 各自独立，前缀避免撞车 */
  id: string
  kind: 'record' | 'collection'
  type: FundRecordType
  title: string
  /** 金额（元，正数）；批次行 = 已交人数 × 每人金额 */
  amount: number
  date: string
  category: string
  note?: string
  createdAt: string
  /** 仅批次行：已交人数 / 应缴人数（列表里显示「已交 61/62」） */
  paidCount?: number
  totalCount?: number
}

/** 统计范围（规格第九节：全部 / 本月 / 本学期） */
export type FundRange = 'all' | 'month' | 'term'

/**
 * 「本学期」的区间（日期键闭区间，两端都含）。
 * 起止来自时光中心的学期日期（`timeCenter.semesterStart/semesterEnd`）——
 * 全站只有那一个学期口径，班费不再自己定义一遍（§11.1）；两端留空 = 未设学期。
 */
export interface FundTermRange {
  start: string
  end: string
}

/** 统计结果：收入 / 支出 / 余额 / 笔数 */
export interface FundTotals {
  income: number
  expense: number
  balance: number
  count: number
}

/** 收费批次名单里的一行（派生结果，不落库） */
export interface FundRosterRow {
  studentId: string
  /** 姓名；学生档案里已经彻底找不到时用占位文案（见 utils/fund.ts） */
  name: string
  paid: boolean
  /** 是否仍在读；否 = 已退档，但那一笔钱仍算进批次收入（钱已经收过了） */
  active: boolean
  student?: Student
}
