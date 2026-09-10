/**
 * 值日领域类型（Phase 6 引入）。
 *
 * 边界（Phase 6 范围拍板口径）：本阶段只做**编排与轮换**——
 * 只排「值日组」（不分工位：扫地 / 擦黑板由班里自己分）、教师手动指定组员、
 * 按天轮换；**不做打卡与完成情况统计**（谁值完日没人勾选），也不含加减分 / 评比。
 *
 * 两个实体存在**同一个数组**里（`teacherdesk:duty`）：
 * 值日组 N 条 + 轮换设置 1 条，靠 `kind` 区分。这样备份 / 合并 / 清空 / 概览
 * 全部复用同一套存储层机制（utils/backup.ts 只认「一个键 = 一个数组」），
 * 不必为一份设置单开第二套读写与备份逻辑；代价是概览里设置也计作「一条」。
 */

/** 一个值日组：组名 + 组员（教师手动指定） */
export interface DutyGroup {
  id: string
  kind: 'group'
  /** 组名，如「第 1 组」；教师可改名 */
  name: string
  /**
   * 组员（学生 id）。**不存姓名快照**：与请假不同，值日组是「打算怎么排」而不是
   * 「发生过的事实」，每天都要在页面上按档案显示当前姓名；学生被删除（软删）后
   * 仍留在组里并标注「已不在档案」，由教师决定是否移除（store 不擅自改动编排）。
   */
  studentIds: string[]
}

/**
 * 轮换设置（同一数组里唯一一条 `kind: 'settings'` 的记录，id 固定）。
 * 轮换口径：**从起点日期那天起，每天顺延一组**；不排周末时跳过周六 / 周日
 * （周末的轮换不推进，周一接着上一组继续）。
 */
export interface DutySettings {
  id: string
  kind: 'settings'
  /** 轮换起点日期（YYYY-MM-DD）；`''` = 尚未设置（页面引导教师设置） */
  startDate: string
  /** 起点那天值日的组 id；空 / 已失效时按「第一个组」兜底 */
  startGroupId: string
  /** 周末是否值日（默认否：只在周一~周五轮换） */
  includeWeekend: boolean
}

/** 存进 `teacherdesk:duty` 的一条记录（值日组或轮换设置） */
export type DutyRecord = DutyGroup | DutySettings

/**
 * 组员的展示信息（由 store 的 `membersOf` 生成，值日页与工作台卡片共用）。
 * 学生被删除后仍留在组里，靠 `active` 标注「已不在档案」，由教师决定是否移除。
 */
export interface DutyMember {
  id: string
  /** 展示名「姓名（学号后四位）」（重名可区分，与请假 / 换座同一口径）；档案里找不到时为「未知学生」 */
  name: string
  /** 是否仍在本班（软删 / 已彻底删除的学生标为 false） */
  active: boolean
}
