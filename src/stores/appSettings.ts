import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { useNow } from '@/composables/useToday'
import {
  appSettingsRepository,
  DEFAULT_APP_SETTINGS,
} from '@/repositories/settings/appSettingsRepository'
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
  }
})
