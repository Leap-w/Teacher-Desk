/**
 * 学期设置的纯逻辑（v3.7.5，§9.78 ①）：默认值、健壮化、教学周次生成。
 *
 * 「周次」在本项目里**只有这一个来源**：开学日期 + 总周数 → 第 N 周的起止日期，
 * 逐周递推（7 天一周），不落盘、不硬编码 20 周表（spec §3.2 的日期表是验收依据，
 * 不是数据）。任何依赖教学周次的功能（课程表换课等）都调这里的函数。
 *
 * 学期结束日期 `endDate` **不参与**周次生成——它只是教师自己记的一个日期。
 */
import { SEMESTER_SETTINGS_ID } from '@/types/semester'
import type { SemesterSettings, SemesterWeek } from '@/types/semester'
import { addDaysToDateKey, formatMonthDay, isDateKey } from '@/utils/date'

/**
 * 初始学期配置（spec §3.1 给定）：2026年秋季学期 / 2026-08-17 / 20 周 / 结束日期为空。
 * 这是「首次打开」的默认值，不是硬编码的业务常量——教师改过之后一切以盘上为准。
 */
export const DEFAULT_SEMESTER: SemesterSettings = {
  id: SEMESTER_SETTINGS_ID,
  name: '2026年秋季学期',
  startDate: '2026-08-17',
  totalWeeks: 20,
  endDate: '',
}

/**
 * 开学日期的年份闸（与值日轮换同一口径：2000–2099）。
 * 没有它，一个手改成 `9999-12-31` 的开学日期会让周次递推把整页拖垮。
 */
export const SEMESTER_MIN_YEAR = 2000
export const SEMESTER_MAX_YEAR = 2099

/** 周数上限：20 是默认值，一学年也到不了 60；越界一律回默认值（读 / 写两处共用） */
export const SEMESTER_MAX_WEEKS = 60

/** 学期设置适用的日期键：`YYYY-MM-DD`、真实存在、年份在 2000–2099 */
export function isSemesterDateKey(value: unknown): value is string {
  if (!isDateKey(value)) return false
  const year = Number(value.slice(0, 4))
  return year >= SEMESTER_MIN_YEAR && year <= SEMESTER_MAX_YEAR
}

/** 单份学期设置的健壮化：字段认不出就回默认值（**绝不写盘**；单例记录没有「丢弃」一说） */
export function normalizeSemester(raw: unknown): SemesterSettings {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<SemesterSettings>
  const name =
    typeof source.name === 'string' && source.name.trim()
      ? source.name.trim()
      : DEFAULT_SEMESTER.name
  const startDate = isSemesterDateKey(source.startDate)
    ? source.startDate
    : DEFAULT_SEMESTER.startDate
  const totalWeeks =
    typeof source.totalWeeks === 'number' &&
    Number.isInteger(source.totalWeeks) &&
    source.totalWeeks >= 1 &&
    source.totalWeeks <= SEMESTER_MAX_WEEKS
      ? source.totalWeeks
      : DEFAULT_SEMESTER.totalWeeks
  // 结束日期可空；非法值回空（它是「仅作记录」的字段，宁可为空也不留一个假日期）
  const endDate = isSemesterDateKey(source.endDate) ? source.endDate : ''
  return { id: SEMESTER_SETTINGS_ID, name, startDate, totalWeeks, endDate }
}

/** 同步通道需要的数组形状：单对象包成单元素数组（键里始终只有一条设置） */
export function reviveSemesterList(raw: unknown[]): SemesterSettings[] {
  return [normalizeSemester(raw[0])]
}

/** 两个日期键相差的天数（`b - a`，按 UTC 计算——不碰时区、不碰夏令时） */
export function daysBetweenDateKeys(a: string, b: string): number {
  const parse = (key: string): number => {
    const [year, month, day] = key.split('-').map(Number)
    return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)
  }
  return Math.round((parse(b) - parse(a)) / 86_400_000)
}

/**
 * 教学周次表：第 1 周从开学日期起，每 7 天一周，共 `totalWeeks` 周。
 * 周次起始日期 = 开学日期 + (N-1) × 7 天（spec §3.2 的唯一口径）。
 */
export function semesterWeeks(config: SemesterSettings): SemesterWeek[] {
  const weeks: SemesterWeek[] = []
  for (let index = 1; index <= config.totalWeeks; index += 1) {
    const startDate = addDaysToDateKey(config.startDate, (index - 1) * 7)
    weeks.push({ index, startDate, endDate: addDaysToDateKey(startDate, 6) })
  }
  return weeks
}

/**
 * 某日期落在第几教学周（1 起）。
 * 开学日期当天 = 第 1 周；落在学期范围之外（早于开学 / 超过总周数）返回 `undefined`
 * ——调用方据此决定「不套用任何周次相关规则」，**不猜一个最近的周次**。
 */
export function weekIndexOfDate(config: SemesterSettings, dateKey: string): number | undefined {
  if (!isDateKey(dateKey)) return undefined
  const offset = daysBetweenDateKeys(config.startDate, dateKey)
  if (offset < 0) return undefined
  const index = Math.floor(offset / 7) + 1
  return index <= config.totalWeeks ? index : undefined
}

/** 按周数推算的最后一周结束日（结束日期一致性提示用；它不写回任何配置） */
export function computedSemesterEnd(config: SemesterSettings): string {
  return addDaysToDateKey(config.startDate, config.totalWeeks * 7 - 1)
}

/** 周次的一行说明，如「第3周 · 8月31日 — 9月6日」 */
export function formatWeekLabel(week: SemesterWeek): string {
  return `第${week.index}周 · ${formatMonthDay(week.startDate)} — ${formatMonthDay(week.endDate)}`
}

/**
 * 学期结束日期与按周数推算的最后一周结束日是否不一致（界面提示用，**不自动改配置**）。
 * 结束日期为空 = 尚未记录 → 不提示、不阻止其他功能（spec §3.1）。
 */
export function endDateMismatch(config: SemesterSettings): boolean {
  if (config.endDate === '') return false
  return config.endDate !== computedSemesterEnd(config)
}
