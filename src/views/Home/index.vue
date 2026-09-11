<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { SchoolOutline } from '@vicons/ionicons5'

import { AppCard, EmptyState } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useDashboardStore } from '@/stores/dashboard'
import { useDutyStore } from '@/stores/duty'
import { useLeaveStore } from '@/stores/leave'
import { useTimetableStore } from '@/stores/timetable'
import DashboardBackupNotice from './components/DashboardBackupNotice.vue'
import DashboardDutyCard from './components/DashboardDutyCard.vue'
import DashboardHeader from './components/DashboardHeader.vue'
import DashboardLeaveCard from './components/DashboardLeaveCard.vue'
import DashboardLessonCard from './components/DashboardLessonCard.vue'
import DashboardLessonStats from './components/DashboardLessonStats.vue'
import DashboardQuickLinks from './components/DashboardQuickLinks.vue'
import DashboardTodoCard from './components/DashboardTodoCard.vue'
import type { DashboardCard } from '@/types'

const toast = useToast()
const router = useRouter()
const dashboardStore = useDashboardStore()
const dutyStore = useDutyStore()
const leaveStore = useLeaveStore()
const timetableStore = useTimetableStore()

/**
 * 「今天」由 timetable store 经**共享时钟**解析（Phase 5 起，全应用一个 30 秒定时器）：
 * 今日课程、星期标签、头部日期同源，跨零点一起翻篇，不会互相错开一天。
 */
const isWeekend = computed(() => timetableStore.todayWeekday >= 6)

/**
 * 今日值日卡片：今天不值日（周末不排）与「还没有组」要分开说，别让教师以为排班丢了。
 * 一个组都没有时不算「周末不排」——那是「还没建组」，两者混着说会自相矛盾。
 */
const dutyWeekendSkipped = computed(
  () => dutyStore.groups.length > 0 && isWeekend.value && !dutyStore.settings.includeWeekend,
)

/** 有组但没设起点日期（轮换没有基准）：卡片要说「去设置起点」，不是「去建组」 */
const dutyNeedsSetup = computed(() => dutyStore.groups.length > 0 && !dutyStore.settings.startDate)

const dutyMembers = computed(() =>
  dutyStore.todayGroup ? dutyStore.membersOf(dutyStore.todayGroup) : [],
)

function toggleTodo(id: string): void {
  if (!dashboardStore.toggle(id)) toast.warning('待办状态更新失败，请刷新后重试')
}

/** 尚未实现的占位卡片（点击不跳转）：请假审批已在 Phase 5 转为真实卡片 */
const plannedCards: DashboardCard[] = [
  {
    key: 'class',
    title: '班级概况',
    icon: SchoolOutline,
    description: '班级人数、出勤等概览信息将汇总于此。',
  },
]
</script>

<template>
  <div class="dash-page">
    <DashboardBackupNotice />

    <DashboardHeader />

    <div class="dash-grid">
      <DashboardLessonCard
        :lessons="timetableStore.todayLessons"
        :weekday-label="timetableStore.todayLabel"
        :weekend="isWeekend"
      />

      <DashboardTodoCard :todos="dashboardStore.todos" @toggle="toggleTodo" />

      <DashboardDutyCard
        class="cell-duty"
        :group="dutyStore.todayGroup"
        :members="dutyMembers"
        :weekday-label="timetableStore.todayLabel"
        :weekend-skipped="dutyWeekendSkipped"
        :needs-setup="dutyNeedsSetup"
        :upcoming="dutyStore.upcomingDays"
        :today-key="dutyStore.todayKey"
        @open="router.push('/duty')"
      />

      <DashboardQuickLinks class="cell-links" />

      <div class="cell-bottom">
        <DashboardLessonStats :count="timetableStore.weekLessonCount" />

        <DashboardLeaveCard
          :pending="leaveStore.pendingLeaves"
          :month-count="leaveStore.monthLeaveCount"
          @open="router.push('/leave')"
        />

        <AppCard v-for="card in plannedCards" :key="card.key" :title="card.title">
          <template #actions>
            <span class="card-chip" aria-hidden="true">
              <component :is="card.icon" />
            </span>
          </template>
          <EmptyState icon="🚧" title="功能建设中" :description="card.description" />
        </AppCard>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dash-page {
  max-width: 960px;
  margin: 0 auto;
}

.dash-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-4);
}

/* 同一行的卡片等高（卡片自身撑满所在网格单元） */
.dash-grid > *,
.cell-bottom > * {
  height: 100%;
}

.cell-bottom {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-4);
}

@media (min-width: 760px) {
  .dash-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .cell-duty,
  .cell-links,
  .cell-bottom {
    grid-column: 1 / -1;
  }

  .cell-bottom {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.card-chip {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
}

.card-chip :deep(svg) {
  width: 18px;
  height: 18px;
}
</style>
