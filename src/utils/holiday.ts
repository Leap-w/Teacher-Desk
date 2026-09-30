/**
 * 假期管理的纯函数（v3.6.2）。
 *
 * 本模块只做三件事，都不碰存储、不碰 Vue：
 * 1. **虚拟周末假期**的派生与识别（周末没有实体，`id` 由周六日期键现算）；
 * 2. 假期与登记的**复活规则**（`normalizeHoliday` / `normalizeHolidayRecord`）；
 * 3. **二态**（离校 / 留校）的判定与计数——口径只在这里实现一次，
 *    首页卡片、详情页统计、导出名单全从这里取（§11.1）。
 *
 * 日期比较一律走字符串字典序（`YYYY-MM-DD` 的字典序即时间序），与 `utils/date.ts` 同源。
 */
import { addDaysToDateKey, formatMonthDay, isDateKey } from '@/utils/date'
import { createId } from '@/utils/id'
import { currentWeekendKey, isWeekendKey } from '@/utils/weekend'
import type { FamilyScope, Student } from '@/types'
import type { Holiday, HolidayEntry, HolidayRecord, HolidayStatus } from '@/types/holiday'

/**
 * 虚拟周末假期的 id 前缀。
 *
 * 用前缀 + 日期键而不是给周末也发一个 UUID：周末的身份**就是那一天**，
 * 派生出来的 id 在两台设备上必然一致，不依赖任何同步；也永远不会与
 * `createId()` 的 UUID 撞车（UUID 不含冒号）。
 */
export const WEEKEND_HOLIDAY_PREFIX = 'weekend:'

/** 周六日期键 → 该周末的虚拟假期 id */
export function weekendHolidayId(weekendKey: string): string {
  return `${WEEKEND_HOLIDAY_PREFIX}${weekendKey}`
}

/** 这条 id 是不是虚拟周末假期 */
export function isWeekendHolidayId(holidayId: unknown): holidayId is string {
  return typeof holidayId === 'string' && holidayId.startsWith(WEEKEND_HOLIDAY_PREFIX)
}

/**
 * 虚拟假期 id → 周六日期键；不是虚拟周末、或日期部分不是合法周六键时返回 undefined。
 * 「前缀对但日期坏」必须当作不认识——否则一条脏记录会变成一个没有日期的假期。
 */
export function weekendKeyOfHolidayId(holidayId: unknown): string | undefined {
  if (!isWeekendHolidayId(holidayId)) return undefined
  const key = holidayId.slice(WEEKEND_HOLIDAY_PREFIX.length)
  return isWeekendKey(key) ? key : undefined
}

/**
 * 周六日期键 → 内存里的那条虚拟假期（**不落库**）。
 *
 * `createdAt` / `updatedAt` 用 `startDate` 占位，只为让排序稳定（列表里所有项共用一条
 * 排序规则，虚拟项没有「建立时间」这回事，用日期本身当它就是确定的）。
 */
export function buildWeekendHoliday(weekendKey: string): Holiday {
  return {
    id: weekendHolidayId(weekendKey),
    name: '周末',
    startDate: weekendKey,
    endDate: addDaysToDateKey(weekendKey, 1),
    createdAt: weekendKey,
    updatedAt: weekendKey,
  }
}

/* ---------- 复活 ---------- */

/**
 * 单条假期的健壮化（load 时逐条调用）：
 * 名字与两个日期是这条记录的**全部信息**，缺一即失去意义 → 丢弃该条，不补臆造默认值（§11.3）。
 * `startDate > endDate` 时**交换**而不是丢弃：教师手滑把起止填反了，这条假期仍然是他想建的那个。
 * 注意日期只认 `isDateKey`（真实存在的日期），**不要求是周六** —— 自定义假期本来就是任意日期。
 */
export function normalizeHoliday(raw: unknown): Holiday | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<Holiday>
  const name = typeof item.name === 'string' ? item.name.trim() : ''
  if (!name) return null
  if (!isDateKey(item.startDate) || !isDateKey(item.endDate)) return null
  const [startDate, endDate] =
    item.startDate <= item.endDate ? [item.startDate, item.endDate] : [item.endDate, item.startDate]
  const note = typeof item.note === 'string' ? item.note.trim() : ''
  return {
    id: typeof item.id === 'string' && item.id ? item.id : createId(),
    name,
    startDate,
    endDate,
    // 空备注**不写这个字段**（同班费流水）：`note: ''` 与「没有备注」在展示与云端比对里是两回事
    ...(note ? { note } : {}),
    createdAt:
      typeof item.createdAt === 'string' && item.createdAt
        ? item.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof item.updatedAt === 'string' && item.updatedAt
        ? item.updatedAt
        : new Date().toISOString(),
  }
}

/**
 * 盘上的假期列表 → 内存值。按 `id` 去重，只保留首条（同 `reviveReturns` 的口径）。
 * 丢弃时 `console.warn` 一句，**盘上原文保留**——教师能据此找回，静默吞掉才是真的丢了。
 */
export function reviveHolidays(raw: unknown[]): Holiday[] {
  const seen = new Set<string>()
  const holidays = raw
    .map((item) => normalizeHoliday(item))
    .filter((item): item is Holiday => item !== null)
    .filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
  if (holidays.length < raw.length) {
    console.warn(`[holiday] 丢弃 ${raw.length - holidays.length} 条不合法的假期（缓存原文保留）`)
  }
  return holidays
}

/**
 * 单条登记的健壮化。
 *
 * 与 `normalizeWeekendReturn` 有三处**故意不同**：
 * - `date` 可以是任意日期（自定义假期不是周六），只要求是真实存在的日期；
 * - `returnHome` 必须是**布尔**：缺了它这条记录既不能说离校也不能说留校，
 *   补 `false` 会把一条坏数据变成「留校」这个事实 → **丢弃该条**；
 * - 假期 id 只要是非空字符串即可，**不校验日期部分**：这里没有足够信息判断
 *   一条 id 该不该存在（假期可能还没同步到本机），留到派生层当「孤儿」处理。
 *
 * `note`（v3.6.2 学生级假期备注）可选：非字符串一律当没有；trim 后为空**不写这个字段**
 * （与 `Holiday.note` 同口径——空串与「没有备注」在云端比对里是两回事）。
 */
export function normalizeHolidayRecord(raw: unknown): HolidayRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<HolidayRecord>
  if (typeof item.holidayId !== 'string' || !item.holidayId) return null
  if (typeof item.studentId !== 'string' || !item.studentId) return null
  if (!isDateKey(item.date)) return null
  if (typeof item.returnHome !== 'boolean') return null
  const note = typeof item.note === 'string' ? item.note.trim() : ''
  return {
    id: typeof item.id === 'string' && item.id ? item.id : createId(),
    holidayId: item.holidayId,
    studentId: item.studentId,
    studentName: typeof item.studentName === 'string' ? item.studentName.trim() : '',
    date: item.date,
    returnHome: item.returnHome,
    ...(note ? { note } : {}),
    createdAt:
      typeof item.createdAt === 'string' && item.createdAt
        ? item.createdAt
        : new Date().toISOString(),
  }
}

/**
 * 盘上的登记列表 → 内存值。两重去重，都只保留首条：同一 `id`；
 * 同一「学生 + 假期」——本模块的不变量是一个学生在一个假期里只有一条记录
 * （两处各有一条就成了「既离校又留校」）。
 */
export function reviveHolidayRecords(raw: unknown[]): HolidayRecord[] {
  const seenIds = new Set<string>()
  const seenPairs = new Set<string>()
  const records = raw
    .map((item) => normalizeHolidayRecord(item))
    .filter((item): item is HolidayRecord => item !== null)
    .filter((item) => {
      const pair = recordPairKey(item.holidayId, item.studentId)
      if (seenIds.has(item.id) || seenPairs.has(pair)) return false
      seenIds.add(item.id)
      seenPairs.add(pair)
      return true
    })
  if (records.length < raw.length) {
    console.warn(`[holiday] 丢弃 ${raw.length - records.length} 条不合法的假期登记（缓存原文保留）`)
  }
  return records
}

/* ---------- 排序 ---------- */

/**
 * 列表顺序：**按对「今天」的相关性分三档，档内再按日期**。
 *
 * 一开始写的是「起始日一律倒序」，看起来够用，其实是错的：本周末与下周末是**恒定存在**的
 * 虚拟项，而它们的日期总在未来，于是一个正在放着的假期（如 10/01–10/07 的国庆）
 * 会被排在 10/10 那个还没到的周末**下面**——教师正过着国庆，它却不在列表首位。
 *
 * 分档之后：正在放的排最前，其次是还没到的（近的在前），最后才是已经过去的（近的在前）。
 * 档内的规则与「越新越靠前」的原意一致，只是「新」在未来的那一档里反过来读
 *（未来是「越快到来越靠前」，过去是「刚结束的越靠前」）。
 */
function relevanceBucket(holiday: Holiday, todayKey: string): number {
  if (todayKey < holiday.startDate) return 1 // 还没到
  if (todayKey > holiday.endDate) return 2 // 已经过去
  return 0 // 正在放
}

/**
 * 假期比较器。三档之内再按起始日排：正在放与已过去的用**倒序**（越新越靠前），
 * 还没到的用**升序**（越快到来越靠前）。同一日按建立时间倒序、末位用 id 兜底，
 * 保证顺序确定、刷新不变。虚拟周末的 `createdAt` 就是它的日期（见 `buildWeekendHoliday`）。
 *
 * 列表项（含虚拟周末）与真实假期共用这一个比较器，两种项在同一张表里才不会各排各的。
 */
function compareHolidays(a: Holiday, b: Holiday, todayKey: string): number {
  const byBucket = relevanceBucket(a, todayKey) - relevanceBucket(b, todayKey)
  if (byBucket !== 0) return byBucket
  const upcoming = relevanceBucket(a, todayKey) === 1
  const byStart = upcoming
    ? a.startDate.localeCompare(b.startDate)
    : b.startDate.localeCompare(a.startDate)
  if (byStart !== 0) return byStart
  const byCreated = b.createdAt.localeCompare(a.createdAt)
  return byCreated !== 0 ? byCreated : a.id.localeCompare(b.id)
}

/** 假期列表排序（不修改入参）；`todayKey` 决定「正在放 / 还没到 / 已过去」三档怎么分 */
export function sortHolidays<T extends Holiday>(holidays: T[], todayKey: string): T[] {
  return [...holidays].sort((a, b) => compareHolidays(a, b, todayKey))
}

/**
 * 登记排序：日期倒序 → 姓名升序（拼音序，**必须写明 `zh-Hans-CN`**，理由同 `sortWeekendReturns`：
 * 不写时 CI 的 Linux runner 会退化成码点序，本机绿、CI 红）→ 登记时间 → id。
 */
export function sortHolidayRecords(records: HolidayRecord[]): HolidayRecord[] {
  return [...records].sort((a, b) => {
    const byDate = b.date.localeCompare(a.date)
    if (byDate !== 0) return byDate
    const byName = a.studentName.localeCompare(b.studentName, 'zh-Hans-CN')
    if (byName !== 0) return byName
    const byCreated = a.createdAt.localeCompare(b.createdAt)
    return byCreated !== 0 ? byCreated : a.id.localeCompare(b.id)
  })
}

/* ---------- 二态 ---------- */

/**
 * 二态的中文标签。导出名单的「假期去向」列与页面徽标共用这一份。
 *
 * `home` 的文案是**离校**（v3.6.2 起）：规格里的核心规则是「回家的人登记离校」，
 * 教师口中的动作也是「离校」，页头统计卡片同样写「离校」。
 */
export const HOLIDAY_STATUS_LABELS: Record<HolidayStatus, string> = {
  home: '离校',
  stay: '留校',
}

/** 「学生 + 假期」的唯一键（去重与状态查表共用） */
export function recordPairKey(holidayId: string, studentId: string): string {
  return `${holidayId}|${studentId}`
}

/**
 * 登记列表 → 状态查表（`学生 + 假期` → `returnHome`）。
 * 表只建一次、按需查，不在逐人循环里 `find` 一遍列表（名单是几十人 × 详情页每次重算）。
 */
export function buildStatusIndex(records: HolidayRecord[]): Map<string, boolean> {
  const index = new Map<string, boolean>()
  for (const record of records)
    index.set(recordPairKey(record.holidayId, record.studentId), record.returnHome)
  return index
}

/**
 * 一个学生在某个假期里的去向——**逐人求值，不用补集减**。
 *
 * v3.6.2 的口径只有一句话：**有离校记录就是离校，没有就是留校**。
 *
 * - 查表命中 `returnHome: true` → `home`；命中 `false` → `stay`；
 * - **查不到记录 → `stay`**。这正是本版要的：v3.6.1 的第三态「未登记」被彻底删掉，
 *   它留下的旧数据（没有任何记录）升级后**直接就是留校**，不需要迁移、不弹确认；
 * - `weekendRegisteredIds` 是**周末专属**的旁路：老键 `teacherdesk:weekendReturns` 里的
 *   离校记录（v3.6.1 之前的全部历史 + 之后每一次周末离校登记）。命中即 `home`，
 *   哪怕新键里同一个人同一个周末还有一条留校/备注影子——**离校优先**，因为老键那条是教师
 *   在先前的界面里明确登记过的，而影子只可能是备注载体或跨版本打架留下的。
 *   这里只读不写：影子记录被**遮蔽**，不会被自动清掉（见 stores/holiday.ts 的说明）。
 */
export function statusOf(
  holidayId: string,
  studentId: string,
  index: Map<string, boolean>,
  weekendRegisteredIds?: Set<string>,
): HolidayStatus {
  if (weekendRegisteredIds?.has(studentId)) return 'home'
  const flag = index.get(recordPairKey(holidayId, studentId))
  if (flag === undefined) return 'stay'
  return flag ? 'home' : 'stay'
}

/** 二态计数。分母由调用方给（一律在读学生，口径在 store 里），这里只做分组 */
export function countStatuses(
  holidayId: string,
  studentIds: string[],
  index: Map<string, boolean>,
  weekendRegisteredIds?: Set<string>,
): Record<HolidayStatus, number> {
  const counts: Record<HolidayStatus, number> = { home: 0, stay: 0 }
  for (const studentId of studentIds) {
    counts[statusOf(holidayId, studentId, index, weekendRegisteredIds)] += 1
  }
  return counts
}

/**
 * 「离校 ∩ 某个返家范围」的人数（v3.6.2 规格第七节的第三张卡片：昌都市外离校）。
 *
 * 它**不是第三种状态**——只是「离校」里的一个筛选维度，所以这里数的是
 * 「状态是 `home` 且 `familyLocation.scope === scope`」的在读学生，
 * 分母同 `countStatuses`（一律在读学生）。`familyLocation` 缺失的学生自然不进这个数
 * （家庭所在地没填 ≠ 昌都市外）。
 *
 * `scope` 由调用方给（页面写 `'outside-changdu'`），**不修改 `FamilyScope` 的定义**。
 */
export function countHomeInScope(
  holidayId: string,
  students: readonly Student[],
  index: Map<string, boolean>,
  scope: FamilyScope,
  weekendRegisteredIds?: Set<string>,
): number {
  let count = 0
  for (const student of students) {
    if (student.familyLocation?.scope !== scope) continue
    if (statusOf(holidayId, student.id, index, weekendRegisteredIds) === 'home') count += 1
  }
  return count
}

/* ---------- 列表与当前项 ---------- */

/** 这一天是否落在这个假期区间内（含首尾） */
export function holidayCoversDate(holiday: Holiday, dateKey: string): boolean {
  return dateKey >= holiday.startDate && dateKey <= holiday.endDate
}

/**
 * 页面列表：**自定义假期 ∪ 给定的周末**。
 *
 * `weekendKeys` 由 store 给（有登记的周末 ∪ 本周末 ∪ 下周末），本函数不再自己推导——
 * 「哪些周末该出现在列表里」是业务口径，与老键的记录有关，那是 store 的事。
 */
export function buildHolidayEntries(
  holidays: Holiday[],
  weekendKeys: string[],
  todayKey: string,
): HolidayEntry[] {
  const entries: HolidayEntry[] = [
    ...holidays.map((holiday): HolidayEntry => ({ kind: 'custom', holiday })),
    ...weekendKeys.map((weekendKey): HolidayEntry => ({
      kind: 'weekend',
      holiday: buildWeekendHoliday(weekendKey),
      weekendKey,
    })),
  ]
  return entries.sort((a, b) => compareHolidays(a.holiday, b.holiday, todayKey))
}

/**
 * 打开页面时默认看哪一个：**今天落在哪个自定义假期里就看它**（可能有多个重叠，
 * 取起始日最晚的那个——列表已按起始日倒序，第一个命中的就是最"里层"的那个），
 * 否则看本周末（那一项恒定在列表里），再否则退到列表首项。
 *
 * 只做一次快照给页面用：跨零点时「今天」会翻篇，但教师正看着的那一项不该跟着跳走。
 */
export function pickCurrentEntry(
  entries: HolidayEntry[],
  todayKey: string,
): HolidayEntry | undefined {
  const covering = entries.find(
    (entry) => entry.kind === 'custom' && holidayCoversDate(entry.holiday, todayKey),
  )
  if (covering) return covering
  const weekendKey = currentWeekendKey(todayKey)
  return entries.find((entry) => entry.weekendKey === weekendKey) ?? entries[0]
}

/** 假期区间文案：单日「10月1日」，跨天「10月1日 – 10月7日」 */
export function formatHolidayRange(holiday: Holiday): string {
  if (holiday.startDate === holiday.endDate) return formatMonthDay(holiday.startDate)
  return `${formatMonthDay(holiday.startDate)} – ${formatMonthDay(holiday.endDate)}`
}

/**
 * 相对今天的说法：进行中 / 还有 N 天 / 已结束 N 天。
 * 天数用日期键做**字符串比较**得出的整日差（都经 `Date.UTC`，不含时分秒，不涉时区与夏令时）。
 */
export function describeHoliday(holiday: Holiday, todayKey: string): string {
  if (todayKey < holiday.startDate) {
    return `还有 ${daysBetween(todayKey, holiday.startDate)} 天`
  }
  if (todayKey > holiday.endDate) {
    return `已结束 ${daysBetween(holiday.endDate, todayKey)} 天`
  }
  return '进行中'
}

/** 两个日期键之间的整日数（`to - from`，恒 ≥ 0 由调用方保证） */
function daysBetween(from: string, to: string): number {
  const utc = (dateKey: string) => {
    const [year, month, day] = dateKey.split('-').map(Number)
    return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)
  }
  return Math.round((utc(to) - utc(from)) / 86_400_000)
}
