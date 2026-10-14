/**
 * 换课（v3.7.5）纯逻辑：**教学周次级的换课叠加层**。
 *
 * ## 与 v3.7.4 及更早的根本差别
 *
 * 旧换课（`CourseExchange` 没有 `weeks` 字段的那批记录）是**直接改基础课表**实现的：
 * 原位置的课被真的搬走、目标位置真的多出一条 `adjusted` 课程。v3.7.5 的规格要求
 * 「基础课程表长期独立，禁止直接改基础表实现换课」，因此新换课一律是**叠加层**：
 *
 * - 基础课表（`teacherdesk:timetable`）一个字节都不动；
 * - 换课记录自己带着「在哪些教学周生效」的周次数组；
 * - 某个教学周打开课程表时，由本文件的 `resolveWeekLessons` 把该周生效的换课
 *   叠加到基础课表上，算出**这一周实际怎么上**。
 *
 * 于是「换个周的课」与「换个学期的课表」彻底分家：撤销某周的换课不会碰到基础课表，
 * 改基础课表也不会把换课结果吞掉。
 *
 * ## 旧记录怎么办
 *
 * **不迁移、不转换、不丢弃**：`weeks === undefined` 的记录保持原样，基础课表里
 * 被它调整过的痕迹也保持原样。它们继续按老口径渲染（`exchangeFromAt` 的「调课」标记、
 * `adjusted` 课程），撤销走 `undoExchange` 的老路径。把它们「猜」成某个周次，
 * 等于替教师编造一个他不知道的生效范围（§8「不猜测转换」）。
 */

import { addDaysToDateKey, formatMonthDay } from '@/utils/date'
import { WEEKDAY_SHORT_LABELS, classIdOf, periodLabelOf } from '@/utils/timetable'
import type { CourseExchange, CoursePeriodId, Lesson, Weekday } from '@/types/timetable'
import type { SemesterWeek } from '@/types/semester'

/* ========== 周次字段的读写 ========== */

/**
 * 规范化「生效周次」：只保留 ≥1 的整数、去重、升序。
 *
 * 三种输入的区分很重要（决定这条记录的行为）：
 * - **不是数组**（含 `undefined`）→ 返回 `undefined`：这是 v3.7.5 之前的旧记录；
 * - 数组但一个合法周次都没有 → 返回 `[]`：记录留着但哪一周都不生效，界面提示教师重选
 *   （**绝不丢记录**，也不擅自当旧记录处理——那会凭空改基础课表）；
 * - 正常数组 → 规范化结果。
 */
export function normalizeExchangeWeeks(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const weeks = new Set<number>()
  for (const item of raw) {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 1) continue
    weeks.add(item)
  }
  return [...weeks].sort((a, b) => a - b)
}

/** 是否周次级换课（v3.7.5 起的新记录）：「有 weeks 字段」即新记录，空数组也算 */
export function isWeeklyExchange(exchange: CourseExchange): boolean {
  return Array.isArray(exchange.weeks)
}

/** 这条换课在某教学周是否生效（旧记录不算周次级，永远返回 false） */
export function appliesToWeek(exchange: CourseExchange, week: number): boolean {
  return isWeeklyExchange(exchange) && (exchange.weeks ?? []).includes(week)
}

/** 位置键（星期 + 时段）——本文件内部的唯一身份口径 */
export function slotKeyOf(weekday: Weekday, periodId: CoursePeriodId): string {
  return `${weekday}-${periodId}`
}

/** 位置的读法：「周三 第3节」 */
export function slotTextOf(weekday: Weekday, periodId: CoursePeriodId): string {
  return `${WEEKDAY_SHORT_LABELS[weekday]} ${periodLabelOf(periodId)}`
}

/** 课程的读法：「数学（高一9班）」——提示文案里指认某一节课时用 */
export function lessonTextOf(lesson: Pick<Lesson, 'subject' | 'className'>): string {
  return `${lesson.subject}（${lesson.className}）`
}

/* ========== 周次选择的文案 ========== */

/** 把升序周次压成区间：`[3,4,5,8]` → `3–5、8` */
function compressWeeks(weeks: readonly number[]): string {
  const parts: string[] = []
  let start = weeks[0]!
  let prev = start
  for (let i = 1; i <= weeks.length; i += 1) {
    const current = weeks[i]
    if (current !== undefined && current === prev + 1) {
      prev = current
      continue
    }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`)
    if (current === undefined) break
    start = current
    prev = current
  }
  return parts.join('、')
}

/**
 * 生效周次的一句话（换课列表、详情抽屉共用）：
 * 「全部 20 周」/「第 3–5、8 周」/「共 12 周：第 1–5、8、10–15 等」（太长时省略）。
 * 空数组 → 「未选择周次（不生效）」（如实说明，不假装它生效）。
 */
export function describeExchangeWeeks(weeks: readonly number[], weekCount: number): string {
  if (weeks.length === 0) return '未选择周次（不生效）'
  if (
    weekCount > 0 &&
    weeks.length >= weekCount &&
    weeks[0] === 1 &&
    weeks[weeks.length - 1] === weekCount
  ) {
    return `全部 ${weekCount} 周`
  }
  const text = compressWeeks(weeks)
  return weeks.length <= 6 ? `第 ${text} 周` : `共 ${weeks.length} 周（第 ${text} 等）`
}

/* ========== 某一教学周的实际课表 ========== */

/** 冲突类型：目标被占 / 两次换课抢同一个目标 / 两次换课抢同一个源 */
export type ExchangeConflictKind = 'target-occupied' | 'target-duplicated' | 'source-duplicated'

/** 一条换课冲突（提示里要说清「哪一周、哪一天、哪一节、涉及什么」） */
export interface ExchangeConflict {
  kind: ExchangeConflictKind
  /** 教学周序号（1 起） */
  week: number
  weekday: Weekday
  periodId: CoursePeriodId
  /** 涉及的换课记录 id（可能多条：抢同一个位置） */
  exchangeIds: string[]
  /** `target-occupied` 时给出占住目标的那节课的读法 */
  lessonText?: string
}

/** 某个教学周的解析结果 */
export interface WeekResolution {
  /** 该周实际生效的课程（基础课表 + 已应用的换课调整） */
  lessons: Lesson[]
  /** 已应用的换课记录 id */
  appliedIds: string[]
  /** 冲突的换课记录 id（冲突的那些**不应用**，目标位置原样保留） */
  conflictIds: string[]
  conflicts: ExchangeConflict[]
  /** 原时段已没有课程的换课记录 id（基础课表被改过，这条记录成了孤儿） */
  danglingIds: string[]
}

/**
 * 算出某个教学周实际怎么上。
 *
 * 规则（全部围绕「绝不静默覆盖」）：
 * 1. **源时段**：换课要搬走的那节课在基础课表里必须存在；不存在 → 这条记录是孤儿
 *    （`danglingIds`，不应用、不报冲突、更不删记录）；两条换课抢同一个源 → 冲突；
 * 2. **目标时段**：目标是空位（或该位置的课在本周被别的换课搬走）才能落；
 *    已被基础课表占住 → 冲突，**不覆盖**；两条换课抢同一个目标 → 冲突；
 * 3. 冲突的记录一律不应用，那一周的那一格原样显示基础课表——教师看到的是「课表没变」，
 *    而不是「某一节课被悄悄顶掉了」。
 *
 * 允许多条换课连成一条链（甲从 A 搬到 B、乙从 B 搬到 C）：B 在这周被乙腾空，
 * 甲正好落进去；两条互换（A↔B）同样成立。
 */
export function resolveWeekLessons(params: {
  lessons: readonly Lesson[]
  exchanges: readonly CourseExchange[]
  week: number
}): WeekResolution {
  const { lessons, exchanges, week } = params
  const weekly = exchanges.filter((exchange) => appliesToWeek(exchange, week))

  /** 基础课表按位置索引（一格只取首条：正常路径下 store 已保证一格一课） */
  const baseByKey = new Map<string, Lesson>()
  for (const lesson of lessons) {
    const key = slotKeyOf(lesson.weekday, lesson.periodId)
    if (!baseByKey.has(key)) baseByKey.set(key, lesson)
  }

  // ① 按「源时段」分组：源不存在 → 孤儿；同源多条 → 冲突
  const bySource = new Map<string, CourseExchange[]>()
  for (const exchange of weekly) {
    const key = slotKeyOf(exchange.from.weekday, exchange.from.periodId)
    const bucket = bySource.get(key)
    if (bucket) bucket.push(exchange)
    else bySource.set(key, [exchange])
  }

  const conflicts: ExchangeConflict[] = []
  const danglingIds: string[] = []
  const candidates: { exchange: CourseExchange; source: Lesson }[] = []

  for (const [key, group] of bySource) {
    const source = baseByKey.get(key)
    const first = group[0]!
    if (!source) {
      danglingIds.push(...group.map((exchange) => exchange.id))
      continue
    }
    if (group.length > 1) {
      conflicts.push({
        kind: 'source-duplicated',
        week,
        weekday: first.from.weekday,
        periodId: first.from.periodId,
        exchangeIds: group.map((exchange) => exchange.id),
      })
      continue
    }
    candidates.push({ exchange: first, source })
  }

  // ③ 目标时段判定，**迭代到稳定**：一条换课因为冲突落不了地，它腾出来的那个位置
  //    就不算「被腾空」，可能连带影响另一条——所以要一直算到没有新的冲突为止
  //    （每轮都会把有冲突的换课从候选里摘掉，因此轮数不超过候选条数，必然收敛）。
  let remaining = candidates
  let applied: { exchange: CourseExchange; source: Lesson }[] = []
  for (;;) {
    const vacated = new Set(
      remaining.map(({ exchange }) => slotKeyOf(exchange.from.weekday, exchange.from.periodId)),
    )
    const byTarget = new Map<string, { exchange: CourseExchange; source: Lesson }[]>()
    for (const candidate of remaining) {
      const key = slotKeyOf(candidate.exchange.to.weekday, candidate.exchange.to.periodId)
      const bucket = byTarget.get(key)
      if (bucket) bucket.push(candidate)
      else byTarget.set(key, [candidate])
    }

    const kept: typeof remaining = []
    const rejected: ExchangeConflict[] = []
    for (const [key, group] of byTarget) {
      const first = group[0]!.exchange
      if (group.length > 1) {
        rejected.push({
          kind: 'target-duplicated',
          week,
          weekday: first.to.weekday,
          periodId: first.to.periodId,
          exchangeIds: group.map((item) => item.exchange.id),
        })
        continue
      }
      const occupied = baseByKey.get(key)
      // 目标被基础课表占着、且这一周没有任何一条换课把它搬走 → 冲突，不覆盖
      if (occupied && !vacated.has(key)) {
        rejected.push({
          kind: 'target-occupied',
          week,
          weekday: first.to.weekday,
          periodId: first.to.periodId,
          exchangeIds: [first.id],
          lessonText: lessonTextOf(occupied),
        })
        continue
      }
      kept.push(group[0]!)
    }

    if (rejected.length === 0) {
      applied = kept
      break
    }
    conflicts.push(...rejected)
    remaining = kept
  }

  // ④ 应用：搬走的源位置去掉，落点放一条「由这次换课调整过来」的课程
  //    （`id` 沿用基础课表那条——它就是同一节课，只是这周在别的时间上）
  const movedSourceIds = new Set(applied.map(({ source }) => source.id))
  const result: Lesson[] = lessons.filter((lesson) => !movedSourceIds.has(lesson.id))
  for (const { exchange, source } of applied) {
    result.push({
      ...source,
      weekday: exchange.to.weekday,
      periodId: exchange.to.periodId,
      subject: exchange.to.subject || source.subject,
      className: exchange.to.className || source.className,
      classId: classIdOf(exchange.to.className || source.className),
      type: 'adjusted',
      exchangeId: exchange.id,
    })
  }

  return {
    lessons: result,
    appliedIds: applied.map(({ exchange }) => exchange.id),
    conflictIds: [...new Set(conflicts.flatMap((conflict) => conflict.exchangeIds))],
    conflicts,
    danglingIds,
  }
}

/* ========== 冲突提示文案 ========== */

/** 冲突所在的那一天（第 N 周 + 星期几 → 具体日期；周次表里没有该周时返回空串） */
export function conflictDateOf(conflict: ExchangeConflict, weeks: readonly SemesterWeek[]): string {
  const target = weeks.find((item) => item.index === conflict.week)
  if (!target) return ''
  return addDaysToDateKey(target.startDate, conflict.weekday - 1)
}

/**
 * 一条冲突的完整提示，含**日期、星期、节次、涉及课程 / 记录**（规格 §5 明确要求）。
 * 例：`第 5 周 周三（09-16）第3节：目标时段已有「数学（高一9班）」，本次换课不会覆盖它`。
 */
export function formatExchangeConflict(
  conflict: ExchangeConflict,
  weeks: readonly SemesterWeek[],
): string {
  const date = conflictDateOf(conflict, weeks)
  const head = `第 ${conflict.week} 周 ${slotTextOf(conflict.weekday, conflict.periodId)}${
    date ? `（${formatMonthDay(date)}）` : ''
  }`
  if (conflict.kind === 'target-occupied') {
    return `${head}：目标时段已有「${conflict.lessonText ?? '其他课程'}」，本次换课不会覆盖它`
  }
  if (conflict.kind === 'target-duplicated') {
    return `${head}：有 ${conflict.exchangeIds.length} 次换课都要调到这个时段`
  }
  return `${head}：有 ${conflict.exchangeIds.length} 次换课都要把这一节调走`
}
