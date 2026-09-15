import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { useNow } from '@/composables/useToday'
import {
  appSettingsRepository,
  DEFAULT_APP_SETTINGS,
} from '@/repositories/settings/appSettingsRepository'
import { COUNTDOWN_TARGETS } from '@/types/appSettings'
import type { AppSettings } from '@/types/appSettings'

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
 * 应用设置（v3.0.4-rc）——**首页 Hero 与「我的 → 工作时光」的唯一数据源**。
 *
 * 这一层回答三个问题，全部由同一份设置派生（时间取自 `useNow()` 的共享时钟，
 * 30 秒刷新一次、跨零点自动翻篇）：
 * - **工作天数**（支教）：`serviceStart` → 今天，含首日（「第 X 天」）
 * - **学期进度**：`semesterStart` → `semesterEnd` 的百分比
 * - **学期倒计时**：今天 → `semesterEnd` 的剩余天数
 *
 * 派生值不进盘（改日期即重算），写入只经 `update()`——一次写盘 + 一次广播，
 * 与其余 store 同一套持久化纪律（Repository First + syncPersisted）。
 */
export const useAppSettingsStore = defineStore('appSettings', () => {
  /** 持久化形状是**单元素数组**（对齐备份模块「一个键 = 一个数组」的硬约束） */
  const settingsList = ref<AppSettings[]>([appSettingsRepository.readSettings()])

  appSettingsRepository.bind(settingsList)

  const settings = computed<AppSettings>(() => settingsList.value[0] ?? { ...DEFAULT_APP_SETTINGS })

  const now = useNow()

  /** 工作天数：支教第 X 天（含首日，未到开始日则显示 1） */
  const daysWorked = computed(() => {
    const start = dateKeyOf(settings.value.serviceStart)
    if (start === null) return 1
    return Math.max(1, Math.floor((dayKeyOf(now.value) - start) / DAY_MS) + 1)
  })

  /** 学期总天数（两端都算，最小 1 天——避免除零） */
  const semesterTotalDays = computed(() => {
    const start = dateKeyOf(settings.value.semesterStart)
    const end = dateKeyOf(settings.value.semesterEnd)
    if (start === null || end === null) return 1
    return Math.max(1, Math.round((end - start) / DAY_MS))
  })

  /** 学期进度（0–100，越界收敛；终点已过即 100） */
  const termProgress = computed(() => {
    const start = dateKeyOf(settings.value.semesterStart)
    const end = dateKeyOf(settings.value.semesterEnd)
    if (start === null || end === null) return 0
    const total = end - start
    if (total <= 0) return 100
    const passed = Math.min(Math.max(dayKeyOf(now.value) - start, 0), total)
    return Math.round((passed / total) * 100)
  })

  /** 学期倒计时：距期末还有几天（今天算还没结束的一天；已过为 0） */
  const termDaysRemaining = computed(() => {
    const end = dateKeyOf(settings.value.semesterEnd)
    if (end === null) return 0
    return Math.max(0, Math.ceil((end - dayKeyOf(now.value)) / DAY_MS))
  })

  /** 学期是否已结束（Hero 倒计时卡据此换文案） */
  const termIsOver = computed(() => termDaysRemaining.value <= 0)

  /* ---------- 倒计时目标（v3.0.5-rc：Hero 卡片倒数到哪一天） ---------- */

  /**
   * 选中的倒计时目标选项（盘上的值认不出时回第一项，与仓储的兜底同一口径）。
   * `value` 与日期字段同名，故取日期直接 `settings[value]`。
   */
  const countdownTarget = computed(
    () =>
      COUNTDOWN_TARGETS.find((item) => item.value === settings.value.countdownTarget) ??
      COUNTDOWN_TARGETS[0]!,
  )

  /** 目标日期（`YYYY-MM-DD`） */
  const countdownDate = computed<string>(() => settings.value[settings.value.countdownTarget])

  /**
   * 距目标的天数：**正数 = 还剩几天，0 = 就是今天，负数 = 已经过了几天**。
   *
   * 用**有符号**而不是像学期倒计时那样收敛到 0：目标可能落在过去（选了「支教开始日期」
   * 而它早已过去），把负数压成 0 只会显示成「还剩 0 天」，教师看不出是没开始还是早过了。
   * 卡片上展示 `Math.abs()`，方向由 `countdownLabel` / `countdownIsPast` 说清楚。
   */
  const countdownDays = computed(() => {
    const target = dateKeyOf(countdownDate.value)
    if (target === null) return 0
    return Math.ceil((target - dayKeyOf(now.value)) / DAY_MS)
  })

  /** 目标日已经过去（卡片角标据此换「已过」口径） */
  const countdownIsPast = computed(() => countdownDays.value < 0)

  /** 卡片上展示的天数（绝对值——方向由文案说，不由负号说） */
  const countdownMagnitude = computed(() => Math.abs(countdownDays.value))

  /**
   * 卡片右上角的角标，如「期末 2027-01-24」/「出发 已过 12 天」。
   * 日期照原样给出（教师自己填的，看得懂），已过则把话说全。
   */
  const countdownLabel = computed(() => {
    const { short } = countdownTarget.value
    if (countdownIsPast.value) return `${short} 已过 ${countdownMagnitude.value} 天`
    return `${short} ${countdownDate.value}`
  })

  /**
   * 进度条：**始终是学期进度（开学 → 期末）**，不跟着倒计时目标走。
   *
   * 「我的 → 工作时光」那张卡片的进度条读的也是这个值，两处必须同口径；
   * 而倒计时目标可以指向「支教开始」这种学期之外的日期，用它当分母会算出
   * 一根永远满格（或永远 0）的假进度条。天数看目标、进度看学期，各说各的事实。
   */
  const countdownProgress = computed(() => termProgress.value)

  /**
   * 更新设置（整对象替换 = 一次写盘 + 一次广播）。
   * 传进来的字段经仓储的 normalize 兜一遍：非法日期不会写进盘。
   */
  function update(patch: Partial<AppSettings>): void {
    settingsList.value = [appSettingsRepository.normalize({ ...settings.value, ...patch })]
  }

  return {
    settings,
    update,
    daysWorked,
    semesterTotalDays,
    termProgress,
    termDaysRemaining,
    termIsOver,
    countdownTarget,
    countdownDate,
    countdownDays,
    countdownIsPast,
    countdownMagnitude,
    countdownLabel,
    countdownProgress,
  }
})
