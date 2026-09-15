import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { useNow } from '@/composables/useToday'
import {
  appSettingsRepository,
  DEFAULT_APP_SETTINGS,
} from '@/repositories/settings/appSettingsRepository'
import {
  isBuiltinCountdown,
  listCountdowns,
  makeCustomCountdown,
  resolveHeroCountdown,
} from '@/utils/timeCenter'
import type { CountdownEntry } from '@/utils/timeCenter'
import type {
  AppSettings,
  CustomCountdown,
  PeriodTime,
  TeachingSettings,
  TimeCenter,
} from '@/types/appSettings'
import { DATE_PATTERN, TIME_PATTERN } from '@/types/appSettings'
import { countPeriodOverrides, resolvePeriods } from '@/utils/timetable'
import type { CoursePeriod, CoursePeriodId } from '@/types/timetable'
import type { SeatView } from '@/types/seat'

export { DEFAULT_APP_SETTINGS } from '@/repositories/settings/appSettingsRepository'

const DAY_MS = 24 * 60 * 60 * 1000

/** 当天零点的时间戳（按本地日历日算，不用 toISOString 的 UTC 口径） */
function dayKeyOf(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** `YYYY-MM-DD` → 当天零点时间戳；非法日期返回 null */
function dateKeyOf(iso: string): number | null {
  const parsed = new Date(`${iso}T00:00:00`)
  const time = parsed.getTime()
  return Number.isNaN(time) ? null : time
}

/**
 * 应用设置（v3.0.4-rc · **v3.1.0 起时间的唯一数据源**）。
 *
 * 这一层回答的问题，全部由 `settings.timeCenter` 那一份派生（时间取自 `useNow()`
 * 的共享时钟，30 秒刷新一次、跨零点自动翻篇）：
 * - **工作天数**（支教）：`timeCenter.serviceStart` → 今天，含首日（「第 X 天」）
 * - **学期进度**：`timeCenter.semesterStart` → `semesterEnd` 的百分比
 * - **首页倒计时**：`heroCountdown`（内置三项或任一自定义项）→ 天数与名称
 *
 * **同一口径只有一个来源**（§11.1）：内置项的日期就是 `timeCenter` 上的日期字段，
 * 自定义项的日期存在 `timeCenter.countdowns` 里，选择存在 `heroCountdownId` 里。
 * 页面里不许再算一遍 —— 首页 Hero、工作时光、时光中心设置页三处读的都是这里的派生值。
 *
 * 派生值不进盘（改日期即重算），写入只经 `update()` / 下面的倒计时 CRUD——
 * 每个动作都是一次写盘 + 一次广播，与其余 store 同一套持久化纪律
 * （Repository First + syncPersisted）。
 */
export const useAppSettingsStore = defineStore('appSettings', () => {
  /** 持久化形状是**单元素数组**（对齐备份模块「一个键 = 一个数组」的硬约束） */
  const settingsList = ref<AppSettings[]>([appSettingsRepository.readSettings()])

  appSettingsRepository.bind(settingsList)

  const settings = computed<AppSettings>(() => settingsList.value[0] ?? { ...DEFAULT_APP_SETTINGS })

  /** 时光中心（时间的唯一容器） */
  const timeCenter = computed<TimeCenter>(() => settings.value.timeCenter)

  const now = useNow()

  /** 工作天数：支教第 X 天（含首日，未到开始日则显示 1） */
  const daysWorked = computed(() => {
    const start = dateKeyOf(timeCenter.value.serviceStart)
    if (start === null) return 1
    return Math.max(1, Math.floor((dayKeyOf(now.value) - start) / DAY_MS) + 1)
  })

  /** 学期总天数（两端都算，最小 1 天——避免除零） */
  const semesterTotalDays = computed(() => {
    const start = dateKeyOf(timeCenter.value.semesterStart)
    const end = dateKeyOf(timeCenter.value.semesterEnd)
    if (start === null || end === null) return 1
    return Math.max(1, Math.round((end - start) / DAY_MS))
  })

  /** 学期进度（0–100，越界收敛；终点已过即 100） */
  const termProgress = computed(() => {
    const start = dateKeyOf(timeCenter.value.semesterStart)
    const end = dateKeyOf(timeCenter.value.semesterEnd)
    if (start === null || end === null) return 0
    const total = end - start
    if (total <= 0) return 100
    const passed = Math.min(Math.max(dayKeyOf(now.value) - start, 0), total)
    return Math.round((passed / total) * 100)
  })

  /** 学期倒计时：距期末还有几天（今天算还没结束的一天；已过为 0） */
  const termDaysRemaining = computed(() => {
    const end = dateKeyOf(timeCenter.value.semesterEnd)
    if (end === null) return 0
    return Math.max(0, Math.ceil((end - dayKeyOf(now.value)) / DAY_MS))
  })

  /** 学期是否已结束（Hero 倒计时卡据此换文案） */
  const termIsOver = computed(() => termDaysRemaining.value <= 0)

  /* ---------- 倒计时（v3.1.0：内置三项 + 自定义，首页显示其中一项） ---------- */

  /** 完整列表：内置三项（日期跟着上面三个字段走）+ 自定义项——时光中心设置页的列表就是它 */
  const countdownEntries = computed<CountdownEntry[]>(() => listCountdowns(timeCenter.value))

  /**
   * 首页 Hero 正显示的那一项。**一定有一项**——`heroCountdownId` 悬空时回内置默认，
   * 卡片不会变空白（解析规则见 `utils/timeCenter.ts`）。
   */
  const heroCountdown = computed<CountdownEntry>(() => resolveHeroCountdown(timeCenter.value))

  /**
   * 距某个日期还有几天：**正数 = 还剩几天，0 = 就是今天，负数 = 已经过了几天**。
   *
   * 用**有符号**而不是像学期倒计时那样收敛到 0：目标可能落在过去（选了「距离出发」
   * 而它早已过去），把负数压成 0 只会显示成「还剩 0 天」，教师看不出是没开始还是早过了。
   * 卡片上展示 `Math.abs()`，方向由 `countdownLabel` / `countdownIsPast` 说清楚。
   *
   * 时光中心列表里每一行的天数也走它——列表与首页卡片的天数必须是同一个算法，
   * 同一套日期在设置页显示 12 天、在首页显示 11 天是最难解释的一类 bug。
   */
  function daysUntil(date: string): number {
    const target = dateKeyOf(date)
    if (target === null) return 0
    return Math.ceil((target - dayKeyOf(now.value)) / DAY_MS)
  }

  /** 距 Hero 那一项的天数 */
  const countdownDays = computed(() => daysUntil(heroCountdown.value.date))

  /** 目标日已经过去（卡片角标据此换「已过」口径） */
  const countdownIsPast = computed(() => countdownDays.value < 0)

  /** 卡片上展示的天数（绝对值——方向由文案说，不由负号说） */
  const countdownMagnitude = computed(() => Math.abs(countdownDays.value))

  /**
   * 卡片上那一行：**名称取所选倒计时自己的名字**（v3.1.0 起不再有单独的 `heroTitle`，
   * 那样同一行字会有两个来源），日期与「已过几天」照原样说全。
   */
  const countdownTitle = computed(() => heroCountdown.value.name)

  /** 卡片右上角的角标，如「期末 2027-01-24」/「出发 已过 12 天」 */
  const countdownLabel = computed(() => {
    const { short, date } = heroCountdown.value
    if (countdownIsPast.value) return `${short} 已过 ${countdownMagnitude.value} 天`
    return `${short} ${date}`
  })

  /**
   * 进度条：**始终是学期进度（开学 → 期末）**，不跟着倒计时目标走。
   *
   * 「我的 → 工作时光」那张卡片的进度条读的也是这个值，两处必须同口径；
   * 而倒计时目标可以指向「支教开始」这种学期之外的日期，用它当分母会算出
   * 一根永远满格（或永远 0）的假进度条。天数看目标、进度看学期，各说各的事实。
   */
  const countdownProgress = computed(() => termProgress.value)

  /* ---------- 教学设置（v3.3.0：课程时间 + 座位图默认视角） ---------- */

  const teaching = computed<TeachingSettings>(() => settings.value.teaching)

  /** 打开座位表时用的视角（教师仍可在座位页临时切换，那次切换不写盘） */
  const seatDefaultView = computed<SeatView>(() => teaching.value.seatDefaultView)

  /**
   * **生效的时段表**：默认作息 + 教学设置里的覆盖。
   *
   * 课程表页面、首页今日课程、编辑抽屉的时段下拉、「当前 / 下一节课」状态机
   * 全部读它——这是「到底几点上下课」的唯一出口（见 `utils/timetable.ts#resolvePeriods`）。
   */
  const periods = computed<CoursePeriod[]>(() => resolvePeriods(teaching.value.periodTimes))

  /** 自定义过的时段数（设置页显示「已改 N 节 / 使用默认作息」） */
  const periodOverrideCount = computed(() => countPeriodOverrides(teaching.value.periodTimes))

  /** 改一节的时间；返回 false 表示没改（时段 id 不认、或时间形状不合法） */
  function updatePeriodTime(id: CoursePeriodId, patch: Partial<PeriodTime>): boolean {
    const current = periods.value.find((period) => period.id === id)
    if (!current) return false
    const start = patch.start ?? current.startTime
    const end = patch.end ?? current.endTime
    // 三道闸：形状 → 先后 → 与其余时段不重叠。最后一关最要紧——
    // 两节时间相交时，同一时刻会有两节课同时「正在进行」，Hero 只会显示排在前面的那节。
    if (!TIME_PATTERN.test(start) || !TIME_PATTERN.test(end) || start >= end) return false
    const overlaps = periods.value.some(
      (period) => period.id !== id && start < period.endTime && period.startTime < end,
    )
    if (overlaps) return false
    update({
      teaching: {
        ...teaching.value,
        periodTimes: { ...teaching.value.periodTimes, [id]: { start, end } },
      },
    })
    return true
  }

  /** 全部时段恢复默认作息（清空覆盖，不是把默认值逐个写进盘） */
  function resetPeriodTimes(): void {
    update({ teaching: { ...teaching.value, periodTimes: {} } })
  }

  /** 设默认视角；写盘后下次打开座位页即生效（当前这次不强制跳转视角） */
  function setSeatDefaultView(view: SeatView): void {
    update({ teaching: { ...teaching.value, seatDefaultView: view } })
  }

  /* ---------- 写入 ---------- */

  /**
   * 更新设置（整对象替换 = 一次写盘 + 一次广播）。
   * 传进来的字段经仓储的 normalize 兜一遍：非法日期不会写进盘。
   */
  function update(patch: Partial<AppSettings>): void {
    settingsList.value = [appSettingsRepository.normalize({ ...settings.value, ...patch })]
  }

  /** 更新时光中心（只动时间这一块，外观字段原样带过去） */
  function updateTimeCenter(patch: Partial<TimeCenter>): void {
    update({ timeCenter: { ...timeCenter.value, ...patch } })
  }

  /**
   * 新建一项自定义倒计时，并**直接设为首页显示**——教师刚填完一个倒计时，
   * 想看到的多半就是它出现在首页上；不想要的话，列表里改一下单选即可。
   */
  function addCountdown(name: string, date: string): CustomCountdown | null {
    const trimmed = name.trim()
    // 名称与日期缺一不可：仓储会把不合法的整项丢掉，先在这里拦下并给页面一个明确的失败
    if (!trimmed || !DATE_PATTERN.test(date)) return null
    const entry = makeCustomCountdown(trimmed, date)
    updateTimeCenter({
      countdowns: [...timeCenter.value.countdowns, entry],
      heroCountdownId: entry.id,
    })
    return entry
  }

  /** 改一项自定义倒计时的名称 / 日期；内置项不可改（返回 false，页面据此提示） */
  function updateCountdown(id: string, patch: { name?: string; date?: string }): boolean {
    if (isBuiltinCountdown(id)) return false
    const next = timeCenter.value.countdowns.map((item) => {
      if (item.id !== id) return item
      return {
        ...item,
        name: patch.name !== undefined ? patch.name.trim() : item.name,
        date: patch.date !== undefined ? patch.date : item.date,
      }
    })
    updateTimeCenter({ countdowns: next })
    return true
  }

  /**
   * 删一项自定义倒计时。内置项不可删（返回 false）。
   *
   * **删掉的正好是首页那一项时，把首页显示拉回内置默认**——不能留一个悬空的 id：
   * 首页倒计时卡会变成空白。仓储的 normalize 也会兜这一手，这里显式做一遍是为了
   * 让同一次写入就落定，不依赖下游的第二道检查。
   */
  function removeCountdown(id: string): boolean {
    if (isBuiltinCountdown(id)) return false
    const next = timeCenter.value.countdowns.filter((item) => item.id !== id)
    if (next.length === timeCenter.value.countdowns.length) return false
    updateTimeCenter({
      countdowns: next,
      ...(timeCenter.value.heroCountdownId === id
        ? { heroCountdownId: DEFAULT_APP_SETTINGS.timeCenter.heroCountdownId }
        : {}),
    })
    return true
  }

  /** 把某一项设为「首页显示」（内置、自定义都可以） */
  function setHeroCountdown(id: string): boolean {
    if (!countdownEntries.value.some((item) => item.id === id)) return false
    updateTimeCenter({ heroCountdownId: id })
    return true
  }

  return {
    settings,
    timeCenter,
    update,
    updateTimeCenter,
    daysWorked,
    semesterTotalDays,
    termProgress,
    termDaysRemaining,
    termIsOver,
    countdownEntries,
    heroCountdown,
    daysUntil,
    countdownTitle,
    countdownDays,
    countdownIsPast,
    countdownMagnitude,
    countdownLabel,
    countdownProgress,
    addCountdown,
    updateCountdown,
    removeCountdown,
    setHeroCountdown,
    teaching,
    seatDefaultView,
    periods,
    periodOverrideCount,
    updatePeriodTime,
    resetPeriodTimes,
    setSeatDefaultView,
  }
})
