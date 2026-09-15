<script setup lang="ts">
import { computed } from 'vue'
import { CalendarClock, LayoutGrid } from 'lucide-vue-next'

import { useToast } from '@/composables/useToast'
import { COURSE_PERIODS } from '@/types/timetable'
import { DEFAULT_CLASSROOM_CONFIG } from '@/types/classroom'
import SettingsPage from '../components/SettingsPage.vue'
import SettingsSection from '../components/SettingsSection.vue'
import SettingsCell from '../components/SettingsCell.vue'

/**
 * 教学设置（v3.0.4-rc · 二级页）。
 *
 * 原有「课程表 / 座位」两组设置原样搬进来，**一项未删**：
 * 课程时间设置（当前为固定课表）与座位图默认视角（尚未实现，如实标「开发中」）。
 */
const toast = useToast()

const courseTimeValue = computed(
  () => `${COURSE_PERIODS.length} 个时间段 · ${COURSE_PERIODS[0]!.startTime} 首课`,
)

const seatLayoutValue = computed(
  () =>
    `${DEFAULT_CLASSROOM_CONFIG.rows} 排 × ${DEFAULT_CLASSROOM_CONFIG.cols} 列 · ${DEFAULT_CLASSROOM_CONFIG.blocks.length} 区`,
)

function soon(): void {
  toast.info('这个设置还在开发中，敬请期待')
}
</script>

<template>
  <SettingsPage title="教学设置" subtitle="课表与座位图的默认口径">
    <SettingsSection title="课程">
      <SettingsCell
        :icon="CalendarClock"
        title="课程时间设置"
        :subtitle="`${courseTimeValue}（当前为固定课表）`"
        badge-text="固定"
        @click="soon"
      />
    </SettingsSection>

    <SettingsSection title="座位">
      <SettingsCell
        :icon="LayoutGrid"
        title="座位图默认视角"
        :subtitle="`教室布局 ${seatLayoutValue} · 打开座位表时的视角偏好`"
        badge-text="开发中"
        @click="soon"
      />
    </SettingsSection>
  </SettingsPage>
</template>
