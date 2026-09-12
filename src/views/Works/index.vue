<script setup lang="ts">
import { computed, ref } from 'vue'

import { AppButton } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useWorkStore } from '@/stores/work'
import type { WorkCategory, WorkFilter, WorkItem } from '@/types/work'
import { sortWorks, weekEndOf } from '@/utils/work'
import WorkEditDrawer from './components/WorkEditDrawer.vue'
import WorkImportModal from './components/WorkImportModal.vue'
import WorkRow from './components/WorkRow.vue'

/**
 * 工作清单页面（V1.1.3 · 「工作管理」第二个板块）。
 *
 * 列表分组：今日 / 本周剩余 / 逾期，按 `utils/work.ts#sortWorks` 同款口径排序。
 * 筛选：「全部 / 待完成 / 进行中 / 已完成」与需求给出的四项一致。
 */
const toast = useToast()
const workStore = useWorkStore()

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

/** 当前筛选下的全部任务 */
const filteredAll = computed(() => {
  if (filter.value === 'all') return workStore.sortedWorks
  return workStore.sortedWorks.filter((work) => work.status === filter.value)
})

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
  <div class="works-page">
    <header class="works-head">
      <div class="head-text">
        <h1 class="head-title">工作清单</h1>
        <p class="head-sub">
          今日未完成 <strong>{{ workStore.summary.todayOpen }}</strong> · 本周剩余
          <strong>{{ workStore.summary.weekOpen }}</strong>
          <span v-if="workStore.summary.overdue > 0" class="head-overdue">
            · 逾期 <strong>{{ workStore.summary.overdue }}</strong>
          </span>
        </p>
      </div>
      <div class="head-actions">
        <AppButton variant="secondary" @click="importOpen = true">📥 从 Excel 导入</AppButton>
        <AppButton @click="openCreate">＋ 新建工作</AppButton>
      </div>
    </header>

    <nav class="filter-tabs" aria-label="筛选状态">
      <button
        v-for="option in FILTER_OPTIONS"
        :key="option.value"
        type="button"
        class="filter-tab"
        :class="{ 'is-active': filter === option.value }"
        @click="filter = option.value"
      >
        {{ option.label }}
      </button>
    </nav>

    <template v-if="filter === 'all'">
      <section v-if="overdueList.length > 0" class="work-section">
        <h2 class="section-title is-overdue">逾期</h2>
        <WorkRow
          v-for="work in overdueList"
          :key="work.id"
          :work="work"
          @toggle="toggleDone"
          @edit="openEdit"
          @remove="remove"
        />
      </section>

      <section v-if="todayList.length > 0" class="work-section">
        <h2 class="section-title">今日</h2>
        <WorkRow
          v-for="work in todayList"
          :key="work.id"
          :work="work"
          @toggle="toggleDone"
          @edit="openEdit"
          @remove="remove"
        />
      </section>

      <section v-if="weekList.length > 0" class="work-section">
        <h2 class="section-title">本周剩余</h2>
        <WorkRow
          v-for="work in weekList"
          :key="work.id"
          :work="work"
          @toggle="toggleDone"
          @edit="openEdit"
          @remove="remove"
        />
      </section>

      <section v-if="laterList.length > 0" class="work-section">
        <h2 class="section-title">稍后</h2>
        <WorkRow
          v-for="work in laterList"
          :key="work.id"
          :work="work"
          @toggle="toggleDone"
          @edit="openEdit"
          @remove="remove"
        />
      </section>

      <section
        v-if="
          overdueList.length === 0 &&
          todayList.length === 0 &&
          weekList.length === 0 &&
          laterList.length === 0
        "
        class="empty"
      >
        <p class="empty-title">🎉</p>
        <p class="empty-text">目前没有待办。</p>
        <AppButton @click="openCreate">＋ 新建工作</AppButton>
      </section>
    </template>

    <template v-else>
      <section class="work-section">
        <WorkRow
          v-for="work in filteredAll"
          :key="work.id"
          :work="work"
          @toggle="toggleDone"
          @edit="openEdit"
          @remove="remove"
        />
        <div v-if="filteredAll.length === 0" class="empty">
          <p class="empty-text">没有符合筛选条件的工作。</p>
        </div>
      </section>
    </template>

    <WorkEditDrawer v-model="drawerOpen" :work="editing" @submit="onSubmit" />

    <WorkImportModal
      v-model="importOpen"
      :existing-works="workStore.works"
      @applied="onImportApplied"
    />
  </div>
</template>

<style scoped>
.works-page {
  max-width: 720px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.works-head {
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

.head-overdue strong {
  color: var(--color-danger-strong);
}

.filter-tabs {
  display: flex;
  gap: var(--space-1);
  padding: 4px;
  border-radius: var(--radius-md);
  background: var(--color-fill-disabled);
}

.filter-tab {
  flex: 1;
  padding: var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background var(--transition-fast),
    color var(--transition-fast);
}

.filter-tab:hover {
  color: var(--color-text);
}

.filter-tab.is-active {
  background: var(--color-surface);
  color: var(--color-primary-strong);
}

.work-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.section-title {
  font-size: var(--text-md);
  font-weight: 700;
  color: var(--color-text-secondary);
  margin-bottom: var(--space-1);
}

.section-title.is-overdue {
  color: var(--color-danger-strong);
}

.empty {
  padding: var(--space-7) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--color-fill-disabled);
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
}

.empty-title {
  font-size: 36px;
  margin: 0;
}

.empty-text {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  margin: 0;
}
</style>
