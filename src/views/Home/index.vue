<script setup lang="ts">
import { AppCard, EmptyState } from '@/components/ui'
import { useToday } from '@/composables/useToday'
import type { DashboardCard } from '@/types'

const { greeting, todayLabel } = useToday()

const dashboardCards: DashboardCard[] = [
  {
    key: 'schedule',
    title: '今日课程',
    icon: '📚',
    description: '课程表配置完成后，这里将展示今天的课程与时段安排。',
  },
  {
    key: 'todo',
    title: '待办事项',
    icon: '✅',
    description: '记录班级事务与个人待办，重要事项不再遗漏。',
  },
  {
    key: 'leave',
    title: '请假审批',
    icon: '📨',
    description: '学生请假申请提交后，可在此快速查看与审批。',
  },
  {
    key: 'class',
    title: '班级概况',
    icon: '🏫',
    description: '班级人数、出勤与值日等概览信息将汇总于此。',
  },
]
</script>

<template>
  <div class="home-page">
    <section class="mb-6">
      <h1 class="welcome-title">{{ greeting }}，班主任</h1>
      <p class="welcome-date">{{ todayLabel }} · 一切井然有序</p>
    </section>

    <section class="grid gap-4 grid-cols-[repeat(auto-fit,minmax(250px,1fr))]">
      <AppCard v-for="card in dashboardCards" :key="card.key" :title="card.title">
        <template #actions>
          <span class="card-chip" aria-hidden="true">{{ card.icon }}</span>
        </template>
        <EmptyState icon="🚧" title="功能建设中" :description="card.description" />
      </AppCard>
    </section>
  </div>
</template>

<style scoped>
.home-page {
  max-width: 1200px;
}

.welcome-title {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.4px;
}

.welcome-date {
  margin-top: 6px;
  font-size: 14px;
  color: var(--color-text-secondary);
}

.card-chip {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: var(--color-primary-soft);
  font-size: 16px;
}
</style>
