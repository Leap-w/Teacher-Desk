<script setup lang="ts">
import { computed } from 'vue'
import { DocumentTextOutline, SchoolOutline } from '@vicons/ionicons5'

import { AppCard, EmptyState } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useDashboardStore } from '@/stores/dashboard'
import { useTimetableStore } from '@/stores/timetable'
import DashboardHeader from './components/DashboardHeader.vue'
import DashboardLessonCard from './components/DashboardLessonCard.vue'
import DashboardLessonStats from './components/DashboardLessonStats.vue'
import DashboardQuickLinks from './components/DashboardQuickLinks.vue'
import DashboardTodoCard from './components/DashboardTodoCard.vue'
import type { DashboardCard } from '@/types'

const toast = useToast()
const dashboardStore = useDashboardStore()
const timetableStore = useTimetableStore()

/**
 * 「今天」由 timetable store 经**共享时钟**解析（Phase 5 起，全应用一个 30 秒定时器）：
 * 今日课程、星期标签、头部日期同源，跨零点一起翻篇，不会互相错开一天。
 */
const isWeekend = computed(() => timetableStore.todayWeekday >= 6)

function toggleTodo(id: string): void {
  if (!dashboardStore.toggle(id)) toast.warning('待办状态更新失败，请刷新后重试')
}

/** 尚未实现的两张占位卡片（Phase 4 保留，点击不跳转） */
const plannedCards: DashboardCard[] = [
  {
    key: 'leave',
    title: '请假审批',
    icon: DocumentTextOutline,
    description: '学生请假申请提交后，可在此快速查看与审批。',
  },
  {
    key: 'class',
    title: '班级概况',
    icon: SchoolOutline,
    description: '班级人数、出勤与值日等概览信息将汇总于此。',
  },
]
</script>

<template>
  <div class="dash-page">
    <DashboardHeader />

    <div class="dash-grid">
      <DashboardLessonCard
        :lessons="timetableStore.todayLessons"
        :weekday-label="timetableStore.todayLabel"
        :weekend="isWeekend"
      />

      <DashboardTodoCard :todos="dashboardStore.todos" @toggle="toggleTodo" />

      <DashboardQuickLinks class="cell-links" />

      <div class="cell-bottom">
        <DashboardLessonStats :count="timetableStore.weekLessonCount" />

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
