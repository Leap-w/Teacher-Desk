<script setup lang="ts">
import { computed } from 'vue'
import { RotateCcw } from 'lucide-vue-next'

import { AppButton, AppInput } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useAppSettingsStore } from '@/stores/appSettings'
import type { CoursePeriod } from '@/types/timetable'
import SettingsPage from '../components/SettingsPage.vue'
import SettingsSection from '../components/SettingsSection.vue'
import SettingsField from '../components/SettingsField.vue'

/**
 * 课程时间（v3.3.0 建页）——**把教学设置里那个只弹提示的假按钮补成真功能**。
 *
 * 改的是「几点上下课」，落盘在 `teacherdesk:settings` 的 `teaching.periodTimes`，
 * 生效范围是**全应用**：课程表周视图的行头、首页今日课程的时间与「当前 / 下一节」、
 * 编辑抽屉的时段下拉，全部读 store 的 `periods`（= 默认作息 + 这里的覆盖）。
 *
 * 三条口径：
 * ① **只能改时间**。`id / label / order / group` 是课表骨架（导入模板、换课约束、
 *    晚自习整组规则都挂在上面），改它们等于换一套时段模型，不在设置范围内。
 * ② **只存改过的节**。没动的节不写盘——存整份会让「学校改了作息、应用升级带了新默认值」
 *    永远生效不了（盘上的旧拷贝会把新默认值整体盖住）。
 * ③ **时间不许重叠**。两节相交时同一时刻会有两节课同时「正在进行」，
 *    首页只会显示排在前面的那节，另一节静默消失。校验在 store 里，这里只把原因说清楚。
 */
const appSettings = useAppSettingsStore()
const toast = useToast()

const periods = computed<CoursePeriod[]>(() => appSettings.periods)
const overridden = computed(() => appSettings.periodOverrideCount)

/** 某一节是否被改过（行上打个「已改」小标，教师一眼看得出改过哪几节） */
function isOverridden(period: CoursePeriod): boolean {
  return Boolean(appSettings.teaching.periodTimes[period.id])
}

/**
 * 改一节的时间。**不拦输入、只拦结果**：控件是 `:model-value` 绑定的，
 * 校验没过时 store 不写盘、输入框自然弹回原值，教师看到的是「这句时间没被接受」。
 */
function change(period: CoursePeriod, patch: { start?: string; end?: string }): void {
  const start = patch.start ?? period.startTime
  const end = patch.end ?? period.endTime
  if (start === period.startTime && end === period.endTime) return
  if (appSettings.updatePeriodTime(period.id, patch)) return

  // 失败原因分三种，别说成一句含糊的「设置失败」——教师得知道该改哪里
  if (end <= start) {
    toast.danger(`${period.label}：下课时间要晚于上课时间`)
    return
  }
  const clash = periods.value.find(
    (item) => item.id !== period.id && start < item.endTime && item.startTime < end,
  )
  toast.danger(
    clash
      ? `${period.label}与「${clash.label}」时间重叠，请先让开一段`
      : '时间格式不对，请重新选择',
  )
}

function resetAll(): void {
  if (overridden.value === 0) {
    toast.info('当前就是默认作息，没有需要恢复的改动')
    return
  }
  appSettings.resetPeriodTimes()
  toast.success('已恢复默认作息')
}
</script>

<template>
  <SettingsPage title="课程时间" subtitle="上下课时间改这里，课程表与首页今日课程同步生效">
    <SettingsSection title="作息时间">
      <SettingsField
        v-for="period in periods"
        :key="period.id"
        :label="period.label"
        :hint="isOverridden(period) ? '已按你的设置调整（与默认作息不同）' : undefined"
      >
        <template #control>
          <div class="time-pair">
            <AppInput
              type="time"
              :model-value="period.startTime"
              :aria-label="`${period.label}上课时间`"
              @update:model-value="change(period, { start: String($event) })"
            />
            <span class="time-sep" aria-hidden="true">–</span>
            <AppInput
              type="time"
              :model-value="period.endTime"
              :aria-label="`${period.label}下课时间`"
              @update:model-value="change(period, { end: String($event) })"
            />
          </div>
        </template>
      </SettingsField>
    </SettingsSection>

    <SettingsSection title="默认作息">
      <SettingsField
        label="恢复默认时间"
        hint="把上面十节全部改回应用自带的作息（清空自定义，不是逐节填回默认值）。课程本身的安排不受影响。"
      >
        <template #control>
          <AppButton variant="ghost" size="sm" @click="resetAll">
            <RotateCcw :size="16" :stroke-width="2" aria-hidden="true" />
            恢复默认
          </AppButton>
        </template>
      </SettingsField>
    </SettingsSection>
  </SettingsPage>
</template>

<style scoped>
/* 两个时间输入 + 中间的连接号：同一行的控件不该换行拆散 */
.time-pair {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.time-sep {
  color: var(--color-text-tertiary);
}
</style>
