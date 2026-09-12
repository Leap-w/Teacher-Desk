<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'

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
import DashboardQuickLinks from './components/DashboardQuickLinks.vue'
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

    <div class="dash-grid">
      <DashboardLessonCard
        :lessons="timetableStore.todayLessons"
        :weekday-label="timetableStore.todayLabel"
        :weekend="isWeekend"
      />

      <DashboardWorkCard @open="router.push('/work/works')" />

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

        <DashboardWeekendCard
          :weekend-label="weekendLabel"
          :returns="weekendReturns"
          :month-count="weekendStore.monthReturnCount"
          :stale-count="weekendStaleCount"
          @open="router.push('/weekend')"
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

  /* 自动铺满而不是写死 3 列：这一行有 4 张卡（课时 / 请假 / 周末 / 班级概况），
     写死 3 列会让第 4 张独自折到第二行、右侧空出 2/3。auto-fit + 200px 下限在
     桌面宽度下正好 4 列，窄一些时回落成 3 列——与改动前的观感一致（§9.17 审查修复） */
  .cell-bottom {
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  }
}
</style>
