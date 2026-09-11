import { formatDateKey, formatMonthDay, isDateKey } from '@/utils/date'
import type { SelectOption } from '@/types'
import type { DayPoint, HalfDay, RegisterEndpoints, RegisterMode } from '@/types/point'

/**
 * 「日期 + 半天」时间点的公共件（Phase 7A 从 `utils/leave.ts` 抽出）。
 *
 * 请假（Phase 5）与周末返家（Phase 7）都要做同一件事：把一个「日期 + 上午 / 下午」
 * 当**可比较的时间**用——算时长、判先后、守「登记的是既成事实」这条守卫。
 * 两处若各算各的，跨月 / 跨年会各自出错（§9.11 的教训），所以只留这一份实现。
 */

/** 半天中文文案（时间点文案经 formatDayPoint 间接使用） */
export const HALF_DAY_LABELS: Record<HalfDay, string> = { am: '上午', pm: '下午' }

/** 半天表单选项（顺序即时间顺序） */
export const HALF_DAY_OPTIONS: SelectOption<HalfDay>[] = [
  { label: HALF_DAY_LABELS.am, value: 'am' },
  { label: HALF_DAY_LABELS.pm, value: 'pm' },
]

/** 登记方向中文文案（弹窗标题、按钮、提示共用一处） */
export const REGISTER_MODE_LABELS: Record<RegisterMode, string> = {
  left: '离校',
  back: '返校',
}

/** 另一端：离校的对面是返校，反之亦然 */
export function oppositeMode(mode: RegisterMode): RegisterMode {
  return mode === 'back' ? 'left' : 'back'
}

/** 取记录上的一端（mode 决定取哪端；登记弹窗用它区分「已有值 = 修改」与「参照的另一端」） */
export function pickRegisterPoint(
  endpoints: RegisterEndpoints,
  mode: RegisterMode,
): DayPoint | undefined {
  return mode === 'back' ? endpoints.backToSchool : endpoints.leftSchool
}

const MS_PER_DAY = 86_400_000

/**
 * 日期键 → 天序号（1970-01-01 起的天数，两个天序号相减即相隔天数）。
 * 用 `Date.UTC` 按年 / 月 / 日构造，全程 UTC，不读本地时区与夏令时；
 * 跨月 / 跨年的进位交给日历本身——直接对 `YYYYMMDD` 做十进制算术，
 * 会在 9-30 → 10-01 这种进位处把相差 1 天算成 71 天。
 */
function dayIndexOf(dateKey: string): number {
  const year = Number(dateKey.slice(0, 4))
  const month = Number(dateKey.slice(5, 7))
  const day = Number(dateKey.slice(8, 10))
  return Date.UTC(year, month - 1, day) / MS_PER_DAY
}

/** 半天守卫 */
function isHalfDay(value: unknown): value is HalfDay {
  return value === 'am' || value === 'pm'
}

/** 时间点守卫（日期 + 半天） */
export function isDayPoint(value: unknown): value is DayPoint {
  if (!value || typeof value !== 'object') return false
  const point = value as Partial<DayPoint>
  return isDateKey(point.date) && isHalfDay(point.half)
}

/**
 * 半天顺序键：把「日期 + 上午 / 下午」合成一个可比较的数值（天序号 × 2 + 半天偏移）。
 * 比较与相减共用这一个键——两者必须同源，否则「跨月时长」会与「跨月先后」打架
 * （注：不要用 `new Date('2026-09-11')`，那会被当作 UTC 午夜，东八区之外整体差一天；
 * `dayIndexOf` 是显式 `Date.UTC`，没有这个陷阱）。
 */
export function halfDayKey(point: DayPoint): number {
  return dayIndexOf(point.date) * 2 + (point.half === 'pm' ? 1 : 0)
}

/** 时间点文案，如「9月11日 上午」（离校 / 返校登记展示用） */
export function formatDayPoint(point: DayPoint): string {
  return `${formatMonthDay(point.date)} ${HALF_DAY_LABELS[point.half]}`
}

/**
 * 某个时刻落在哪个半天（登记弹窗的「此刻」与默认值）。
 * 这是一次性换算，**不驱动响应式**——需要「现在」随时间走的地方用 `useNow()`，
 * 把它的值传进来即可（跨零点时 `useNow` 会重新触发本函数）。
 */
export function dayPointOf(date: Date): DayPoint {
  return {
    date: formatDateKey(date),
    half: date.getHours() < 12 ? 'am' : 'pm',
  }
}

/** 时间线守卫的入参（由调用方构造，不需要具名引用，故不导出） */
interface RegisterCheckContext {
  /** 本次要登记的端点 */
  point: DayPoint
  /** 此刻（半天粒度） */
  now: DayPoint
  mode: RegisterMode
  /** 已登记的另一端；没有则不检查先后次序 */
  counterpart?: DayPoint
}

const ORDER_HINTS: Record<RegisterMode, string> = {
  left: '离校时间不能晚于已登记的返校时间',
  back: '返校时间不能早于离校时间',
}

/**
 * 记录端点（离校 / 返校）的健壮化：**形状合法且时间线自洽**才采用（load 时逐条调用）。
 *
 * 写入路径由 `registerPointError` 守着，这里守的是读回路径——被改坏的时间戳不展示，
 * 但记录本身仍保留：只留离校时间至少是「已离校」这个说得通的状态，教师可重新登记返校。
 * 两端**与 `start` / `end` 同款取副本**，不把缓存里的原始对象带进内存。
 */
export function normalizeRegisterEndpoints(raw: {
  leftSchool?: unknown
  backToSchool?: unknown
}): RegisterEndpoints {
  const leftSchool = isDayPoint(raw.leftSchool)
    ? { date: raw.leftSchool.date, half: raw.leftSchool.half }
    : undefined
  const backToSchool =
    leftSchool &&
    isDayPoint(raw.backToSchool) &&
    halfDayKey(raw.backToSchool) >= halfDayKey(leftSchool)
      ? { date: raw.backToSchool.date, half: raw.backToSchool.half }
      : undefined
  return { leftSchool, backToSchool }
}

/**
 * 登记时间点的时间线守卫：返回**错误文案**，空字符串表示通过。
 *
 * 两条规则（Phase 5 口径；Phase 7B 周末返家沿用）：
 * ① 登记的是既成事实，未来的时间点必然是填错了（选错年份最常见）——放行会让卡片
 *    立刻显示「已返校」这种没发生过的状态；
 * ② 与已登记的另一端不得颠倒（离校 ≤ 返校）。
 *
 * 只判这两条，**不判「是否落在记录的时段内」**：学生提前一晚走、晚半天回来都是常事，
 * 该不该管由教师判断，应用不替他做决定（§11.5）。
 */
export function registerPointError(context: RegisterCheckContext): string {
  const { point, now, mode, counterpart } = context
  if (halfDayKey(point) > halfDayKey(now)) {
    return `${REGISTER_MODE_LABELS[mode]}时间不能晚于现在`
  }
  if (counterpart) {
    const outOfOrder =
      mode === 'back'
        ? halfDayKey(point) < halfDayKey(counterpart)
        : halfDayKey(point) > halfDayKey(counterpart)
    if (outOfOrder) return ORDER_HINTS[mode]
  }
  return ''
}
