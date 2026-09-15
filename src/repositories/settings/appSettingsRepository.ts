/**
 * 应用设置仓储（v3.0.4-rc · **v3.1.0 结构收敛到 `timeCenter`**）。
 *
 * 数据源：`teacherdesk:settings`（**单元素数组**，对齐备份模块「一个键 = 一个数组」
 * 的硬约束，与个人资料同一处置）。
 *
 * **一次性迁移**（两条路，都在读的时候做、都不写盘）：
 * ① 旧键 `teacherdesk:countdown`（V1.3.1 的 Hero 倒计时设置）→ 映射进新结构；
 * ② **同键里 v3.0.x 的扁平字段** → 折叠进 `timeCenter`。教师升级后打开应用，
 *    学期日期、支教日期、Hero 背景与文案、选中的倒计时原样还在，不必重填。
 *    旧键不删（它不再被读取，留着是对「原来的值是什么」的一份退路）。
 *
 * 设置是**本机偏好**，不进备份模块与云端同步（与 `teacherdesk:theme` 同一口径）——
 * 备份覆盖的是教师录入的业务数据，不是这台设备的外观与学期口径。
 */
import { appConfig } from '@/config'
import {
  BUILTIN_COUNTDOWNS,
  DATE_PATTERN,
  DEFAULT_HERO_COUNTDOWN_ID,
  HERO_BACKGROUNDS,
  TIME_PATTERN,
  type AppSettings,
  type CustomCountdown,
  type PeriodTimes,
  type TeachingSettings,
  type TimeCenter,
} from '@/types/appSettings'
import { COURSE_PERIOD_IDS } from '@/types/timetable'
import type { SeatView } from '@/types/seat'

import { localStorageAdapter } from '../adapters/LocalStorageAdapter'
import { createCollectionRepository } from '../base/createCollectionRepository'

const SETTINGS_KEY = `${appConfig.storageKeyPrefix}:settings`
/** 旧键：V1.3.1 的 Hero 倒计时设置（只读一次用于迁移） */
const LEGACY_COUNTDOWN_KEY = `${appConfig.storageKeyPrefix}:countdown`

/**
 * 默认设置：本学期 2026-09-01 开学 → 2027-01-24 期末，支教同起点。
 * 与 V1.3.1 的倒计时默认值一致，教师改过之后以盘上的值为准。
 */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  heroBackground: HERO_BACKGROUNDS[0]!.url,
  // 空 = Hero 上不显示副标题这一行（默认不替教师写「支教一年的高原记录」这种话）
  heroSubtitle: '',
  timeCenter: {
    serviceStart: '2026-09-01',
    semesterStart: '2026-09-01',
    semesterEnd: '2027-01-24',
    // 内置三项不在这里——它们由上面三个日期派生（见 `utils/timeCenter.ts`）
    countdowns: [],
    heroCountdownId: DEFAULT_HERO_COUNTDOWN_ID,
  },
  showProgress: true,
  teaching: {
    // 老师视角是最常用的那个（教师站在讲台后面看），也是打开座位表的原默认
    seatDefaultView: 'teacher',
    // 空 = 十个时段全部走 `COURSE_PERIODS` 的原值（学校作息没改过就不必存任何东西）
    periodTimes: {},
  },
}

/** 自定义倒计时的数量上限：给列表一个边界，也防盘上被写进一长串东西 */
const MAX_CUSTOM_COUNTDOWNS = 20

/** 日期字段：形状不对一律回默认值（不臆造日期） */
function dateOf(value: unknown, fallback: string): string {
  return typeof value === 'string' && DATE_PATTERN.test(value) ? value : fallback
}

function textOf(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

/**
 * 副标题：**空字符串是合法值**（= 不显示这一行），不能用 `textOf`——那样空值会被
 * 顶回默认值，教师清空副标题后再刷新又冒出来。
 */
function optionalTextOf(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback
}

/** 自定义倒计时列表：逐项健壮化，坏的整项丢掉（宁可少一项，不留半条记录） */
function countdownsOf(value: unknown): CustomCountdown[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: CustomCountdown[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const source = item as Record<string, unknown>
    const id = typeof source.id === 'string' ? source.id.trim() : ''
    const name = typeof source.name === 'string' ? source.name.trim() : ''
    const date = typeof source.date === 'string' ? source.date : ''
    // id 与名称缺一不可：没有 id 就无法被「首页显示」指认，没有名称列表上就是一行空白
    if (!id || !name || !DATE_PATTERN.test(date) || seen.has(id)) continue
    seen.add(id)
    result.push({ id, name, date })
    if (result.length >= MAX_CUSTOM_COUNTDOWNS) break
  }
  return result
}

/**
 * `heroCountdownId`：认不出（自定义项被删了、盘上是 v3.0.x 的 `countdownTarget` 旧值
 * 又对不上）就回内置第一项。**必须指向一个真实存在的项**——悬空的选择会让首页
 * 倒计时卡变成空白，那看起来像是坏了。
 */
function heroIdOf(value: unknown, countdowns: CustomCountdown[], fallback: string): string {
  const id = typeof value === 'string' ? value : ''
  if (BUILTIN_COUNTDOWNS.some((item) => item.id === id)) return id
  if (countdowns.some((item) => item.id === id)) return id
  return fallback
}

/**
 * 时光中心：三个日期 + 自定义列表 + 首页选中的那一项。
 * 传进来的若是 v3.0.x 的扁平结构，由 `normalizeSettings` 先折叠好再交给这里。
 */
function timeCenterOf(raw: unknown): TimeCenter {
  const fallback = DEFAULT_APP_SETTINGS.timeCenter
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<TimeCenter>
  const countdowns = countdownsOf(source.countdowns)
  return {
    serviceStart: dateOf(source.serviceStart, fallback.serviceStart),
    semesterStart: dateOf(source.semesterStart, fallback.semesterStart),
    semesterEnd: dateOf(source.semesterEnd, fallback.semesterEnd),
    countdowns,
    // 兜底值也要过一遍存在性检查：默认项一定在，但写成同一个函数不容易走岔
    heroCountdownId: heroIdOf(source.heroCountdownId, countdowns, fallback.heroCountdownId),
  }
}

/** 座位图默认视角：只认 `student`，其余一律回 `teacher`（含盘上被写坏的字符串） */
function seatViewOf(value: unknown): SeatView {
  return value === 'student' ? 'student' : 'teacher'
}

/**
 * 课程时间覆盖（v3.3.0）：**逐个时段校验，坏的整条丢掉**。
 *
 * 只有「合法时段 id + 两个合法 `HH:mm` + `start < end`」三条同时成立才收。
 * 松一格会怎样：存进一条 start 晚于 end 的记录，「当前 / 下一节课」状态机
 * （`utils/scheduleNow.ts`）在那一段永远既不 ongoing 也不 next，当天剩下的课全部消失。
 * 宁可退回默认作息，也不要一个静默失灵的课表。
 */
function periodTimesOf(raw: unknown): PeriodTimes {
  if (!raw || typeof raw !== 'object') return {}
  const source = raw as Record<string, unknown>
  const result: PeriodTimes = {}
  for (const id of COURSE_PERIOD_IDS) {
    const item = source[id]
    if (!item || typeof item !== 'object') continue
    const { start, end } = item as Record<string, unknown>
    if (typeof start !== 'string' || typeof end !== 'string') continue
    // `HH:mm` 零填充固定两位，字符串比较与时间先后一致
    if (!TIME_PATTERN.test(start) || !TIME_PATTERN.test(end) || start >= end) continue
    result[id] = { start, end }
  }
  return result
}

/** 教学设置：视角回退 + 时间覆盖逐条校验（v3.3.0 新增的嵌套块） */
function teachingOf(raw: unknown): TeachingSettings {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    seatDefaultView: seatViewOf(source.seatDefaultView),
    periodTimes: periodTimesOf(source.periodTimes),
  }
}

/**
 * 单份设置的健壮化（load / 跨标签页同步共用）：
 * 字段认不出回默认值，**绝不写盘**（只影响内存展示）。
 *
 * 兼容 v3.0.x 的扁平结构：那时三个日期与 `countdownTarget` / `heroTitle` /
 * `defaultHomeView` 都摊在最外层。这里把日期与目标**折叠进 `timeCenter`**——
 * 盘上还没被写回的教学机因此不需要教师重填任何东西。
 * （`heroTitle` / `defaultHomeView` 直接丢弃：前者已由倒计时名称取代，
 * 后者整项撤下，见 `types/appSettings.ts` 的说明。）
 */
function normalizeSettings(raw: unknown): AppSettings {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

  // 新结构优先；没有就按 v3.0.x 的扁平字段拼一个出来（旧的 `countdownTarget` 直接当 heroCountdownId）
  const timeCenterSource =
    source.timeCenter && typeof source.timeCenter === 'object'
      ? source.timeCenter
      : {
          serviceStart: source.serviceStart,
          semesterStart: source.semesterStart,
          semesterEnd: source.semesterEnd,
          countdowns: source.countdowns,
          heroCountdownId: source.heroCountdownId ?? source.countdownTarget,
        }

  return {
    heroBackground: textOf(source.heroBackground, DEFAULT_APP_SETTINGS.heroBackground),
    heroSubtitle: optionalTextOf(source.heroSubtitle, DEFAULT_APP_SETTINGS.heroSubtitle),
    timeCenter: timeCenterOf(timeCenterSource),
    showProgress:
      typeof source.showProgress === 'boolean'
        ? source.showProgress
        : DEFAULT_APP_SETTINGS.showProgress,
    // v3.3.0：盘上没有这一块（老版本写的）就是「没改过教学设置」，全部回默认
    teaching: teachingOf(source.teaching),
  }
}

/** 同步通道需要的数组形状：单对象包成单元素数组（键里始终只有一份设置） */
export function reviveSettingsList(raw: unknown[]): AppSettings[] {
  return [normalizeSettings(raw[0])]
}

const repository = createCollectionRepository<AppSettings[]>({
  key: SETTINGS_KEY,
  adapter: localStorageAdapter,
  reviveList: reviveSettingsList,
})

/** 把旧 `teacherdesk:countdown` 的值映射进新结构（缺什么回默认值） */
function migrateFromLegacy(): AppSettings | null {
  try {
    const raw = localStorageAdapter.readRaw(LEGACY_COUNTDOWN_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    const source = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
    const migrated = normalizeSettings({
      heroBackground: source.background,
      semesterStart: source.startDate,
      semesterEnd: source.targetDate,
      // 旧结构没有单独的「支教开始日期」：用学期起点兜底（两者在旧版本里就是同一个值）
      serviceStart: source.startDate,
      showProgress: source.showProgress,
    })
    console.info('[settings] 已从旧 teacherdesk:countdown 迁移 Hero 与学期设置')
    return migrated
  } catch (error) {
    console.warn('[settings] 旧倒计时设置读不出来，按默认值处理：', error)
    return null
  }
}

export const appSettingsRepository = {
  ...repository,

  /** 单份设置的健壮化（store 写入前兜一遍，非法日期不落盘） */
  normalize: normalizeSettings,

  /**
   * 读单份设置：键里存的是「单元素数组」（对齐同步层），也容忍直接存对象的历史写法；
   * 键不存在时先试旧键迁移，再退默认值（**不写盘**，教师改过才落盘）。
   */
  readSettings(): AppSettings {
    try {
      const raw = localStorageAdapter.readRaw(SETTINGS_KEY)
      if (raw === null) return migrateFromLegacy() ?? { ...DEFAULT_APP_SETTINGS }
      const parsed: unknown = JSON.parse(raw)
      const source = Array.isArray(parsed) ? parsed[0] : parsed
      return normalizeSettings(source)
    } catch (error) {
      console.warn('[settings] 读不出来，按默认设置处理：', error)
      return { ...DEFAULT_APP_SETTINGS }
    }
  },
}
