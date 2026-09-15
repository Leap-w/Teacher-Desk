import {
  addDaysToDateKey,
  formatMonthDay,
  isDateKey,
  isWeekendDateKey,
  weekdayOfDateKey,
} from '@/utils/date'
import { createId } from '@/utils/id'
import type { WeekendReturnRecord } from '@/types/weekend'

/**
 * 周末返家的纯函数（Phase 7B）。
 *
 * 「周末」在本模块里只有一个口径：**以该周末的周六日期键为标识**（`WeekendKey`）。
 * 周日不是另一个周末——`weekendKeyOf` 把它归到前一天。不引入 ISO 周号：
 * 教师说的是「这周末」，而周号的算法分歧（跨年、第一周从哪天算起）只会制造对不上的表格。
 * 日期比较一律走字符串字典序（`YYYY-MM-DD` 的字典序即时间序），与 `addDaysToDateKey` 同源。
 */

/** 周六 / 周日的星期序号（与 WEEKDAY_LABELS 同一张表：1 = 周一 … 7 = 周日） */
const SATURDAY = 6
const SUNDAY = 7

/**
 * 日期 → 它所属周末的周六键；**周一到周五没有可归属的周末，返回 undefined**。
 * 不做「工作日顺延到最近的周六」这类推测：教师选了周三就是选错了，
 * 而不是想登记下个周末——猜错一次就是把返家记录写到了错误的周末上。
 */
export function weekendKeyOf(dateKey: string): string | undefined {
  if (!isDateKey(dateKey) || !isWeekendDateKey(dateKey)) return undefined
  return weekdayOfDateKey(dateKey) === SUNDAY ? addDaysToDateKey(dateKey, -1) : dateKey
}

/** 周末键守卫：**周六**日期键（周日经 `weekendKeyOf` 归一后再校验，故这里只认周六） */
export function isWeekendKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    isDateKey(value) &&
    isWeekendDateKey(value) &&
    weekdayOfDateKey(value) === SATURDAY
  )
}

/**
 * 本周末（周六）键：今天就在周末里则是它（周日归到昨天），周一到周五取**即将到来的**那个周六。
 * 周一清早打开应用，教师要看的是「这个周末谁回家」——那一定是本周六，不是刚过去的那次。
 */
export function currentWeekendKey(todayKey: string): string {
  const weekday = weekdayOfDateKey(todayKey)
  if (weekday === SUNDAY) return addDaysToDateKey(todayKey, -1)
  if (weekday === SATURDAY) return todayKey
  return addDaysToDateKey(todayKey, SATURDAY - weekday)
}

/** 周末文案：「9月12日 – 9月13日」（周六 – 周日） */
export function formatWeekendLabel(weekendKey: string): string {
  return `${formatMonthDay(weekendKey)} – ${formatMonthDay(addDaysToDateKey(weekendKey, 1))}`
}

/**
 * 相对「本周末」的说法（周末页页头与工作台卡片用）。
 *
 * v3.2.0 起**只说得出三个词**：本周末 / 下周末 / 上周末；再远的周末一律改用
 * 它自己的日期，如「8月16日周末」「7月26日周末」——「上上周末」这种叠加说法
 * 教师要在脑子里做两次减法才知道是哪天，而日期不用算。
 * 相邻周末恒差 7 天，因此直接与「本周末 ± 7 天」比，不做日期相减（§9.11 的十进制算术教训）。
 */
export function describeWeekend(weekendKey: string, todayKey: string): string {
  const base = currentWeekendKey(todayKey)
  if (weekendKey === base) return '本周末'
  if (weekendKey === addDaysToDateKey(base, 7)) return '下周末'
  if (weekendKey === addDaysToDateKey(base, -7)) return '上周末'
  return `${formatMonthDay(weekendKey)}周末`
}

/**
 * 单条记录的健壮化（load 时逐条调用，风格同 normalizeLeaveRecord）：
 * 学生与周末键缺一即失去意义 → **丢弃该条**，不补臆造默认值（§11.3）。
 * 姓名为快照，空串可留（store 会按档案刷新，档案里也找不到时才丢弃，见 stores/weekend.ts）。
 */
export function normalizeWeekendReturn(raw: unknown): WeekendReturnRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<WeekendReturnRecord>
  if (typeof item.studentId !== 'string' || !item.studentId) return null
  if (!isWeekendKey(item.weekendDate)) return null
  return {
    id: typeof item.id === 'string' && item.id ? item.id : createId(),
    studentId: item.studentId,
    studentName: typeof item.studentName === 'string' ? item.studentName.trim() : '',
    weekendDate: item.weekendDate,
    createdAt:
      typeof item.createdAt === 'string' && item.createdAt
        ? item.createdAt
        : new Date().toISOString(),
  }
}

/**
 * 列表排序：**周末倒序**（本周末 / 下周末在最前，历史往后），同一周末内按姓名快照升序
 * （快照自带学号后四位，重名也分得开），末位用登记时间与 id 兜底，保证顺序确定、刷新不变。
 *
 * 姓名比对**必须写明 `zh-Hans-CN`**（拼音序），与 `utils/seat.ts` / `utils/timetable.ts` 同一约定。
 * 不写 locale 时 `localeCompare` 跟随运行环境的默认 locale：本机是 `zh-CN` 走拼音，
 * 而 CI 的 Linux runner（`LANG` 未设 → `en-US`）会退化成码点序，于是「王五」和「张三」
 * 谁在前变成机器相关——本机绿、CI 红。其余三处比的是日期串与 id（纯 ASCII），
 * 结果与 locale 无关，故意不加参数。
 */
export function sortWeekendReturns(records: WeekendReturnRecord[]): WeekendReturnRecord[] {
  return [...records].sort((a, b) => {
    const byWeekend = b.weekendDate.localeCompare(a.weekendDate)
    if (byWeekend !== 0) return byWeekend
    const byName = a.studentName.localeCompare(b.studentName, 'zh-Hans-CN')
    if (byName !== 0) return byName
    const byCreated = a.createdAt.localeCompare(b.createdAt)
    return byCreated !== 0 ? byCreated : a.id.localeCompare(b.id)
  })
}
