<script setup lang="ts">
import { computed } from 'vue'
import { BookOpen, CheckCircle2, MoonStar } from 'lucide-vue-next'

import { useNow } from '@/composables/useToday'
import { useTimetableStore } from '@/stores/timetable'
import { COURSE_PERIODS } from '@/types/timetable'
import type { Lesson } from '@/types/timetable'
import { scheduleNowOf, sortLessonsByPeriod } from '@/utils/scheduleNow'

/**
 * TodayScheduleCard — 首页「今日课程」大卡（v3.0.1-rc）：
 * 一屏看到**当天全部课程**（节次 / 时间 / 科目），取代只显示单节的 NextCourseCard。
 *
 * Decision First 不变：头部仍是「当前 / 下一节」的状态语 + 倒计时（正在上课 / 下节课
 * 最先被看到），下方是全天纵向列表——当前课松石青高亮、下一节加徽标、上完的灰化。
 * 课程多时列表**内部滚动**，不撑破首页；判定规则复用 `utils/scheduleNow.ts`（唯一实现）。
 */
const timetableStore = useTimetableStore()
const now = useNow()

const lessons = computed<Lesson[]>(() => timetableStore.todayLessons)
const isWeekend = computed(() => timetableStore.todayWeekday >= 6)

/** 全天课程（按时段顺序）；行内补上时段的时间信息 */
const rows = computed(() => {
  const sorted = sortLessonsByPeriod(lessons.value)
  return sorted.map((lesson) => {
    const period = COURSE_PERIODS.find((item) => item.id === lesson.periodId)
    return { lesson, period }
  })
})

const state = computed(() => scheduleNowOf(lessons.value, now.value))

/** 当前时刻 hh:mm（行状态判定用） */
const hhmm = computed(() => {
  const value = now.value
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
})

/** 行的展示状态：当前课 / 下一节 / 已上完 / 未开始 */
function rowTone(periodId: Lesson['periodId']): 'current' | 'next' | 'past' | 'idle' {
  const nowState = state.value
  if (nowState.state === 'ongoing' && nowState.lesson?.periodId === periodId) return 'current'
  if (nowState.state === 'next' && nowState.lesson?.periodId === periodId) return 'next'
  if (nowState.state === 'done') return 'past'
  // 课间 / 未开始：已结束的时段灰化
  const period = COURSE_PERIODS.find((item) => item.id === periodId)
  return period && period.endTime <= hhmm.value ? 'past' : 'idle'
}

const emptyHint = computed(() =>
  isWeekend.value ? '周末不排课，好好休息。' : '课程表里还没有今天的安排。',
)

const eyebrow = computed(() => {
  switch (state.value.state) {
    case 'ongoing':
      return '正在上课'
    case 'next':
      return '下一节课'
    case 'done':
      return '今天课上完啦'
    default:
      return '今天没有课'
  }
})

const countdownText = computed(() => {
  const nowState = state.value
  if (nowState.state === 'ongoing') return `剩 ${nowState.minutesLeft} 分钟`
  if (nowState.state === 'next') return `${nowState.minutesLeft} 分钟后上课`
  if (nowState.state === 'done') return '全部课程已结束，安心批作业。'
  return emptyHint.value
})
</script>

<template>
  <div class="today-course">
    <!-- 头部：当前 / 下一节状态（Decision First，最先被看到） -->
    <div v-if="state.state === 'ongoing' || state.state === 'next'" class="today-course__head">
      <p class="today-course__eyebrow">
        <span class="today-course__pulse" aria-hidden="true" />
        {{ eyebrow }}
      </p>
      <p class="today-course__subject">{{ state.lesson?.subject }}</p>
      <span class="today-course__countdown" aria-live="polite">
        <component
          :is="state.state === 'ongoing' ? CheckCircle2 : BookOpen"
          :size="16"
          :stroke-width="2"
          aria-hidden="true"
        />
        {{ countdownText }}
      </span>
    </div>
    <div v-else class="today-course__head">
      <span class="today-course__done-icon" aria-hidden="true">
        <component
          :is="state.state === 'done' ? CheckCircle2 : MoonStar"
          :size="24"
          :stroke-width="1.8"
        />
      </span>
      <p class="today-course__subject today-course__subject--soft">{{ eyebrow }}</p>
      <p class="today-course__meta">{{ countdownText }}</p>
    </div>

    <!-- 全天列表：节次 / 时间 / 科目；当前课高亮，超长内部滚动 -->
    <ul v-if="rows.length > 0" class="today-course__list" aria-label="今日全部课程">
      <li
        v-for="{ lesson, period } in rows"
        :key="lesson.periodId"
        class="course-row"
        :class="`is-${rowTone(lesson.periodId)}`"
      >
        <span class="course-row__name">{{ period?.shortLabel ?? lesson.periodId }}</span>
        <span class="course-row__time">{{ period?.startTime }}–{{ period?.endTime }}</span>
        <span class="course-row__subject">{{ lesson.subject }}</span>
        <span v-if="rowTone(lesson.periodId) === 'next'" class="course-row__badge">下一节</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.today-course {
  display: flex;
  flex-direction: column;
  /* v3.0.3-rc：卡片加高——全天课程一屏读完，不再被压扁 */
  min-height: 420px;
  padding: var(--spacing-xl) var(--spacing-xl) var(--spacing-lg);
  background: var(--color-bg-white);
  border: var(--border-hairline-width) solid var(--color-border-light);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
}

@media (max-width: 640px) {
  .today-course {
    min-height: 0;
  }
}

/* ---- 头部状态（沿用 NextCourseCard 的视觉语言） ---- */
.today-course__head {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.today-course__eyebrow {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-semibold);
  color: var(--color-primary-dark);
}

.today-course__pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-primary);
}

.today-course__subject {
  margin-top: var(--space-2);
  font-size: var(--font-num-2xl);
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.02em;
  line-height: var(--leading-tight);
  color: var(--color-text-primary);
}

.today-course__subject--soft {
  font-size: var(--font-num-sm);
  color: var(--color-text-secondary);
}

.today-course__meta {
  margin-top: var(--space-2);
  font-size: var(--font-content);
  color: var(--color-text-secondary);
}

.today-course__countdown {
  margin-top: var(--space-2);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: var(--radius-full);
  background: var(--color-primary-soft);
  color: var(--color-primary-dark);
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
}

.today-course__done-icon {
  color: var(--color-primary);
  opacity: 0.85;
  margin-bottom: var(--space-2);
}

/* ---- 全天列表 ---- */
.today-course__list {
  list-style: none;
  margin: var(--spacing-md) 0 0;
  padding: 0;
  /* 课程多时内部滚动：不撑破首页（同时是暗色下的滚动容器） */
  flex: 1;
  max-height: 360px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  scrollbar-width: thin;
}

.course-row {
  display: grid;
  grid-template-columns: 64px 110px 1fr auto;
  align-items: center;
  gap: var(--space-3);
  /* v3.0.3-rc：行高加大——讲台距离下也读得清 */
  padding: var(--spacing-md);
  border-radius: var(--radius-sm);
  border-left: 3px solid transparent;
  font-size: var(--text-md);
  color: var(--color-text-secondary);
  transition: background var(--duration-base) var(--ease-out);
}

.course-row__name {
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.course-row__time {
  font-variant-numeric: tabular-nums;
}

.course-row__subject {
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

/* 当前课：松石青高亮（Decision First 的视觉落点） */
.course-row.is-current {
  background: var(--color-primary-soft);
  border-left-color: var(--color-primary);
}

.course-row.is-current .course-row__subject {
  color: var(--color-primary-dark);
}

/* 已上完：灰化 */
.course-row.is-past {
  opacity: 0.55;
}

/* 下一节徽标 */
.course-row__badge {
  padding: 2px 10px;
  border-radius: var(--radius-full);
  background: var(--color-primary-soft);
  color: var(--color-primary-dark);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-semibold);
}

.course-row.is-past .course-row__name,
.course-row.is-past .course-row__subject {
  color: var(--color-text-secondary);
}

@media (max-width: 640px) {
  .today-course {
    padding: var(--spacing-card);
  }

  .today-course__subject {
    font-size: var(--text-xl);
  }

  .course-row {
    grid-template-columns: 56px 1fr auto;
  }

  .course-row__time {
    display: none;
  }
}
</style>
