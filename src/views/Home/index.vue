<script setup lang="ts">
import { computed } from 'vue'
import {
  Armchair,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  ListTodo,
  NotebookPen,
  Paintbrush,
  PlaneLanding,
  UsersRound,
} from 'lucide-vue-next'

import ActivityTimeline from '@/components/dashboard/ActivityTimeline.vue'
import DashboardHero from '@/components/dashboard/DashboardHero.vue'
import DashboardSection from '@/components/dashboard/DashboardSection.vue'
import DashboardStatCard from '@/components/dashboard/DashboardStatCard.vue'
import QuickActionGrid, { type QuickAction } from '@/components/dashboard/QuickActionGrid.vue'
import { EmptyState } from '@/components/ui'
import { useNow } from '@/composables/useToday'
import { greetingByHour, formatDateLabel } from '@/utils/date'
import { scheduleNowOf } from '@/utils/scheduleNow'
import { useDashboardStore } from '@/stores/dashboard'
import { useDutyStore } from '@/stores/duty'
import { useLeaveStore } from '@/stores/leave'
import { useTimetableStore } from '@/stores/timetable'
import { useUserStore } from '@/stores/user'
import { useWeekendStore } from '@/stores/weekend'
import { isLeaveToday } from '@/utils/leave'
import DashboardBackupNotice from './components/DashboardBackupNotice.vue'
import NextCourseCard from './components/NextCourseCard.vue'
import SyncHintBar from './components/SyncHintBar.vue'

/**
 * 首页 = 班主任今日工作中心（V2.0.2-alpha · Phase UI-3）：
 * 四层结构——Hero（问候/日期/身份）→ 今日工作（下一节课 + 待办统计 + 班级动态）
 * → 快捷操作四宫格 → 最近活动时间轴。
 * 首页只承担「决策职责」不承担导航职责：今天要什么，第一屏说了算。
 * 数据全部来自既有 Store / 时间源；无数据走 EmptyState，不伪造业务数据。
 */
const dashboardStore = useDashboardStore()
const dutyStore = useDutyStore()
const leaveStore = useLeaveStore()
const timetableStore = useTimetableStore()
const userStore = useUserStore()
const weekendStore = useWeekendStore()
const now = useNow()

const profile = computed(() => userStore.profile)
const className = computed(() => profile.value.className)

/* ---- Layer 1：Hero ---- */
const greeting = computed(() => `${greetingByHour(now.value)}，${profile.value.nickname}`)

const dateLine = computed(
  () => `今天是 ${formatDateLabel(now.value).replace(/(星期[日一二三四五六])$/, ' · $1')}`,
)

const heroBadges = computed(() => [`${className.value} · 班主任`, `${profile.value.subject} 教师`])

/* ---- Layer 2a：下一节课（状态机与课程表共用：utils/scheduleNow.ts） ---- */
const isWeekend = computed(() => timetableStore.todayWeekday >= 6)

const nextCourse = computed(() => {
  const lessons = timetableStore.todayLessons
  if (lessons.length === 0) {
    return {
      state: 'empty' as const,
      emptyHint: isWeekend.value ? '周末不排课，好好休息。' : '课程表里还没有今天的安排。',
    }
  }
  const now2 = scheduleNowOf(lessons, now.value)
  if (now2.state === 'empty' || now2.state === 'done' || !now2.lesson || !now2.period) {
    return { state: 'done' as const }
  }
  const period = now2.period
  return {
    state: now2.state,
    subject: now2.lesson.subject,
    className: now2.lesson.className,
    timeLabel: `${period.shortLabel} · ${period.startTime}-${period.endTime}`,
    minutesLeft: now2.minutesLeft,
  }
})

/* ---- Layer 2b：今日待办统计 ---- */
const todoTotal = computed(() => dashboardStore.todos.length)
const todoDone = computed(() => dashboardStore.todos.filter((t) => t.done).length)
const todoUndone = computed(() => todoTotal.value - todoDone.value)

/* ---- Layer 2c：班级动态（全部真实数据） ---- */
const todayLeaveCount = computed(
  () => leaveStore.leaves.filter((r) => isLeaveToday(r, dutyStore.todayKey)).length,
)

const dutyNeedsSetup = computed(() => dutyStore.groups.length > 0 && !dutyStore.settings.startDate)

const classEvents = computed(() => {
  const events: {
    id: string
    icon: typeof NotebookPen
    tone: 'primary' | 'success' | 'warning' | 'info'
    title: string
    desc?: string
  }[] = []
  if (todayLeaveCount.value > 0) {
    events.push({
      id: 'leave',
      icon: NotebookPen,
      tone: 'warning',
      title: `新请假 · 今日 ${todayLeaveCount.value} 人`,
      desc: '去请假管理查看去向登记',
    })
  }
  if (dutyStore.todayGroup) {
    const members = dutyStore.membersOf(dutyStore.todayGroup)
    events.push({
      id: 'duty',
      icon: Paintbrush,
      tone: 'primary',
      title: `今日值日 · ${dutyStore.todayGroup.name}`,
      desc: members.length > 0 ? members.map((member) => member.name).join(' · ') : '组员待安排',
    })
  } else if (dutyNeedsSetup.value) {
    events.push({
      id: 'duty-setup',
      icon: Paintbrush,
      tone: 'info',
      title: '值日轮换还没设起点',
      desc: '去值日管理设置后开始轮换',
    })
  }
  if (isWeekend.value && weekendStore.currentCount > 0) {
    events.push({
      id: 'weekend',
      icon: PlaneLanding,
      tone: 'success',
      title: `周末返校 · 已登记 ${weekendStore.currentCount} 人`,
      desc: `留校 ${weekendStore.currentStayCount} 人`,
    })
  }
  return events
})

/* ---- Layer 3：快捷操作（固定四项，功能入口降级） ---- */
const quickActions: QuickAction[] = [
  { icon: UsersRound, label: '学生档案', description: '班级名册', to: '/students' },
  { icon: Armchair, label: '座位管理', description: '排座与方案', to: '/class/seats' },
  { icon: NotebookPen, label: '请假管理', description: '请假与去向', to: '/class/leave' },
  { icon: ListTodo, label: '工作清单', description: '今日待办', to: '/work/works' },
]
</script>

<template>
  <div class="home-page">
    <DashboardBackupNotice />

    <!-- ===== Layer 1：Hero ===== -->
    <DashboardHero :greeting="greeting" :date-line="dateLine" :badges="heroBadges" />

    <!-- Cloud-2：同步提示条（只读 SyncState；本地模式与已同步时不显示，无任何按钮） -->
    <div class="sync-row"><SyncHintBar /></div>

    <!-- ===== Layer 2：今日工作（桌面两列：左大卡 + 右统计/动态） ===== -->
    <div class="today-grid">
      <DashboardSection
        title="下一节课"
        subtitle="来自课程表 · 实时状态"
        class="today-grid__course"
      >
        <NextCourseCard v-bind="nextCourse" />
      </DashboardSection>

      <div class="today-grid__side">
        <DashboardSection
          title="今日待办"
          :subtitle="todoTotal > 0 ? `${todoUndone} 项待处理` : undefined"
        >
          <div class="stat-grid">
            <DashboardStatCard
              :icon="ListTodo"
              :value="todoTotal"
              label="待办总数"
              :to="'/work/works'"
            />
            <DashboardStatCard
              :icon="CheckCircle2"
              :value="todoDone"
              label="已完成"
              hint="今天勾掉的"
            />
            <DashboardStatCard
              :icon="ClipboardList"
              :value="todoUndone"
              label="未完成"
              hint="别拖到最后"
            />
          </div>
        </DashboardSection>

        <DashboardSection title="班级动态">
          <ActivityTimeline v-if="classEvents.length > 0" :items="classEvents" />
          <EmptyState
            v-else
            :icon="CalendarDays"
            title="今天没有班级动态"
            description="有新请假、值日安排或周末返校时，会第一时间出现在这里。"
          />
        </DashboardSection>
      </div>
    </div>

    <!-- ===== Layer 3：快捷操作 ===== -->
    <DashboardSection title="快捷操作" subtitle="高频功能一步直达">
      <QuickActionGrid :items="quickActions" />
    </DashboardSection>

    <!-- ===== Layer 4：最近活动（占位：暂无操作足迹数据源） ===== -->
    <DashboardSection title="最近活动" subtitle="你的操作足迹 · 占位状态" class="home-page__last">
      <div class="activity-card">
        <EmptyState
          :icon="CalendarDays"
          title="最近活动还没有记录"
          description="这里以后会显示你的操作足迹（修改座位、导出座位表、更新学生信息等）。当前为占位状态，不伪造记录。"
        />
      </div>
    </DashboardSection>
  </div>
</template>

<style scoped>
.home-page {
  max-width: 1080px;
  margin: 0 auto;
}

.home-page__last {
  margin-bottom: 0;
}

/* Layer 2：桌面两列（左课程大卡占主，右侧统计+动态）；平板/手机一列 */
.today-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--card-gap);
  margin-bottom: var(--section-gap);
}

@media (min-width: 900px) {
  .today-grid {
    grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
  }

  .today-grid__course :deep(.next-course) {
    min-height: 100%;
  }
}

.today-grid__side {
  display: flex;
  flex-direction: column;
  gap: var(--card-gap);
  min-width: 0;
}

.today-grid__side :deep(.dash-section) {
  margin-bottom: 0;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--card-gap);
}

@media (max-width: 639px) {
  .stat-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.activity-card {
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
}

/* Cloud-2：同步提示条容器（空态不占位：内部 v-if 为假时高度为 0） */
.sync-row {
  display: flex;
  min-height: 0;
}

.sync-row:empty {
  display: none;
}
</style>
