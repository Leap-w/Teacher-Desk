import {
  addDaysToDateKey,
  formatMonthDay,
  isDateKey,
  isWeekendDateKey,
  weekdayOfDateKey,
} from '@/utils/date'
import { createId } from '@/utils/id'
import { isPlainObject } from '@/utils/object'
import { WEEKDAY_LABELS } from '@/utils/timetable'
import type { DutyGroup, DutyRecord, DutySettings } from '@/types/duty'
import type { Weekday } from '@/types/timetable'

/** 轮换设置记录的固定 id：同一个数组里只应存在一条（load 时据此去重 / 补默认） */
export const DUTY_SETTINGS_ID = 'duty-settings'

/** 未设置轮换起点时的默认值（页面据此提示教师「还没设起点」） */
export const DEFAULT_DUTY_SETTINGS: DutySettings = {
  id: DUTY_SETTINGS_ID,
  kind: 'settings',
  startDate: '',
  startGroupId: '',
  includeWeekend: false,
}

/**
 * 轮换起点日期接受的年份范围。
 * `<input type="date">` 允许手输年份，一个 `9999-12-31` 的起点会让逐日推进走 290 万步
 * （工作台每次渲染都要算「接下来 7 天」），整页卡死；而逐日推进本身正是为了不写错
 * 日期算术才选的做法，改算法不值当——把起点限在合理年份内更简单（§11.3）。
 */
export const DUTY_MIN_YEAR = 2000
export const DUTY_MAX_YEAR = 2099

/**
 * 轮换起点日期是否合法：真实存在的日期键，且年份在 DUTY_MIN_YEAR–DUTY_MAX_YEAR 之内。
 * 写入（store.setRotation）与读取（normalizeDutyRecord）**都要过这一关**：
 * 只在写入时拦，改坏过的缓存仍然会让页面卡死。
 */
export function isDutyDateKey(value: unknown): value is string {
  if (!isDateKey(value)) return false
  const year = Number(value.slice(0, 4))
  return year >= DUTY_MIN_YEAR && year <= DUTY_MAX_YEAR
}

/** 是否为值日组记录 */
export function isDutyGroup(record: DutyRecord): record is DutyGroup {
  return record.kind === 'group'
}

/** 是否为轮换设置记录 */
export function isDutySettings(record: DutyRecord): record is DutySettings {
  return record.kind === 'settings'
}

/** 新建组时的默认组名：按现有组数顺延（第 1 组 / 第 2 组 …） */
export function defaultDutyGroupName(groupCount: number): string {
  return `第 ${groupCount + 1} 组`
}

/**
 * 组员 id 列表的清洗：只留非空字符串、去重、保持原顺序（重复 id 会让勾选状态分叉）。
 * 读取与写入都走这里：只清洗缓存的话，页面上勾出重复 id 仍然能写进 store，
 * 下次读回来又被悄悄删掉一半（§11.3）。
 */
export function normalizeStudentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const ids: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !item || seen.has(item)) continue
    seen.add(item)
    ids.push(item)
  }
  return ids
}

/**
 * 单条记录的健壮化（load 时逐条调用）。
 * 与六个既有 store 同口径：字段类型不对就回退到安全值，**不因为一条脏数据丢掉整块**；
 * 只有「完全认不出是什么记录」才返回 null（调用方丢弃该条并保留缓存原文）。
 */
export function normalizeDutyRecord(raw: unknown): DutyRecord | null {
  if (!isPlainObject(raw)) return null
  if (raw.kind === 'settings') {
    return {
      // 设置是单例：id 一律归一到 DUTY_SETTINGS_ID，否则改过 id 的缓存会绕过「只认一条」的去重
      id: DUTY_SETTINGS_ID,
      kind: 'settings',
      // 起点日期认不出 / 年份离谱就是「还没设」：宁可让教师重设一次，
      // 也不要拿一个错日期去推进轮换（9999 年那种会让页面卡死）
      startDate: isDutyDateKey(raw.startDate) ? raw.startDate : '',
      startGroupId: typeof raw.startGroupId === 'string' ? raw.startGroupId : '',
      includeWeekend: raw.includeWeekend === true,
    }
  }
  if (raw.kind !== 'group') return null
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createId(),
    kind: 'group',
    // 组名缺失不丢组：留一个占位名，教师改名即可（丢了就等于把组员编排一起丢了）
    name: name || '未命名组',
    studentIds: normalizeStudentIds(raw.studentIds),
  }
}

/**
 * 从起点日到目标日的**有效值日天数**（目标日早于起点时为负）。
 * 排周末时每天消耗一个轮换位；不排周末时跳过周六 / 周日——周末不消耗轮换，
 * 周一是「上一组的下一组」。
 * 逐日推进而不是「天数差再减去周末数」——后者要处理起点落在周末、跨年的星期偏移，
 * 算错一次就是整张值日表错位；日子有两个合法日期键夹着，最多走几万步
 * （教师看的是「接下来 7 天」，起点年份另有 isDutyDateKey 把关）。
 */
function effectiveDayOffset(targetKey: string, startKey: string, includeWeekend: boolean): number {
  // 认不出的日期不多走一步：起点为空（还没设置）与非日期字符串都在这里落地
  if (!isDateKey(startKey) || !isDateKey(targetKey)) return 0
  // 起点落在不排的日子（周末不排时的周六 / 周日）时，从**下一个值日日**起算：
  // 「这一天由起点组值日」对不上一个不值日的日子，让真正的第一天（周一）拿起点组，
  // 与轮换说明 describeRotation 的补充说法保持一致
  let cursor = startKey
  if (!includeWeekend) {
    while (isWeekendDateKey(cursor)) cursor = addDaysToDateKey(cursor, 1)
  }
  // 方向由**对齐后的起点**决定：目标日恰好是那个周末时，按原起点定方向会朝反方向走开，
  // 永远到不了终点（死循环）。对齐后的起点到任何目标日都只需单向前进
  const step = targetKey >= cursor ? 1 : -1
  let offset = 0
  while (cursor !== targetKey) {
    cursor = addDaysToDateKey(cursor, step)
    if (includeWeekend || !isWeekendDateKey(cursor)) offset += step
  }
  return offset
}

/**
 * 某一天值日的组。
 * 起点组取「设置里指定的那个组」；那个组已被删除（或设置从未指定 / 组 id 失效）时
 * 按**第一个组**兜底——宁可让轮换从头开始，也不要让整块值日表变成空白。
 * 不排周末时，周末返回 undefined（那天不值日）；**还没设起点日期时每天都是 undefined**
 * （见下），此时页面各处一致地提示「还没设置轮换起点」。
 */
export function dutyGroupFor(
  dateKey: string,
  groups: DutyGroup[],
  settings: DutySettings,
): DutyGroup | undefined {
  if (groups.length === 0) return undefined
  // 认不出的日期直接说「这天没排」：下面的逐日推进需要一个合法终点，否则会一直走下去
  if (!isDateKey(dateKey)) return undefined
  if (!settings.includeWeekend && isWeekendDateKey(dateKey)) return undefined
  // 没设起点日期就没有轮换基准：这里**不再退回第一个组**——那会让「接下来 7 天」每天都
  // 显示同一组，看着像轮换坏了，与旁边「还没设置轮换起点」的提示自相矛盾。
  // 页面据此给出「去设置起点」的空态（建第一个组时 store 会自动补上起点，正常用不到）。
  // 起点年份离谱（外部导入的 9999 年）同样按「没设」论：逐日推进走到那儿要几百万步，
  // 这里是纯函数，读盘路径的清洗之外**自己也要挡一道**（§11.3）
  if (!isDutyDateKey(settings.startDate)) return undefined
  const startIndex = groups.findIndex((group) => group.id === settings.startGroupId)
  const base = startIndex >= 0 ? startIndex : 0
  const offset = effectiveDayOffset(dateKey, settings.startDate, settings.includeWeekend)
  const index = (((base + offset) % groups.length) + groups.length) % groups.length
  return groups[index]
}

/** 值日安排里的一天（「接下来 N 天」列表用） */
export interface DutyDay {
  dateKey: string
  weekday: Weekday
  /** 该日值日的组；不值日（不排周末的周六 / 周日）或还没有组时为 undefined */
  group?: DutyGroup
}

/** 从 `fromDateKey` 起连续 `days` 天的值日安排（含当天） */
export function dutyDaysFrom(
  fromDateKey: string,
  days: number,
  groups: DutyGroup[],
  settings: DutySettings,
): DutyDay[] {
  const list: DutyDay[] = []
  for (let index = 0; index < days; index += 1) {
    const dateKey = addDaysToDateKey(fromDateKey, index)
    list.push({
      dateKey,
      weekday: weekdayOfDateKey(dateKey),
      group: dutyGroupFor(dateKey, groups, settings),
    })
  }
  return list
}

/** 今天值日的状态（判定阶梯的四种出口，见 `dutyTodayState`） */
export type DutyTodayState = 'group' | 'needs-setup' | 'weekend-skipped' | 'no-groups'

/**
 * 「今天值日吗」的判定阶梯：工作台的**今日值日卡片与班级概况卡片共用这一处**。
 * 顺序有讲究——先「还没设起点」再「今天不值日」：两块卡片挨着显示，
 * 顺序不一致时同一个周末会一块说「还没设置轮换起点」、另一块说「今天不值日」，
 * 看着像程序自相矛盾（§11.1）。文案各卡片自己写，判定只此一份。
 *
 * 注意 `group` 本身已是「今天有组」的结论（`dutyGroupFor` 算出来的），
 * 所以这里先看它：有组时轮换设置必然是齐的。
 *
 * 收编时顺手纠掉一处自相矛盾（Phase 8 记录）：旧模板里「有组 ∧ 还没设起点 ∧ 今天周末不排」
 * 这一种输入会落到页脚兜底句「值日组与轮换设置都在值日管理页。」，可上方的横条正说着
 * 「还没设置轮换起点」——现在统一判成 `needs-setup`，横条与页脚指的是同一件事。
 */
export function dutyTodayState(
  group: DutyGroup | undefined,
  options: { weekendSkipped: boolean; needsSetup: boolean },
): DutyTodayState {
  if (group) return 'group'
  if (options.needsSetup) return 'needs-setup'
  if (options.weekendSkipped) return 'weekend-skipped'
  return 'no-groups'
}

/**
 * 「接下来谁值日」：`days` 里**今天之后**第一个有组的日子（今天由调用方自己说，不在这里重复）。
 * 今日值日卡片与班级概况卡片共用一处——各写一遍就会在「今天本身算不算下一次」
 * 「不值日的日子跳过没有」这些边界上分叉（§11.1）。
 */
export function nextDutyDay(days: DutyDay[], todayKey: string): DutyDay | undefined {
  return days.find((day) => day.dateKey !== todayKey && day.group)
}

/**
 * 某一天值日的说法，如「明天由「第 1 组」值日」；没有这一天（或那天不值日）时返回空串。
 * 紧挨着的 tomorrow 说「明天」、其余日子说星期几——教师看这两张卡片时最省事的说法。
 */
export function describeDutyDay(day: DutyDay | undefined, todayKey: string): string {
  if (!day || !day.group) return ''
  const when = day.dateKey === addDaysToDateKey(todayKey, 1) ? '明天' : WEEKDAY_LABELS[day.weekday]
  return `${when}由「${day.group.name}」值日`
}

/**
 * 轮换设置的展示文案（设置面板与工作台卡片共用一处，避免两处各写一句、口径分叉）。
 * 起点未设置或没有组时给出「还没排班」的说法，不编造日期。
 */
export function describeRotation(settings: DutySettings, groups: DutyGroup[]): string {
  if (groups.length === 0) return '还没有值日组'
  if (!settings.startDate) return '还没设置轮换起点'
  const start = groups.find((group) => group.id === settings.startGroupId) ?? groups[0]
  const weekend = settings.includeWeekend ? '周六周日也排' : '周末不排'
  // 起点落在不排的日子：说明实际从下一个值日日起算，别让「从 X 起某组值日」
  // 与排出来的表对不上（教师会以为程序排错了）
  const from =
    !settings.includeWeekend && isWeekendDateKey(settings.startDate)
      ? `${formatMonthDay(settings.startDate)} 起（那天不值日，从下一个值日日开始轮）`
      : `${formatMonthDay(settings.startDate)} 起`
  return `从 ${from}，${start?.name ?? '第一个组'} 值日，每天顺延一组（${weekend}）`
}
