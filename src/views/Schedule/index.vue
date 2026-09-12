<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { AppButton, AppModal } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useTimetableStore } from '@/stores/timetable'
import { COURSE_PERIODS } from '@/types/timetable'
import {
  WEEKDAY_COLUMNS,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT_LABELS,
  periodFullTextOf,
  periodLabelOf,
} from '@/utils/timetable'
import type {
  CourseExchange,
  CoursePeriodId,
  Lesson,
  LessonInput,
  Weekday,
} from '@/types/timetable'
import LessonDetailDrawer from './components/LessonDetailDrawer.vue'
import LessonEditDrawer from './components/LessonEditDrawer.vue'
import LessonSwapDrawer from './components/LessonSwapDrawer.vue'
import ScheduleDayList from './components/ScheduleDayList.vue'
import ScheduleImportModal from './components/ScheduleImportModal.vue'
import ScheduleWeekGrid from './components/ScheduleWeekGrid.vue'
import SettingsEntryButton from '@/components/layout/SettingsEntryButton.vue'

const toast = useToast()
const timetableStore = useTimetableStore()

/** 周视图列：默认周一~周五；有周末课时自动追加，避免已录入的课在周视图里隐身 */
const columns = computed<Weekday[]>(() => [...WEEKDAY_COLUMNS, ...timetableStore.weekendWeekdays])

/** 手机分日视图当前选中的星期：默认落在今天（周末且当天无课时回到周一） */
const activeWeekday = ref<Weekday>(
  columns.value.includes(timetableStore.todayWeekday) ? timetableStore.todayWeekday : 1,
)

watch(columns, (value) => {
  if (!value.includes(activeWeekday.value)) activeWeekday.value = value[0] ?? 1
})

const dayLessons = computed(() => timetableStore.lessonsOf(activeWeekday.value))

/* ---------- 新增 / 编辑抽屉 ---------- */

const drawerOpen = ref(false)
const editing = ref<Lesson | undefined>(undefined)
const draftWeekday = ref<Weekday>(1)
const draftPeriod = ref<CoursePeriodId>('morning')

/** 新增时的默认时段：当天第一个空时段（排满则回到早自习，交给冲突校验拦） */
function firstFreePeriod(weekday: Weekday): CoursePeriodId {
  const used = new Set(timetableStore.lessonsOf(weekday).map((lesson) => lesson.periodId))
  return COURSE_PERIODS.find((period) => !used.has(period.id))?.id ?? 'morning'
}

function openCreate(weekday: Weekday = activeWeekday.value, period?: CoursePeriodId): void {
  editing.value = undefined
  draftWeekday.value = weekday
  draftPeriod.value = period ?? firstFreePeriod(weekday)
  drawerOpen.value = true
}

function openEdit(lesson: Lesson): void {
  editing.value = lesson
  drawerOpen.value = true
}

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
  toast.success(`已删除「${target.subject} ${target.className}」`)
}

/* ---------- 详情 / 换课抽屉 ---------- */

const detailOpen = ref(false)
const detailLesson = ref<Lesson | undefined>(undefined)

const swapOpen = ref(false)
const swapLesson = ref<Lesson | undefined>(undefined)

function openDetail(lesson: Lesson): void {
  detailLesson.value = lesson
  detailOpen.value = true
}

function openSwapFromDetail(): void {
  const lesson = detailLesson.value
  detailOpen.value = false
  if (lesson) {
    swapLesson.value = lesson
    swapOpen.value = true
  }
}

/** 「详情 → 编辑」：先关详情，再打开编辑抽屉 */
function detailToEdit(): void {
  const lesson = detailLesson.value
  detailOpen.value = false
  if (lesson) openEdit(lesson)
}

/** 「详情 → 代课」：跳到编辑抽屉，类型预置为「代课」 */
function detailToSubstitute(): void {
  const lesson = detailLesson.value
  detailOpen.value = false
  if (lesson) {
    editing.value = lesson
    drawerOpen.value = true
  }
}

/** 「详情 → 删除」：先关详情，复用现有的二次确认流程 */
function detailToRemove(): void {
  const lesson = detailLesson.value
  detailOpen.value = false
  if (lesson) {
    editing.value = lesson
    confirmOpen.value = true
  }
}

/** 「详情 → 撤销换课」 */
function detailToUndo(): void {
  const lesson = detailLesson.value
  if (!lesson || !lesson.exchangeId) return
  const result = timetableStore.undoExchange(lesson.exchangeId)
  detailOpen.value = false
  if (!result.ok) {
    toast.danger(result.reason)
    return
  }
  toast.success('已撤销这次换课')
}

/** 周视图的「调课」标记：跳到详情页，让教师在原位置看换课信息 */
function openExchangeDetail(exchange: CourseExchange): void {
  const lesson = timetableStore.lessons.find((item) => item.exchangeId === exchange.id)
  if (lesson) {
    detailLesson.value = lesson
    detailOpen.value = true
    return
  }
  toast.info('该换课记录对应的课程已被删除，无法查看')
}

function onSwapConfirm(params: {
  toWeekday: Weekday
  toPeriodId: CoursePeriodId
  toClassName: string
  toSubject: string
  withEveningGroup: boolean
}): void {
  const lesson = swapLesson.value
  if (!lesson) return
  const result = timetableStore.exchangeLesson({
    lessonId: lesson.id,
    to: {
      weekday: params.toWeekday,
      periodId: params.toPeriodId,
      className: params.toClassName,
      subject: params.toSubject,
    },
    withEveningGroup: params.withEveningGroup,
  })
  if (!result.ok) {
    toast.danger(result.reason)
    return
  }
  swapOpen.value = false
  toast.success(
    params.withEveningGroup
      ? `整组晚自习已调至 ${WEEKDAY_SHORT_LABELS[params.toWeekday]} ${periodLabelOf(params.toPeriodId)}`
      : `已调至 ${WEEKDAY_SHORT_LABELS[params.toWeekday]} ${periodLabelOf(params.toPeriodId)}`,
  )
}

/* ---------- Excel 导入 ---------- */

const importOpen = ref(false)

function onImportApplied(outcome: { added: number; replaced: number }): void {
  importOpen.value = false
  toast.success(`导入完成：新增 ${outcome.added} 节，覆盖 ${outcome.replaced} 节`)
}
</script>

<template>
  <div class="schedule-page">
    <header class="schedule-head">
      <div class="head-text">
        <h1 class="head-title">课程表</h1>
        <p class="head-sub">
          本周共 <strong>{{ timetableStore.weekLessonCount }}</strong> 节课 · 点课程卡片可查看详情
        </p>
      </div>
      <div class="head-actions">
        <SettingsEntryButton module="work" />
        <AppButton variant="secondary" @click="importOpen = true">📥 从 Excel 导入</AppButton>
        <AppButton @click="openCreate()">＋ 新增课程</AppButton>
      </div>
    </header>

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
      :exchanges="
        timetableStore.exchanges.filter((exchange) => exchange.from.weekday === activeWeekday)
      "
      :weekday="activeWeekday"
      @open="openDetail"
      @open-exchange="openExchangeDetail"
      @create="openCreate(activeWeekday)"
    />

    <ScheduleWeekGrid
      class="week-view"
      :lessons="timetableStore.lessons"
      :exchanges="timetableStore.exchanges"
      :weekdays="columns"
      :today="timetableStore.todayWeekday"
      @open="openDetail"
      @open-exchange="openExchangeDetail"
      @create="(weekday, period) => openCreate(weekday, period)"
    />

    <!-- 编辑抽屉 -->
    <LessonEditDrawer
      v-model="drawerOpen"
      :lesson="editing"
      :default-weekday="draftWeekday"
      :default-period-id="draftPeriod"
      :preset-type="editing?.type === 'substitute' ? 'substitute' : 'normal'"
      @submit="onSubmit"
      @remove="onRequestRemove"
    />

    <!-- 课程详情 -->
    <LessonDetailDrawer
      v-model="detailOpen"
      :lesson="detailLesson"
      :exchange="
        detailLesson && detailLesson.exchangeId
          ? timetableStore.exchanges.find((e) => e.id === detailLesson!.exchangeId)
          : undefined
      "
      :evening-siblings="detailLesson ? timetableStore.eveningSiblingsOf(detailLesson) : []"
      @edit="detailToEdit"
      @exchange="openSwapFromDetail"
      @substitute="detailToSubstitute"
      @remove="detailToRemove"
      @undo="detailToUndo"
    />

    <!-- 换课抽屉 -->
    <LessonSwapDrawer v-model="swapOpen" :lesson="swapLesson" @confirm="onSwapConfirm" />

    <!-- Excel 导入 -->
    <ScheduleImportModal
      v-model="importOpen"
      :existing-lessons="timetableStore.lessons"
      @applied="onImportApplied"
    />

    <!-- 删除确认 -->
    <AppModal v-model="confirmOpen" title="删除课程" :width="400">
      <p class="confirm-text">
        确定删除
        <strong>
          「{{ editing?.subject }} {{ editing?.className }}」（{{
            editing ? WEEKDAY_LABELS[editing.weekday] : ''
          }}· {{ editing ? periodFullTextOf(editing.periodId) : '' }}）
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

.head-actions {
  display: flex;
  gap: var(--space-2);
  flex-shrink: 0;
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
