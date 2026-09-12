<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  BookOpen,
  CalendarDays,
  Calendar,
  Clipboard,
  ClipboardCheck,
  ClipboardList,
  LayoutGrid,
  Settings,
  Sparkles,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-vue-next'

import { AppSection } from '@/components/ui'
import { useCountdownSettings } from '@/composables/useCountdownSettings'
import { COURSE_PERIODS } from '@/types/timetable'
import { useDashboardStore } from '@/stores/dashboard'
import { useDutyStore } from '@/stores/duty'
import { useLeaveStore } from '@/stores/leave'
import { useStudentStore } from '@/stores/student'
import { useTimetableStore } from '@/stores/timetable'
import { isLeaveToday } from '@/utils/leave'
import DashboardBackupNotice from './components/DashboardBackupNotice.vue'
import HeroSection from './components/HeroSection.vue'
import HomeDateBar from './components/HomeDateBar.vue'

/**
 * 首页（V1.3.1，首页1.1.html 同源版）：
 * Hero 倒计时 → 日期栏 → 今日状态（三小卡）→ 班级提醒（三小卡）→ 快捷入口（五入口）。
 * 班主任每天打开后的第一屏工作入口——不再有仪表盘式大卡片。
 * 只做展示与跳转，数据全部来自既有 Store。
 */
const router = useRouter()
const dashboardStore = useDashboardStore()
const dutyStore = useDutyStore()
const leaveStore = useLeaveStore()
const studentStore = useStudentStore()
const timetableStore = useTimetableStore()
useCountdownSettings() // Hero 自含时钟；这里挂载保证设置读取同源

const isWeekend = computed(() => timetableStore.todayWeekday >= 6)

/** 今日值日卡片：不值日（周末不排）与「还没建组」分开说（口径沿用 §9.18） */
const dutyWeekendSkipped = computed(
  () => dutyStore.groups.length > 0 && isWeekend.value && !dutyStore.settings.includeWeekend,
)
const dutyNeedsSetup = computed(() => dutyStore.groups.length > 0 && !dutyStore.settings.startDate)
const dutyMembers = computed(() =>
  dutyStore.todayGroup ? dutyStore.membersOf(dutyStore.todayGroup) : [],
)

/** 今日课程：节数 + 下一节课时间（当前时段之后的第一节） */
const todayLessons = computed(() => timetableStore.todayLessons)
const periodOrder = computed(() => new Map(COURSE_PERIODS.map((p, i) => [p.id, i])))
const nextLessonTime = computed(() => {
  const now = new Date()
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const upcoming = [...todayLessons.value]
    .sort(
      (a, b) => (periodOrder.value.get(a.periodId) ?? 0) - (periodOrder.value.get(b.periodId) ?? 0),
    )
    .find((lesson) => {
      const start = COURSE_PERIODS.find((p) => p.id === lesson.periodId)?.startTime ?? ''
      return start >= hhmm
    })
  return upcoming && COURSE_PERIODS.find((p) => p.id === upcoming.periodId)?.startTime
})

/** 今日工作：待办总数 / 已完成 */
const todoTotal = computed(() => dashboardStore.todos.length)
const todoDone = computed(() => dashboardStore.todos.filter((t) => t.done).length)

/** 本周授课节数 */
const weekLessonCount = computed(() => timetableStore.weekLessonCount)

/** 今日请假人数 */
const todayLeaveCount = computed(
  () => leaveStore.leaves.filter((r) => isLeaveToday(r, dutyStore.todayKey)).length,
)

/** 班级概况：在读男 / 女人数 */
const studentTotal = computed(() => studentStore.activeStudents.length)
const maleCount = computed(
  () => studentStore.activeStudents.filter((s) => s.gender === 'male').length,
)
const femaleCount = computed(
  () => studentStore.activeStudents.filter((s) => s.gender === 'female').length,
)

/* ---- 快捷入口（昌都记忆 quick-btn 同款） ---- */
const quickEntries: { icon: LucideIcon; label: string; sub: string; to: string; tint: string }[] = [
  {
    icon: Calendar,
    label: '课程表',
    sub: '课程安排',
    to: '/work/schedule',
    tint: 'rgba(74, 140, 148, 0.1)',
  },
  {
    icon: Clipboard,
    label: '工作清单',
    sub: '待办事项',
    to: '/work/works',
    tint: 'rgba(111, 168, 220, 0.12)',
  },
  {
    icon: LayoutGrid,
    label: '座位管理',
    sub: '座位方案',
    to: '/class/seats',
    tint: 'rgba(214, 168, 79, 0.12)',
  },
  {
    icon: Wrench,
    label: '工具箱',
    sub: '备份同步',
    to: '/my/tools',
    tint: 'rgba(107, 158, 133, 0.12)',
  },
  {
    icon: Settings,
    label: '系统设置',
    sub: '时间设置等',
    to: '/my/settings',
    tint: 'rgba(140, 154, 155, 0.12)',
  },
]

const statusCards = computed(() => [
  {
    icon: BookOpen,
    label: '今日课程',
    value: isWeekend.value ? '周末' : `${todayLessons.value.length} 节`,
    desc: nextLessonTime.value ? `下一节 ${nextLessonTime.value}` : '今天没有课了',
    to: '/work/schedule' as const,
  },
  {
    icon: ClipboardCheck,
    label: '今日工作',
    value: `${todoTotal.value} 项`,
    desc: `已完成 ${todoDone.value} 项`,
    to: '/work/works' as const,
  },
  {
    icon: CalendarDays,
    label: '本周授课',
    value: `${weekLessonCount.value} 节`,
    desc: '本周课时统计',
    to: '/work/schedule' as const,
  },
])

function open(path: string): void {
  router.push(path)
}
</script>

<template>
  <div class="home-page">
    <DashboardBackupNotice />

    <!-- ===== Hero 倒计时（首页1.1.html 同源视觉） ===== -->
    <HeroSection />

    <!-- ===== 日期栏（Apple 锁屏风） ===== -->
    <HomeDateBar class="home-date" />

    <!-- ===== 今日状态（一行三个小卡片） ===== -->
    <AppSection title="今日状态" class="home-section">
      <div class="home-grid home-grid--3">
        <button
          v-for="card in statusCards"
          :key="card.label"
          type="button"
          class="mini-card"
          @click="open(card.to)"
        >
          <div class="mini-card__head">
            <span class="mini-card__icon" aria-hidden="true"
              ><component :is="card.icon" :size="16"
            /></span>
            <span class="mini-card__title">{{ card.label }}</span>
          </div>
          <div class="mini-card__body">
            <span class="mini-card__value">{{ card.value }}</span>
            <span class="mini-card__desc">{{ card.desc }}</span>
          </div>
        </button>
      </div>
    </AppSection>

    <!-- ===== 班级提醒（一行三个卡片） ===== -->
    <AppSection title="班级提醒" class="home-section">
      <div class="home-grid home-grid--3">
        <button type="button" class="mini-card" @click="open('/class/duty')">
          <div class="mini-card__head">
            <span class="mini-card__icon" aria-hidden="true"><Sparkles :size="16" /></span>
            <span class="mini-card__title">今日值日</span>
          </div>
          <div class="mini-card__body">
            <template v-if="dutyStore.todayGroup">
              <span class="mini-card__value">{{ dutyStore.todayGroup.name }}</span>
              <span class="mini-card__desc">{{ dutyMembers.join(' · ') || '组员待安排' }}</span>
            </template>
            <template v-else-if="dutyNeedsSetup">
              <span class="mini-card__value">待设起点</span>
              <span class="mini-card__desc">去值日管理设置轮换起点</span>
            </template>
            <template v-else-if="dutyWeekendSkipped">
              <span class="mini-card__value">今天不值日</span>
              <span class="mini-card__desc">当前设置为周末不排</span>
            </template>
            <template v-else>
              <span class="mini-card__value">还没建组</span>
              <span class="mini-card__desc">去值日管理建组开始轮换</span>
            </template>
          </div>
        </button>

        <button type="button" class="mini-card" @click="open('/class/leave')">
          <div class="mini-card__head">
            <span class="mini-card__icon" aria-hidden="true"><ClipboardList :size="16" /></span>
            <span class="mini-card__title">请假管理</span>
          </div>
          <div class="mini-card__body">
            <span class="mini-card__value">{{ todayLeaveCount }} 人</span>
            <span class="mini-card__desc">今日请假 · 点击查看记录</span>
          </div>
        </button>

        <button type="button" class="mini-card" @click="open('/students')">
          <div class="mini-card__head">
            <span class="mini-card__icon" aria-hidden="true"><Users :size="16" /></span>
            <span class="mini-card__title">班级概况</span>
          </div>
          <div class="mini-card__body">
            <span class="mini-card__value">{{ studentTotal }} 人</span>
            <span class="mini-card__desc">男生 {{ maleCount }} · 女生 {{ femaleCount }}</span>
          </div>
        </button>
      </div>
    </AppSection>

    <!-- ===== 快捷入口（昌都记忆 quick-btn 同款） ===== -->
    <AppSection title="快捷入口" class="home-section home-section--last">
      <div class="home-grid home-grid--5">
        <button
          v-for="entry in quickEntries"
          :key="entry.label"
          type="button"
          class="quick-btn"
          @click="open(entry.to)"
        >
          <span class="quick-btn__icon" :style="{ background: entry.tint }" aria-hidden="true">
            <component :is="entry.icon" :size="22" />
          </span>
          <span class="quick-btn__label">{{ entry.label }}</span>
          <span class="quick-btn__sub">{{ entry.sub }}</span>
        </button>
      </div>
    </AppSection>
  </div>
</template>

<style scoped>
.home-page {
  max-width: 1080px;
  margin: 0 auto;
}

.home-date {
  margin: var(--spacing-lg) 0 var(--spacing-xl);
}

.home-section {
  margin-bottom: var(--section-gap);
}

.home-section--last {
  margin-bottom: 0;
}

/* 卡片间距 24px；三卡一行（自动回落） */
.home-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--card-gap);
}

@media (min-width: 640px) {
  .home-grid--3 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (min-width: 640px) {
  .home-grid--5 {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
}

@media (max-width: 639px) {
  .home-grid--5 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

/* ---- 今日状态 / 班级提醒小卡（保持当前三卡尺寸） ---- */
.mini-card {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--spacing-card);
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  text-align: left;
  cursor: pointer;
  transition:
    transform var(--transition-spring),
    box-shadow var(--transition-spring);
}

@media (hover: hover) {
  .mini-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-hover);
  }
}

.mini-card:active {
  transform: scale(0.98);
}

.mini-card:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.mini-card__head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mini-card__icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: var(--color-primary-bg);
  color: var(--color-primary-dark);
  flex-shrink: 0;
}

.mini-card__title {
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
}

.mini-card__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mini-card__value {
  font-size: 22px;
  font-weight: var(--font-weight-bold);
  line-height: 1.1;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mini-card__desc {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- 快捷入口（昌都记忆 quick-btn：图标方块 + Hover 放大） ---- */
.quick-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: var(--spacing-card) var(--space-2);
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  cursor: pointer;
  transition:
    transform var(--transition-spring),
    box-shadow var(--transition-spring);
}

@media (hover: hover) {
  .quick-btn:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-hover);
  }
}

.quick-btn:active {
  transform: scale(0.98);
}

.quick-btn:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.quick-btn__icon {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  color: var(--color-primary-dark);
  flex-shrink: 0;
}

.quick-btn__label {
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.quick-btn__sub {
  font-size: 11px;
  color: var(--color-text-tertiary);
}
</style>
