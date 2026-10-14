/**
 * 学期设置（v3.7.5）。
 *
 * 定位：**教学周次的统一配置来源**——课程表换课等依赖教学周次的功能都从这里取周次，
 * 不允许各模块各维护一份周次数组（§9.78 ①）。
 *
 * 四个字段里只有前三个参与周次生成：
 * - `name` 学期名称（可编辑文本）；
 * - `startDate` 开学日期 = 第 1 周的起始日期（必填、YYYY-MM-DD）；
 * - `totalWeeks` 学期总周数（正整数）；
 * - `endDate` 学期结束日期——**仅作记录**，可空，不参与周次生成 / 值日轮换 / 换课计算，
 *   与按周数推算出的最后一周结束日不一致时只在界面上提示，不自动改任何配置。
 *
 * 存储形状：单元素数组（对齐备份 / 同步「一个键 = 一个数组」的硬约束），
 * 键 `teacherdesk:semester`，见 `repositories/semester/semesterRepository.ts`。
 */

/** 单例记录的 id（键里始终只有这一条） */
export const SEMESTER_SETTINGS_ID = 'semester'

export interface SemesterSettings {
  id: string
  /** 学期名称，如「2026年秋季学期」 */
  name: string
  /** 开学日期（YYYY-MM-DD）：第 1 周的起始日期 */
  startDate: string
  /** 学期总周数（正整数） */
  totalWeeks: number
  /** 学期结束日期（YYYY-MM-DD 或 `''`）——仅作记录，不参与任何计算 */
  endDate: string
}

/** 教学周次的一条：第 N 周的起止日期（周次起始由开学日期逐周递推，不落盘） */
export interface SemesterWeek {
  /** 周次序号 1..totalWeeks */
  index: number
  /** 该周起始日期（周一的日期键，第 1 周即开学日期） */
  startDate: string
  /** 该周结束日期（起始 + 6 天） */
  endDate: string
}

/** 类型守卫：认得出「像学期设置」的对象（逐字段校验在 normalizeSemester 里） */
export function isSemesterSettings(value: unknown): value is SemesterSettings {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SemesterSettings).startDate === 'string' &&
    typeof (value as SemesterSettings).totalWeeks === 'number'
  )
}
