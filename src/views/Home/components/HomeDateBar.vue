<script setup lang="ts">
import { computed } from 'vue'

import { useToday } from '@/composables/useToday'
import { formatDateOnly, formatWeekdayLabel } from '@/utils/date'
import { getLunarText } from '@/utils/lunar'

/**
 * 日期栏（V1.3.1，首页1.1.html Apple 锁屏风）：
 * 大号日期 + 星期，右侧时间胶囊 + 农历。全部由共享时钟（30s）驱动，跨零点自动翻篇。
 */
const { now } = useToday()

const dateLabel = computed(() => formatDateOnly(now.value))
const weekdayLabel = computed(() => formatWeekdayLabel(now.value))
const timeLabel = computed(() => {
  const d = now.value
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
})
const lunarLabel = computed(() =>
  getLunarText(now.value.getFullYear(), now.value.getMonth() + 1, now.value.getDate()),
)
</script>

<template>
  <div class="date-bar">
    <div class="date-bar__main">
      <span class="date-bar__date">{{ dateLabel }}</span>
      <span class="date-bar__weekday">{{ weekdayLabel }}</span>
    </div>
    <div class="date-bar__side">
      <span class="date-bar__time">{{ timeLabel }}</span>
      <span class="date-bar__divider" aria-hidden="true">|</span>
      <span class="date-bar__lunar">农历{{ lunarLabel }}</span>
    </div>
  </div>
</template>

<style scoped>
/* Apple 锁屏极简风：独立日期时间区域 + 底部细线（首页1.1.html home__date-bar 同源） */
.date-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
  padding: 0 4px var(--space-3);
  border-bottom: 1px solid var(--color-border);
}

.date-bar__main {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.date-bar__date {
  font-size: var(--font-page-title);
  line-height: var(--leading-tight);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
  letter-spacing: -0.01em;
}

.date-bar__weekday {
  font-size: var(--font-section-title);
  color: var(--color-text-secondary);
  font-weight: var(--font-weight-medium);
}

.date-bar__side {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.date-bar__time {
  font-size: 20px;
  color: var(--color-text-primary);
  font-weight: var(--font-weight-semibold);
  padding: 4px 14px;
  border-radius: var(--radius-full);
  background: rgba(15, 23, 42, 0.04);
  font-variant-numeric: tabular-nums;
}

.date-bar__divider {
  color: var(--color-text-tertiary);
}

.date-bar__lunar {
  font-size: var(--font-secondary);
  color: var(--color-text-secondary);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
}
</style>
