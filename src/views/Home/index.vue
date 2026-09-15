<script setup lang="ts">
import { computed } from 'vue'
import {
  Armchair,
  CalendarDays,
  NotebookPen,
  Paintbrush,
  PlaneLanding,
  UsersRound,
} from 'lucide-vue-next'

import ActivityTimeline from '@/components/dashboard/ActivityTimeline.vue'
import DashboardHero from '@/components/dashboard/DashboardHero.vue'
import DashboardSection from '@/components/dashboard/DashboardSection.vue'
import QuickActionGrid, { type QuickAction } from '@/components/dashboard/QuickActionGrid.vue'
import { EmptyState } from '@/components/ui'
import { useNow } from '@/composables/useToday'
import { greetingByHour, formatDateLabel } from '@/utils/date'
import { useDutyStore } from '@/stores/duty'
import { useLeaveStore } from '@/stores/leave'
import { useTimetableStore } from '@/stores/timetable'
import { useUserStore } from '@/stores/user'
import { useWeekendStore } from '@/stores/weekend'
import { isLeaveToday } from '@/utils/leave'
import DashboardBackupNotice from './components/DashboardBackupNotice.vue'
import TodayScheduleCard from './components/TodayScheduleCard.vue'
import SyncHintBar from './components/SyncHintBar.vue'
import ClassroomEntryCard from '@/views/Toolbox/components/ClassroomEntryCard.vue'

/**
 * 首页 = 班主任今日工作中心（v3.0.3-rc · 恢复原有首页布局）。
 *
 * 五层结构（与昌都记忆首页 `Home.vue` 同一套信息架构，只替换业务内容）：
 * Hero（大背景图 + 问候 / 日期 / 工作时光天数 + 倒计时卡）
 * → 今日课程（全天课程表）
 * → 班级动态（真实数据）
 * → 快捷入口（原有四宫格）
 * → 课堂工具入口（课堂工具本身仍是独立页面）。
 *
 * **首页只承担「决策职责」不承担导航职责**：一级导航在顶部玻璃胶囊工具栏。
 * 数据全部来自既有 Store / 时间源；无数据走 EmptyState，不伪造业务数据。
 * 本版删除：今日待办统计、工作清单入口、最近活动占位（均非 TeacherDesk 设计过的模块）。
 */
const dutyStore = useDutyStore()
const leaveStore = useLeaveStore()
const timetableStore = useTimetableStore()
const userStore = useUserStore()
const weekendStore = useWeekendStore()
const now = useNow()

const profile = computed(() => userStore.profile)
const className = computed(() => profile.value.className)

/* ---- Layer 1：Hero（资料未设置时不臆造称呼与身份） ---- */
const greeting = computed(() =>
  profile.value.nickname
    ? `${greetingByHour(now.value)}，${profile.value.nickname}`
    : greetingByHour(now.value),
)

const dateLine = computed(
  () => `今天是 ${formatDateLabel(now.value).replace(/(星期[日一二三四五六])$/, ' · $1')}`,
)

const heroBadges = computed(() =>
  [className.value, profile.value.subject]
    .filter((part) => part.trim() !== '')
    .map((part) => (part === className.value ? `${part} · 班主任` : `${part} 教师`)),
)

/* ---- Layer 3：班级动态（全部真实数据） ---- */
const isWeekend = computed(() => timetableStore.todayWeekday >= 6)
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

/* ---- Layer 4：快捷入口（原有四宫格，课堂工具入口单独一张卡） ---- */
const quickActions: QuickAction[] = [
  {
    icon: UsersRound,
    label: '学生档案',
    description: '班级名册',
    to: '/students',
    tone: 'primary',
  },
  { icon: Armchair, label: '座位管理', description: '排座与方案', to: '/class/seats', tone: 'sky' },
  {
    icon: NotebookPen,
    label: '请假管理',
    description: '请假与去向',
    to: '/class/leave',
    tone: 'gold',
  },
  {
    icon: CalendarDays,
    label: '课程表',
    description: '一周安排',
    to: '/work/schedule',
    tone: 'green',
  },
]
</script>

<template>
  <div class="home-page">
    <DashboardBackupNotice />

    <!-- ===== Layer 1：Hero（大背景图 + 工作时光） ===== -->
    <DashboardHero :greeting="greeting" :date-line="dateLine" :badges="heroBadges" />

    <!-- Cloud-2：同步提示条（只读 SyncState；本地模式与已同步时不显示，无任何按钮） -->
    <div class="sync-row"><SyncHintBar /></div>

    <!-- ===== Layer 2：今日课程（全天课程表） ===== -->
    <DashboardSection
      title="今日课程"
      subtitle="全天安排 · 当前课实时状态"
      class="home-page__today"
    >
      <TodayScheduleCard />
    </DashboardSection>

    <!-- ===== Layer 3：班级动态 ===== -->
    <DashboardSection title="班级动态">
      <ActivityTimeline v-if="classEvents.length > 0" :items="classEvents" />
      <EmptyState
        v-else
        :icon="CalendarDays"
        title="今天没有班级动态"
        description="有新请假、值日安排或周末返校时，会第一时间出现在这里。"
      />
    </DashboardSection>

    <!-- ===== Layer 4：快捷入口 ===== -->
    <DashboardSection title="快捷入口" subtitle="高频功能一步直达">
      <QuickActionGrid :items="quickActions" />
    </DashboardSection>

    <!-- ===== Layer 5：课堂工具入口（课堂工具本身仍是独立页面 /my/classroom） ===== -->
    <DashboardSection title="课堂工具" subtitle="随机点名 · 课堂计时器 · 抽签">
      <ClassroomEntryCard />
    </DashboardSection>
  </div>
</template>

<style scoped>
.home-page {
  max-width: var(--page-max-width);
  margin: 0 auto;
}

.home-page__today {
  margin-top: var(--section-gap);
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
