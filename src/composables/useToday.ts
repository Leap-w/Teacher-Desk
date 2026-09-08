import { onBeforeUnmount, computed, ref } from 'vue'

import { formatDateLabel, greetingByHour } from '@/utils/date'

/** 当天日期与问候语的响应式封装，每 30 秒刷新一次 */
export function useToday() {
  const now = ref(new Date())

  const timer = window.setInterval(() => {
    now.value = new Date()
  }, 30_000)
  onBeforeUnmount(() => {
    window.clearInterval(timer)
  })

  const todayLabel = computed(() => formatDateLabel(now.value))
  const greeting = computed(() => greetingByHour(now.value))

  return { now, todayLabel, greeting }
}
