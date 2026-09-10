import { computed, ref } from 'vue'
import type { Ref } from 'vue'

import { formatDateLabel, greetingByHour } from '@/utils/date'

/**
 * 全应用共享的「当前时间」：**只启一个 30 秒定时器**（Phase 5 起）。
 * 工作台头部、今日课程、周课表「今天」高亮等都读同一个 ref ——
 * 不会出现两处时钟各走各的、跨零点后日期与课程对不上的情况（开发手册 §8 记录项 ②）。
 *
 * 时钟**首次被用到时**才创建（不是模块加载时）：没有使用方就不起定时器，
 * 也避免模块求值那一刻的时间被一直沿用。
 */
let now: Ref<Date> | undefined

function ensureClock(): Ref<Date> {
  if (now) return now
  const created = ref(new Date())
  now = created
  window.setInterval(() => {
    created.value = new Date()
  }, 30_000)
  return created
}

/** 共享的当前时间（响应式，30 秒刷新一次） */
export function useNow(): Ref<Date> {
  return ensureClock()
}

/**
 * 当天日期与问候语的响应式封装（30 秒刷新，跨零点自动翻篇）。
 * 数据源与 `useNow` 同一个 ref。
 */
export function useToday() {
  const current = useNow()

  const todayLabel = computed(() => formatDateLabel(current.value))
  const greeting = computed(() => greetingByHour(current.value))

  return { now: current, todayLabel, greeting }
}
