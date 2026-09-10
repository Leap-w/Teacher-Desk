<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { AppButton, AppModal } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useTimetableStore } from '@/stores/timetable'
import {
  LESSON_PERIODS,
  WEEKDAY_COLUMNS,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT_LABELS,
} from '@/utils/timetable'
import LessonEditDrawer from './components/LessonEditDrawer.vue'
import ScheduleDayList from './components/ScheduleDayList.vue'
import ScheduleWeekGrid from './components/ScheduleWeekGrid.vue'
import type { Lesson, LessonInput, Weekday } from '@/types/timetable'

const toast = useToast()
const timetableStore = useTimetableStore()

/** 周视图列：默认周一~周五；有周末课时自动追加，避免已录入的课在周视图里隐身 */
const columns = computed<Weekday[]>(() => [...WEEKDAY_COLUMNS, ...timetableStore.weekendWeekdays])

/** 手机分日视图当前选中的星期：默认落在今天（周末且当天无课时回到周一） */
const activeWeekday = ref<Weekday>(
  columns.value.includes(timetableStore.todayWeekday) ? timetableStore.todayWeekday : 1,
)

// 该天被删空（例如删掉最后一条周六的课）时，选中项退回第一列，不留一个不存在的标签页
watch(columns, (value) => {
  if (!value.includes(activeWeekday.value)) activeWeekday.value = value[0] ?? 1
})

const dayLessons = computed(() => timetableStore.lessonsOf(activeWeekday.value))

/* ---------- 新增 / 编辑抽屉 ---------- */

const drawerOpen = ref(false)
const editing = ref<Lesson | undefined>(undefined)
const draftWeekday = ref<Weekday>(1)
const draftPeriod = ref(1)

/** 新增时的默认节次：当天第一个空节次（排满则回到第 1 节，交给冲突校验拦） */
function firstFreePeriod(weekday: Weekday): number {
  const used = new Set(timetableStore.lessonsOf(weekday).map((lesson) => lesson.period))
  return LESSON_PERIODS.find((period) => !used.has(period)) ?? LESSON_PERIODS[0] ?? 1
}

function openCreate(weekday: Weekday = activeWeekday.value, period?: number): void {
  editing.value = undefined
  draftWeekday.value = weekday
  draftPeriod.value = period ?? firstFreePeriod(weekday)
  drawerOpen.value = true
}

function openEdit(lesson: Lesson): void {
  editing.value = lesson
  drawerOpen.value = true
}

/** 写入成功后才关抽屉：被拒时抽屉与已填内容都留着，教师改一改即可重试 */
function onSubmit(payload: LessonInput): void {
  const current = editing.value
  if (current) {
    const updated = timetableStore.updateLesson(current.id, payload)
    if (!updated) {
      toast.danger('保存失败：请检查填写内容，或该时间已有其他课程')
      return
    }
    drawerOpen.value = false
    toast.success(`已更新「${updated.subject} ${updated.className}」`)
    return
  }

  const created = timetableStore.addLesson(payload)
  if (!created) {
    toast.danger('保存失败：请检查填写内容，或该时间已有其他课程')
    return
  }
  drawerOpen.value = false
  toast.success(`已新增「${created.subject} ${created.className}」`)
  // 新增后切到该课所在的那天，否则手机上看着「什么都没发生」
  if (columns.value.includes(created.weekday)) activeWeekday.value = created.weekday
}

/* ---------- 删除（二次确认） ---------- */

const confirmOpen = ref(false)

function onRequestRemove(): void {
  if (editing.value) confirmOpen.value = true
}

function confirmRemove(): void {
  const target = editing.value
  confirmOpen.value = false
  if (!target) return
  if (!timetableStore.removeLesson(target.id)) {
    toast.danger('删除失败：该课程可能已被移除')
    return
  }
  drawerOpen.value = false
  editing.value = undefined
  toast.success(`已删除「${target.subject} ${target.className}」`)
}
</script>

<template>
  <div class="schedule-page">
    <header class="schedule-head">
      <div class="head-text">
        <h1 class="head-title">我的课表</h1>
        <p class="head-sub">
          本周共 <strong>{{ timetableStore.weekLessonCount }}</strong> 节课 · 点课程卡片可编辑
        </p>
      </div>
      <AppButton @click="openCreate()">＋ 新增课程</AppButton>
    </header>

    <!-- 手机：周一~周五（有周末课自动追加）横向切换 -->
    <nav class="weekday-tabs" aria-label="选择星期">
      <button
        v-for="weekday in columns"
        :key="weekday"
        type="button"
        class="weekday-tab"
        :class="{ 'is-active': weekday === activeWeekday }"
        :aria-pressed="weekday === activeWeekday"
        :aria-current="weekday === timetableStore.todayWeekday ? 'date' : undefined"
        @click="activeWeekday = weekday"
      >
        {{ WEEKDAY_SHORT_LABELS[weekday] }}
        <span v-if="weekday === timetableStore.todayWeekday" class="tab-dot" aria-hidden="true" />
      </button>
    </nav>

    <ScheduleDayList
      class="day-view"
      :lessons="dayLessons"
      :weekday="activeWeekday"
      @edit="openEdit"
      @create="openCreate(activeWeekday)"
    />

    <!-- PC：完整周视图 -->
    <ScheduleWeekGrid
      class="week-view"
      :lessons="timetableStore.lessons"
      :weekdays="columns"
      :today="timetableStore.todayWeekday"
      @edit="openEdit"
      @create="(weekday, period) => openCreate(weekday, period)"
    />

    <LessonEditDrawer
      v-model="drawerOpen"
      :lesson="editing"
      :default-weekday="draftWeekday"
      :default-period="draftPeriod"
      @submit="onSubmit"
      @remove="onRequestRemove"
    />

    <AppModal v-model="confirmOpen" title="删除课程" :width="400">
      <p class="confirm-text">
        确定删除
        <strong>
          「{{ editing?.subject }} {{ editing?.className }}」（{{
            editing ? WEEKDAY_LABELS[editing.weekday] : ''
          }}第 {{ editing?.period }} 节）
        </strong>
        吗？删除后工作台的今日课程与本周课时会同步变化。
      </p>
      <template #footer>
        <AppButton variant="ghost" @click="confirmOpen = false">取消</AppButton>
        <AppButton variant="danger" @click="confirmRemove">删除</AppButton>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.schedule-page {
  max-width: 960px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.schedule-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
}

.head-title {
  font-size: var(--text-xl);
  font-weight: 700;
  letter-spacing: -0.4px;
}

.head-sub {
  margin-top: var(--space-1);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.head-sub strong {
  color: var(--color-primary-strong);
}

/* ---- 手机分日切换 ---- */
.weekday-tabs {
  display: flex;
  gap: var(--space-2);
  overflow-x: auto;
  padding-bottom: var(--space-1);
  scrollbar-width: none;
}

.weekday-tabs::-webkit-scrollbar {
  display: none;
}

.weekday-tab {
  position: relative;
  flex: 1;
  min-width: 56px;
  min-height: 40px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  font-weight: 600;
  cursor: pointer;
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast),
    color var(--transition-fast);
}

.weekday-tab:hover {
  border-color: var(--color-border-emphasis);
  color: var(--color-text);
}

.weekday-tab.is-active {
  background: var(--color-primary);
  border-color: transparent;
  color: #ffffff;
}

.weekday-tab:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

/* 今天：小圆点提示（选中态的实心底上换成白色） */
.tab-dot {
  position: absolute;
  top: 6px;
  right: 8px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-primary);
}

.weekday-tab.is-active .tab-dot {
  background: #ffffff;
}

.confirm-text {
  font-size: var(--text-md);
  line-height: 1.7;
  color: var(--color-text-secondary);
}

.confirm-text strong {
  color: var(--color-text);
}

/* 手机看分日列表，PC 看周视图。
   用 759.98px 而不是 759px：视口宽度可以是小数（缩放 / 系统缩放），
   759~760 之间的宽度会两个查询都不命中，两套视图同时显示 */
@media (max-width: 759.98px) {
  .week-view {
    display: none;
  }
}

@media (min-width: 760px) {
  .weekday-tabs,
  .day-view {
    display: none;
  }
}
</style>
