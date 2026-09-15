<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { CalendarClock, Trash2 } from 'lucide-vue-next'

import { AppButton, AppModal, AppSegmented } from '@/components/ui'
import { runLockedOperation } from '@/composables/useOperationLock'
import { useToast } from '@/composables/useToast'
import { useAppSettingsStore } from '@/stores/appSettings'
import { useTimetableStore } from '@/stores/timetable'
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
 *
 * **v3.3.1 新增「删除所有课程」**：课表整表清空（含换课记录），作息不动。
 * 破坏性操作，红色危险行 + 二次确认弹窗，写入走长事务锁（同导入纪律）。
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

/* ---------- v3.3.1：删除所有课程（危险操作，二次确认） ---------- */

const timetableStore = useTimetableStore()
const clearOpen = ref(false)

/** 待删除的课程条数（打开确认弹窗时固定，弹窗内不再变） */
const clearCount = ref(0)

function askClear(): void {
  clearCount.value = timetableStore.lessons.length
  clearOpen.value = true
}

/**
 * 清空课表。与导入同一纪律：**危险批量写走长事务锁**
 * （写入期间自动同步只记账不推送，写完补一次冲刷），
 * 否则清空后的空课表可能与云端的旧课表来回打架。
 */
async function confirmClear(): Promise<void> {
  clearOpen.value = false
  const removed = await runLockedOperation('course-clear', () => timetableStore.clearLessons())
  if (removed === 0) {
    toast.info('课程表本来就是空的')
    return
  }
  toast.success(`已删除全部 ${removed} 节课，课程时间设置保持不变`)
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
      <!--
        v3.3.1：清空课表。放在「课程」组里、紧跟课程时间设置——两者的区别
        （清课 vs 改作息）在副标题与确认弹窗里各说一遍，避免教师以为删课会连作息一起没。
      -->
      <SettingsCell
        :icon="Trash2"
        icon-tone="danger"
        danger
        title="删除所有课程"
        :subtitle="`清空课程表中的全部课程（当前 ${timetableStore.lessons.length} 节），保留课程时间设置`"
        @click="askClear"
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

    <!-- 二次确认：文案与需求一致（说清删什么、什么不受影响、不可撤销） -->
    <AppModal v-model="clearOpen" title="删除所有课程" :width="400">
      <p class="danger-text">将删除课程表中的全部课程，此操作不可撤销。</p>
      <p class="danger-note">
        本次将删除 <strong>{{ clearCount }}</strong> 节课（含换课记录）。 课程时间设置（{{
          appSettings.periods.length
        }}
        个时段）不受影响，删除后仍按现用作息排列。
      </p>
      <template #footer>
        <AppButton variant="ghost" @click="clearOpen = false">取消</AppButton>
        <AppButton variant="danger" @click="confirmClear">删除所有课程</AppButton>
      </template>
    </AppModal>
  </SettingsPage>
</template>

<style scoped>
.danger-text {
  font-size: var(--font-content);
  color: var(--color-text-primary);
  line-height: 1.6;
}

.danger-note {
  margin-top: var(--space-2);
  font-size: var(--font-secondary);
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.danger-note strong {
  color: var(--color-danger-strong);
  font-variant-numeric: tabular-nums;
}
</style>
