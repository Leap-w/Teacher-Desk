<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import { AppSection } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useDashboardStore } from '@/stores/dashboard'
import { useDutyStore } from '@/stores/duty'
import { useLeaveStore } from '@/stores/leave'
import { useStudentStore } from '@/stores/student'
import { useTimetableStore } from '@/stores/timetable'
import { useWeekendStore } from '@/stores/weekend'
import { describeWeekend } from '@/utils/weekend'
import DashboardBackupNotice from './components/DashboardBackupNotice.vue'
import DashboardClassCard from './components/DashboardClassCard.vue'
import DashboardDutyCard from './components/DashboardDutyCard.vue'
import DashboardHeader from './components/DashboardHeader.vue'
import DashboardLeaveCard from './components/DashboardLeaveCard.vue'
import DashboardLessonCard from './components/DashboardLessonCard.vue'
import DashboardLessonStats from './components/DashboardLessonStats.vue'
import DashboardTodoCard from './components/DashboardTodoCard.vue'
import DashboardWeekendCard from './components/DashboardWeekendCard.vue'
import DashboardWorkCard from './components/DashboardWorkCard.vue'

const toast = useToast()
const router = useRouter()
const dashboardStore = useDashboardStore()
const dutyStore = useDutyStore()
const leaveStore = useLeaveStore()
const studentStore = useStudentStore()
const timetableStore = useTimetableStore()
const weekendStore = useWeekendStore()

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

/**
 * 周末返家卡片：名单与标题都取自周末 store 的同一个「本周末」计算属性——
 * 卡片说的「本周末 N 人」与列出来的名字必须同源，否则跨零点会一个翻篇一个不翻。
 */
const weekendLabel = computed(() =>
  describeWeekend(weekendStore.currentWeekend, weekendStore.todayKey),
)
// 直接下传记录而不是姓名数组：卡片要的是「谁返家」，而 v-for 的 key 得是记录 id
// （姓名快照是「姓名（学号后四位）」，同名 + 学号后四位相同就会撞 key，不能拿它当身份）
// store 给的这份**只含在读学生**（Phase 8）：徽标数几个，下面就得列几个
const weekendReturns = computed(() => weekendStore.currentReturns)

/** 本周末已不在档案的返家登记条数：不进徽标也不列名字，但卡片要说出来，别让记录显得凭空少了 */
const weekendStaleCount = computed(() => weekendStore.staleCountOf(weekendStore.currentWeekend))

/**
 * 班级概况卡片的第 1 行：在读人数（分母）与已退档人数。
 * 退档的单独说一句，因为**界面上没有任何地方能看到他们**（档案页只列在读学生，没有回收站；
 * 唯一的恢复路径是工具箱的「合并导入」旧备份）——不说，教师只会看到人数比记忆里少几个，
 * 却找不到少的是谁，更容易以为数字出错了（Phase 8 审查修正：原注释误以为档案页仍列着他们）。
 */
const studentCount = computed(() => studentStore.activeStudents.length)
const removedStudentCount = computed(() => studentStore.students.length - studentCount.value)

function toggleTodo(id: string): void {
  if (!dashboardStore.toggle(id)) toast.warning('待办状态更新失败，请刷新后重试')
}
</script>

<template>
  <div class="dash-page">
    <DashboardBackupNotice />

    <DashboardHeader />

    <!-- V1.3.0 内容流布局：区块间距 32px，卡片间距 24px，区块以 AppSection 标题划分 -->
    <AppSection title="今日课程" class="dash-section">
      <DashboardLessonCard
        :lessons="timetableStore.todayLessons"
        :weekday-label="timetableStore.todayLabel"
        :weekend="isWeekend"
      />
    </AppSection>

    <AppSection title="今日待办" class="dash-section">
      <DashboardTodoCard :todos="dashboardStore.todos" @toggle="toggleTodo" />
    </AppSection>

    <AppSection title="班级提醒" class="dash-section">
      <div class="dash-row dash-row--3">
        <DashboardDutyCard
          :group="dutyStore.todayGroup"
          :members="dutyMembers"
          :weekday-label="timetableStore.todayLabel"
          :weekend-skipped="dutyWeekendSkipped"
          :needs-setup="dutyNeedsSetup"
          :upcoming="dutyStore.upcomingDays"
          :today-key="dutyStore.todayKey"
          @open="router.push('/class/duty')"
        />

        <DashboardLeaveCard
          :out="leaveStore.outLeaves"
          :month-count="leaveStore.monthLeaveCount"
          @open="router.push('/class/leave')"
        />

        <DashboardWorkCard @open="router.push('/work/works')" />
      </div>
    </AppSection>

    <AppSection title="周末统计" class="dash-section">
      <div class="dash-row dash-row--3">
        <DashboardWeekendCard
          :weekend-label="weekendLabel"
          :returns="weekendReturns"
          :month-count="weekendStore.monthReturnCount"
          :stale-count="weekendStaleCount"
          @open="router.push('/class/weekend')"
        />

        <DashboardClassCard
          :student-count="studentCount"
          :removed-student-count="removedStudentCount"
          :duty-group="dutyStore.todayGroup"
          :duty-weekend-skipped="dutyWeekendSkipped"
          :duty-needs-setup="dutyNeedsSetup"
          :upcoming="dutyStore.upcomingDays"
          :today-key="dutyStore.todayKey"
          :weekend-label="weekendLabel"
          :stay-count="weekendStore.currentStayCount"
          :returned-count="weekendStore.currentCount"
        />

        <DashboardLessonStats :count="timetableStore.weekLessonCount" />
      </div>
    </AppSection>
  </div>
</template>

<style scoped>
.dash-section {
  margin-bottom: var(--section-gap);
}

/* 同一行的卡片等高（卡片自身撑满所在网格单元） */
.dash-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--card-gap);
}

.dash-row > * {
  height: 100%;
}

@media (min-width: 760px) {
  .dash-row--3 {
    /* 自动铺满：3 卡一行，窄一些回落成 2 列 */
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  }
}
</style>
