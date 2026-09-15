<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { CalendarClock } from 'lucide-vue-next'

import { AppSegmented } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useAppSettingsStore } from '@/stores/appSettings'
import { DEFAULT_CLASSROOM_CONFIG } from '@/types/classroom'
import type { SeatView } from '@/types/seat'
import SettingsPage from '../components/SettingsPage.vue'
import SettingsSection from '../components/SettingsSection.vue'
import SettingsCell from '../components/SettingsCell.vue'
import SettingsField from '../components/SettingsField.vue'

/**
 * 教学设置（v3.0.4-rc · **v3.3.0 两项全部接上真功能**）。
 *
 * v3.0.4-rc 到 v3.2.0 之间这两行都是**假按钮**：点了只弹「这个设置还在开发中，敬请期待」，
 * 其中「课程时间设置」还挂着「固定」徽标——文案本身就在说「这里改不了」。
 * v3.3.0 按「不要保留假按钮，每个设置都要真正驱动对应页面」补齐：
 *
 * - **课程时间设置** → 进 `/my/settings/teaching/periods` 逐节改上下课时间，
 *   存 `teaching.periodTimes`；课程表行头、首页今日课程、「当前 / 下一节课」判定同步变。
 * - **座位图默认视角** → 就在本页就地切换，存 `teaching.seatDefaultView`；
 *   下次打开座位表按它开局（教师当场仍可在座位页临时切，那次切换不写盘）。
 *
 * 两行都**不再有徽标**：徽标是「这项还不能用」的标记，现在没有需要标记的了。
 */
const appSettings = useAppSettingsStore()
const router = useRouter()
const toast = useToast()

/** 生效作息的一句话摘要：节数 + 首课时间，改过几节一并说清 */
const courseTimeValue = computed(() => {
  const periods = appSettings.periods
  const first = periods[0]
  if (!first) return '暂无时间段'
  const changed = appSettings.periodOverrideCount
  const head = `${periods.length} 个时间段 · ${first.startTime} 首课`
  return changed > 0 ? `${head} · 已改 ${changed} 节` : `${head}（默认作息）`
})

const seatLayoutValue = computed(
  () =>
    `${DEFAULT_CLASSROOM_CONFIG.rows} 排 × ${DEFAULT_CLASSROOM_CONFIG.cols} 列 · ${DEFAULT_CLASSROOM_CONFIG.blocks.length} 区`,
)

const VIEW_OPTIONS: { value: SeatView; label: string }[] = [
  { value: 'teacher', label: '老师视角' },
  { value: 'student', label: '学生视角' },
]

/** 就地切换默认视角：写盘即生效，提示说清「下次打开」而不是让教师以为当前页会跳 */
function setView(view: SeatView): void {
  if (view === appSettings.seatDefaultView) return
  appSettings.setSeatDefaultView(view)
  const label = VIEW_OPTIONS.find((item) => item.value === view)?.label ?? ''
  toast.success(`默认视角已设为${label}，下次打开座位表生效`)
}
</script>

<template>
  <SettingsPage title="教学设置" subtitle="课表与座位图的默认口径">
    <SettingsSection title="课程">
      <SettingsCell
        :icon="CalendarClock"
        title="课程时间设置"
        :subtitle="`${courseTimeValue} · 点击逐节调整`"
        @click="router.push('/my/settings/teaching/periods')"
      />
    </SettingsSection>

    <SettingsSection title="座位">
      <SettingsField
        label="座位图默认视角"
        :hint="`教室布局 ${seatLayoutValue}。决定打开座位表时先用哪个视角；在座位页里临时切换不会改这里。`"
      >
        <template #control>
          <AppSegmented
            :options="VIEW_OPTIONS"
            :model-value="appSettings.seatDefaultView"
            label="座位图默认视角"
            @update:model-value="setView"
          />
        </template>
      </SettingsField>
    </SettingsSection>
  </SettingsPage>
</template>
