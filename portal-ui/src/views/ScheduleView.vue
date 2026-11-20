<script setup lang="ts">
import { computed, ref } from 'vue'
import { portalData } from '../data'
import Icon from '../components/Icon.vue'

function todayWeekday(): number {
  const day = new Date().getDay()
  return day === 0 ? 7 : day
}

const selected = ref(todayWeekday())
const day = computed(
  () => portalData.week.find((item) => item.weekday === selected.value) ?? portalData.week[0],
)
const periodMap = new Map(portalData.periods.map((period) => [period.id, period]))
const isToday = (weekday: number) => weekday === todayWeekday()
</script>

<template>
  <div class="page schedule">
    <header class="page-head">
      <h1>课程表</h1>
      <p class="muted">一周课程安排</p>
    </header>

    <div class="week-switch" role="tablist" aria-label="选择星期">
      <button
        v-for="item in portalData.week"
        :key="item.weekday"
        type="button"
        role="tab"
        :aria-selected="selected === item.weekday"
        class="day-chip"
        :class="{ active: selected === item.weekday }"
        @click="selected = item.weekday"
      >
        <span>{{ item.short }}</span>
        <span v-if="isToday(item.weekday)" class="today-dot"></span>
      </button>
    </div>

    <div class="day-heading">
      <h2 class="section-title">{{ day?.label }}</h2>
      <span class="muted count">{{
        day?.items.length ? `${day.items.length} 节课` : '无课程'
      }}</span>
    </div>

    <div v-if="day?.items.length" class="course-list">
      <div v-for="course in day.items" :key="course.periodId" class="course card">
        <div class="period">
          <strong>{{ course.periodId }}</strong>
          <span>{{ course.periodId <= 8 ? '节' : '晚' }}</span>
        </div>
        <div class="course-main">
          <h3>
            {{ course.subject }}
            <span v-if="course.changeLabel" class="change-chip">{{ course.changeLabel }}</span>
          </h3>
          <p v-if="course.teacher" class="muted">{{ course.teacher }}</p>
        </div>
        <div class="time muted">
          {{ periodMap.get(course.periodId)?.start }}<br />{{ periodMap.get(course.periodId)?.end }}
        </div>
      </div>
    </div>

    <div v-else class="empty card">
      <Icon name="calendar" :size="28" />
      <p>周末没有安排课程</p>
      <span class="muted">好好休息</span>
    </div>

    <p v-if="portalData.mode === 'api'" class="schedule-notice">
      <Icon name="info" :size="14" /> 当前展示基础课表，暂未同步本周调课
    </p>

    <p class="footnote muted">
      <Icon name="info" :size="14" />
      {{ portalData.mode === 'demo' ? '课程表为演示数据' : '课程表为只读数据' }}
    </p>
  </div>
</template>

<style scoped>
.page-head {
  padding-top: var(--space-2);
}

.page-head h1 {
  font-size: 26px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.page-head p {
  margin-top: 4px;
  font-size: 13px;
}

.week-switch {
  display: flex;
  gap: 4px;
  margin-top: var(--space-5);
  padding: 4px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow-x: auto;
  scrollbar-width: none;
}

.week-switch::-webkit-scrollbar {
  display: none;
}

.day-chip {
  position: relative;
  flex: 1 0 44px;
  min-width: 44px;
  min-height: 44px;
  padding: 0 2px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-sub);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

.day-chip.active {
  background: var(--primary);
  color: var(--text-inverse);
}

.today-dot {
  position: absolute;
  left: 50%;
  bottom: 5px;
  width: 4px;
  height: 4px;
  margin-left: -2px;
  border-radius: 50%;
  background: var(--primary);
}

.day-chip.active .today-dot {
  background: #fff;
}

.day-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin: var(--space-6) 0 var(--space-3);
}

.count {
  font-size: 12px;
}

.course-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.course {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  min-height: 68px;
}

.period {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm);
  background: var(--primary-soft);
  color: var(--primary);
  line-height: 1.1;
}

.period strong {
  font-size: 15px;
  font-weight: 600;
}

.period span {
  font-size: 9px;
  opacity: 0.85;
}

.course-main {
  flex: 1;
  min-width: 0;
}

.course-main h3 {
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.change-chip {
  display: inline-block;
  margin-left: 4px;
  padding: 0 6px;
  border-radius: var(--radius-full);
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 10px;
  font-weight: 500;
  vertical-align: 1px;
}

.course-main p {
  margin-top: 2px;
  font-size: 12px;
}

.time {
  flex: none;
  text-align: right;
  font-size: 11px;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: var(--space-10) var(--space-4);
  color: var(--primary);
}

.empty p {
  margin-top: var(--space-2);
  font-weight: 600;
  color: var(--text-main);
}

.empty span {
  font-size: 12px;
}

.footnote {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: var(--space-6);
  font-size: 11px;
}

.schedule-notice {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: var(--space-4);
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--primary-softer);
  color: var(--text-sub);
  font-size: 11px;
  line-height: 1.5;
}

.schedule-notice :deep(svg) {
  flex: 0 0 auto;
  color: var(--primary);
}
</style>
