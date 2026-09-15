<script setup lang="ts">
import { computed, ref } from 'vue'

import { AppButton, EmptyState } from '@/components/ui'
import { useNow } from '@/composables/useToday'
import { useToast } from '@/composables/useToast'
import { useWorkStore } from '@/stores/work'
import type { WorkCategory, WorkFilter, WorkItem } from '@/types/work'
import { formatDateLabel } from '@/utils/date'
import { filterWorks, sortWorks, weekEndOf } from '@/utils/work'
import { Plus, Search, Sparkles } from 'lucide-vue-next'
import TaskGroup from './components/TaskGroup.vue'
import TaskStats from './components/TaskStats.vue'
import TaskTimeline from './components/TaskTimeline.vue'
import TasksHero from './components/TasksHero.vue'
import TodayTaskList from './components/TodayTaskList.vue'
import WorkEditDrawer from './components/WorkEditDrawer.vue'
import WorkImportModal from './components/WorkImportModal.vue'

/**
 * 工作清单页面（V2.0.9-alpha · Phase UI-5B · Tasks Hub）。
 *
 * Action First 四层：Hero → 统计 → 今日待完成｜即将到来（桌面双列）→ 已完成时间轴。
 * 分组沿用 store 口径：todayList（≤ 今天未完成，含逾期）/ weekList（本周剩余）/
 * laterList（本周日之后）/ 已完成（时间轴倒序）。
 * 增删改 / 完成 / 导入逻辑全部原样保留。
 */
const toast = useToast()
const workStore = useWorkStore()
const now = useNow()

const dateLabel = computed(() => formatDateLabel(now.value))

/* ---------- 状态筛选（保留原四项；「全部」= Action First 分层视图） ---------- */

const filter = ref<WorkFilter>('all')

const FILTER_OPTIONS: { value: WorkFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'todo', label: '待完成' },
  { value: 'in-progress', label: '进行中' },
  { value: 'done', label: '已完成' },
]

/** 今日要做的（归属日期 ≤ 今天且未完成，含逾期） */
const todayList = computed(() => workStore.todayList)

/** 本周剩余（明天起、本周日止，未完成） */
const weekList = computed(() => workStore.weekList)

/** 稍后（本周日之后且未完成）——没有这一组，「全部」视图里下周的任务会凭空消失 */
const laterList = computed(() => {
  const weekEnd = weekEndOf(workStore.today)
  return sortWorks(workStore.works.filter((work) => work.status !== 'done' && work.date > weekEnd))
})

/** 已逾期未完成 */
const overdueList = computed(() =>
  workStore.sortedWorks.filter((work) => work.date < workStore.today && work.status !== 'done'),
)

/** 已完成（时间轴数据源） */
const doneList = computed(() => workStore.works.filter((work) => work.status === 'done'))

/** 当前筛选下的全部任务（非「全部」视图用） */
const filteredList = computed(() => filterWorks(workStore.works, filter.value))

/* ---------- 抽屉 / 弹窗 ---------- */

const drawerOpen = ref(false)
const editing = ref<WorkItem | undefined>(undefined)

function openCreate(): void {
  editing.value = undefined
  drawerOpen.value = true
}

function openEdit(work: WorkItem): void {
  editing.value = work
  drawerOpen.value = true
}

function onSubmit(payload: {
  title: string
  date: string
  deadline?: string
  priority: 'normal' | 'important' | 'urgent'
  category: WorkCategory
  status: 'todo' | 'in-progress' | 'done'
  description?: string
}): void {
  if (editing.value) {
    const result = workStore.updateWork(editing.value.id, payload)
    if (!result.ok) {
      toast.danger(result.reason)
      return
    }
    drawerOpen.value = false
    toast.success(`已更新「${result.work.title}」`)
    return
  }
  const result = workStore.addWork(payload)
  if (!result.ok) {
    toast.danger(result.reason)
    return
  }
  drawerOpen.value = false
  toast.success(`已新建「${result.work.title}」`)
}

function toggleDone(work: WorkItem): void {
  const next = workStore.toggleDone(work.id)
  if (!next) {
    toast.warning('状态更新失败')
    return
  }
  if (next.status === 'done') toast.success(`已完成「${next.title}」`)
  else toast.success(`已恢复「${next.title}」`)
}

function remove(work: WorkItem): void {
  if (!window.confirm(`确定删除「${work.title}」吗？`)) return
  if (!workStore.removeWork(work.id)) {
    toast.warning('删除失败')
    return
  }
  toast.success(`已删除「${work.title}」`)
}

/* ---------- Excel 导入 ---------- */

const importOpen = ref(false)

function onImportApplied(outcome: { added: number; skipped: number }): void {
  importOpen.value = false
  toast.success(
    `导入完成：新增 ${outcome.added} 条${outcome.skipped > 0 ? `，跳过 ${outcome.skipped} 条已存在` : ''}`,
  )
}
</script>

<template>
  <div class="tasks-page">
    <!-- ===== Action First · Layer 1：Today Hero ===== -->
    <TasksHero
      :date-label="dateLabel"
      :today-open="workStore.summary.todayOpen"
      :today-done="workStore.summary.todayDone"
      :overdue="workStore.summary.overdue"
    >
      <template #actions>
        <AppButton variant="secondary" size="sm" @click="importOpen = true">Excel 导入</AppButton>
      </template>
    </TasksHero>

    <!-- ===== Layer 2：今日概览统计 ===== -->
    <TaskStats :summary="workStore.summary" />

    <!-- 状态筛选：保留原四项，切换 200ms；「全部」= 分层视图 -->
    <nav class="filter-chips" aria-label="筛选状态">
      <button
        v-for="option in FILTER_OPTIONS"
        :key="option.value"
        type="button"
        class="filter-chip"
        :class="{ 'is-active': filter === option.value }"
        @click="filter = option.value"
      >
        {{ option.label }}
      </button>
    </nav>

    <!-- ===== 「全部」：Action First 分层视图 ===== -->
    <template v-if="filter === 'all'">
      <div class="tasks-columns">
        <div class="col-main">
          <!-- Layer 2 主体：今日待完成置顶 -->
          <section class="today-section">
            <h2 class="section-title is-today">今天</h2>
            <TodayTaskList
              :works="todayList"
              @toggle="toggleDone"
              @edit="openEdit"
              @remove="remove"
            />
            <!-- 逾期并入今天列表展示后，若仍有单独口径才展示本组 -->
            <template v-if="overdueList.length > 0 && todayList.length === 0">
              <TaskGroup
                title="已逾期"
                tone="overdue"
                :works="overdueList"
                @toggle="toggleDone"
                @edit="openEdit"
                @remove="remove"
              />
            </template>
          </section>

          <!-- Layer 4：已完成时间轴（今天之下，视觉权重低） -->
          <section v-if="doneList.length > 0" class="done-section">
            <h2 class="section-title">已完成</h2>
            <TaskTimeline :works="doneList" @toggle="toggleDone" />
          </section>
        </div>

        <div class="col-side">
          <!-- Layer 3：任务分组（即将到来） -->
          <TaskGroup
            title="本周剩余"
            :works="weekList"
            @toggle="toggleDone"
            @edit="openEdit"
            @remove="remove"
          >
            <template #empty>
              <p class="group-empty">本周其他天没有安排。</p>
            </template>
          </TaskGroup>

          <TaskGroup
            v-if="laterList.length > 0"
            title="稍后"
            :works="laterList"
            @toggle="toggleDone"
            @edit="openEdit"
            @remove="remove"
          />
        </div>
      </div>

      <!-- 整体空态：今天/本周/稍后/已完成全空 -->
      <EmptyState
        v-if="
          todayList.length === 0 &&
          weekList.length === 0 &&
          laterList.length === 0 &&
          doneList.length === 0
        "
        :icon="Sparkles"
        title="任务清单是空的"
        description="用右下角的「＋ 新建工作」记录今天要做的事。"
      />
    </template>

    <!-- ===== 非「全部」：平铺筛选结果 ===== -->
    <template v-else>
      <div class="filtered-list">
        <TaskGroup
          :title="FILTER_OPTIONS.find((option) => option.value === filter)?.label ?? ''"
          :works="filteredList"
          @toggle="toggleDone"
          @edit="openEdit"
          @remove="remove"
        />
        <EmptyState
          v-if="filteredList.length === 0"
          :icon="Search"
          title="没有符合筛选条件的任务"
          description="换个状态筛选，或新建一条工作。"
        />
      </div>
    </template>

    <!-- ===== 新建入口：FAB（Action First：录入降级到最末） ===== -->
    <button type="button" class="tasks-fab" aria-label="新建工作" @click="openCreate">
      <Plus :size="22" :stroke-width="2" aria-hidden="true" />
      <span class="fab-label">新建工作</span>
    </button>

    <WorkEditDrawer v-model="drawerOpen" :work="editing" @submit="onSubmit" />

    <WorkImportModal
      v-model="importOpen"
      :existing-works="workStore.works"
      @applied="onImportApplied"
    />
  </div>
</template>

<style scoped>
.tasks-page {
  max-width: var(--page-max-width);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* 状态筛选 Chips（iOS 风，切换 200ms） */
.filter-chips {
  display: inline-flex;
  align-self: flex-start;
  gap: var(--space-1);
  padding: 3px;
  border-radius: var(--radius-full);
  background: var(--color-fill-disabled);
}

.filter-chip {
  padding: 6px 16px;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background var(--duration-base) var(--ease-out),
    color var(--transition-fast),
    box-shadow var(--duration-base) var(--ease-out);
}

.filter-chip:hover {
  color: var(--color-text-primary);
}

.filter-chip.is-active {
  background: var(--bg-card);
  color: var(--color-primary-strong);
  box-shadow: var(--shadow-xs);
}

/* 桌面双列：今日(主) | 即将到来(次) */
.tasks-columns {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: var(--space-5);
  align-items: start;
}

.col-main,
.col-side {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  min-width: 0;
}

.today-section,
.done-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.section-title {
  margin: 0;
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
}

.section-title.is-today {
  color: var(--color-primary-strong);
}

.group-empty {
  margin: 0;
  padding: var(--space-3) 0;
  font-size: var(--font-secondary);
  color: var(--color-text-tertiary);
}

.filtered-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* 新建入口 FAB：与 Leave Hub 同款（Action First 层级最低但随手可达） */
.tasks-fab {
  position: fixed;
  right: max(var(--space-5), env(safe-area-inset-right, 0px));
  bottom: max(var(--space-5), env(safe-area-inset-bottom, 0px));
  z-index: var(--z-sticky);
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 48px;
  padding: 0 var(--space-5);
  border: none;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  color: var(--color-text-inverse);
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-semibold);
  box-shadow: var(--shadow-lg);
  cursor: pointer;
  transition:
    transform var(--duration-base) var(--ease-out),
    background var(--transition-fast),
    box-shadow var(--duration-base) var(--ease-out);
}

.tasks-fab:hover {
  background: var(--color-primary-hover);
  transform: translateY(-2px);
  box-shadow: var(--shadow-xl);
}

.tasks-fab:active {
  transform: scale(0.97);
}

.tasks-fab:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

@media (max-width: 960px) {
  .tasks-columns {
    grid-template-columns: minmax(0, 1fr);
  }

  .col-side {
    gap: var(--space-4);
  }
}

@media (max-width: 640px) {
  .tasks-fab {
    right: var(--space-4);
    bottom: var(--space-4);
  }

  .fab-label {
    display: none;
  }

  .tasks-fab {
    width: 48px;
    padding: 0;
    justify-content: center;
  }
}
</style>
