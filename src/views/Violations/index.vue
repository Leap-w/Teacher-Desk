<script setup lang="ts">
/**
 * 违纪管理（`/class/violations`）。
 *
 * 页面同时承担：概览统计 / 事件列表 / 新增 / 排行 / 经常违纪 / 严重事件 / 个人档案入口。
 * 所有数据读写只经 `useViolationStore()`（Phase 1A），UI 不直接碰 localStorage。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Plus, Search } from 'lucide-vue-next'

import { AppButton, AppCard, AppInput, AppModal, AppSelect, EmptyState } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useStudentStore } from '@/stores/student'
import { useViolationStore } from '@/stores/violation'
import {
  DEFAULT_VIOLATION_LIST_FILTER,
  isViolationFilterActive,
  toViolationQuery,
  VIOLATION_SEVERITY_OPTIONS,
} from '@/utils/violationUi'
import ViolationEventDetailModal from './components/ViolationEventDetailModal.vue'
import ViolationEventItem from './components/ViolationEventItem.vue'
import ViolationFormModal from './components/ViolationFormModal.vue'
import ViolationOverviewPanel from './components/ViolationOverviewPanel.vue'
import ViolationProfileModal from './components/ViolationProfileModal.vue'
import StudentPhotoManager from '../Students/components/StudentPhotoManager.vue'
import type { ViolationEvent, ViolationSeverity } from '@/types/violation'

const route = useRoute()
const router = useRouter()
const violationStore = useViolationStore()
const studentStore = useStudentStore()
const toast = useToast()

/* ---------- 列表筛选 ---------- */

const filter = ref({ ...DEFAULT_VIOLATION_LIST_FILTER })

const events = computed(() => violationStore.listEvents(toViolationQuery(filter.value)))
const totalEvents = computed(() => violationStore.events.length)
const filterActive = computed(() => isViolationFilterActive(filter.value))

const severityFilterOptions = computed(() => [
  { value: 'all', label: '全部等级' },
  ...VIOLATION_SEVERITY_OPTIONS,
])

function clearFilters(): void {
  filter.value = { ...DEFAULT_VIOLATION_LIST_FILTER }
}

/* ---------- 弹窗状态 ---------- */

const formOpen = ref(false)
const editingEvent = ref<ViolationEvent | undefined>(undefined)

const detailOpen = ref(false)
const detailEvent = ref<ViolationEvent | undefined>(undefined)

const profileOpen = ref(false)
const profileStudentId = ref<string | undefined>(undefined)

const deleteOpen = ref(false)
const deletingEvent = ref<ViolationEvent | undefined>(undefined)

const photoOpen = ref(false)
const photoStudentId = ref<string | undefined>(undefined)

const photoStudent = computed(() =>
  photoStudentId.value
    ? studentStore.students.find((student) => student.id === photoStudentId.value)
    : undefined,
)

function openCreate(): void {
  editingEvent.value = undefined
  formOpen.value = true
}

function openEdit(event: ViolationEvent): void {
  detailOpen.value = false
  editingEvent.value = event
  formOpen.value = true
}

function openDetail(event: ViolationEvent): void {
  detailEvent.value = event
  detailOpen.value = true
}

function openProfile(studentId: string): void {
  detailOpen.value = false
  profileStudentId.value = studentId
  profileOpen.value = true
  if (route.query.student !== studentId) {
    void router.replace({ query: { ...route.query, student: studentId } })
  }
}

/** 从学生详情跳转过来时（`?student=<id>`）直接打开该生档案；无效 id 忽略 */
function openProfileFromQuery(): void {
  const queryStudentId = typeof route.query.student === 'string' ? route.query.student : ''
  if (!queryStudentId) return
  const known =
    studentStore.students.some((student) => student.id === queryStudentId) ||
    violationStore.events.some((event) => event.studentId === queryStudentId)
  if (known) openProfile(queryStudentId)
}

onMounted(openProfileFromQuery)
watch(() => route.query.student, openProfileFromQuery)

// 档案关闭后清掉查询参数，避免刷新又自动弹出（深链只用于一次进入）
watch(profileOpen, (open) => {
  if (!open && route.query.student) {
    void router.replace({ query: { ...route.query, student: undefined } })
  }
})

function askRemove(event: ViolationEvent): void {
  detailOpen.value = false
  deletingEvent.value = event
  deleteOpen.value = true
}

function confirmRemove(): void {
  const target = deletingEvent.value
  if (!target) return
  const removed = violationStore.removeViolation(target.id)
  deleteOpen.value = false
  if (removed) toast.success('已删除这条违纪记录')
  else toast.danger('删除失败：记录可能已不存在')
  deletingEvent.value = undefined
}

function onSaved(count: number, mode: 'create' | 'edit'): void {
  toast.success(mode === 'edit' ? '已保存修改' : `已新增 ${count} 条违纪记录`)
}

function openPhotos(studentId: string): void {
  const student = studentStore.students.find((item) => item.id === studentId)
  if (!student) {
    toast.danger('找不到该学生的档案，无法查看照片')
    return
  }
  photoStudentId.value = studentId
  photoOpen.value = true
}
</script>

<template>
  <div class="violations-page">
    <!-- 顶部工具条 -->
    <header class="page-toolbar">
      <div class="toolbar-filters">
        <label class="search-wrap">
          <Search :size="16" :stroke-width="2" aria-hidden="true" />
          <AppInput
            v-model="filter.keyword"
            placeholder="按学生姓名 / 行为搜索"
            size="sm"
            clearable
          />
        </label>
        <div class="filter-select">
          <AppSelect
            :model-value="filter.severity"
            :options="severityFilterOptions"
            size="sm"
            @update:model-value="filter.severity = $event as ViolationSeverity | 'all'"
          />
        </div>
        <AppButton v-if="filterActive" size="sm" variant="ghost" @click="clearFilters">
          清除筛选
        </AppButton>
      </div>
      <AppButton @click="openCreate">
        <Plus :size="16" :stroke-width="2" aria-hidden="true" />
        新增违纪记录
      </AppButton>
    </header>

    <!-- 没有数据：空状态 + 新增入口（不显示虚构统计） -->
    <AppCard v-if="totalEvents === 0" padding="none">
      <EmptyState
        title="还没有违纪记录"
        :description="`点击右上角「新增违纪记录」开始记录。每条事件独立保存，严重程度只作标签、不折算次数。`"
      >
        <AppButton @click="openCreate">新增第一条违纪记录</AppButton>
      </EmptyState>
    </AppCard>

    <template v-else>
      <!-- 概览 -->
      <ViolationOverviewPanel
        :overview="violationStore.overview"
        :ranking="violationStore.ranking"
        :frequent-students="violationStore.frequentStudents"
        :severe-events="violationStore.severeEvents"
        :behavior-counts="violationStore.behaviorCounts"
        @profile="openProfile"
        @view-event="openDetail"
      />

      <!-- 事件列表 -->
      <AppCard
        title="违纪事件列表"
        :subtitle="`共 ${events.length} 条${filterActive ? '（已按筛选条件过滤）' : ''}`"
      >
        <div v-if="events.length" class="event-list">
          <ViolationEventItem
            v-for="event in events"
            :key="event.id"
            :event="event"
            @view="openDetail"
            @edit="openEdit"
            @remove="askRemove"
            @profile="openProfile"
          />
        </div>
        <div v-else class="filtered-empty">
          <p class="filtered-empty__text">当前筛选条件下没有违纪事件。</p>
          <AppButton size="sm" variant="secondary" @click="clearFilters">清除筛选</AppButton>
        </div>
      </AppCard>

      <p v-if="violationStore.quarantinedCount > 0" class="quarantine-hint">
        另有 {{ violationStore.quarantinedCount }} 条来自更新版本的违纪记录，当前版本无法安全显示
        （数据已原样保留，升级后可见）。
      </p>
    </template>

    <!-- 新增 / 编辑 -->
    <ViolationFormModal v-model="formOpen" :event="editingEvent" @saved="onSaved" />

    <!-- 详情 -->
    <ViolationEventDetailModal
      v-model="detailOpen"
      :event="detailEvent"
      @edit="openEdit"
      @remove="askRemove"
      @profile="openProfile"
    />

    <!-- 个人档案 -->
    <ViolationProfileModal
      v-model="profileOpen"
      :student-id="profileStudentId"
      @view="openDetail"
      @edit="openEdit"
      @remove="askRemove"
      @open-photos="openPhotos"
    />

    <!-- 删除确认 -->
    <AppModal v-model="deleteOpen" title="删除违纪记录" :width="400">
      <p class="confirm-text">
        确定删除
        <strong>{{ deletingEvent?.studentName }}</strong>
        的「{{ deletingEvent?.behaviorLabel }}」记录吗？删除后无法恢复。
      </p>
      <template #footer>
        <AppButton variant="ghost" @click="deleteOpen = false">取消</AppButton>
        <AppButton variant="danger" @click="confirmRemove">删除记录</AppButton>
      </template>
    </AppModal>

    <!-- 历史照片（已退档学生也可查看） -->
    <StudentPhotoManager v-if="photoStudent" v-model="photoOpen" :student="photoStudent" />
  </div>
</template>

<style scoped>
.violations-page {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  max-width: var(--page-max-width);
}

.page-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.toolbar-filters {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  min-width: 0;
}

.search-wrap {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 200px;
  flex: 1;
  max-width: 320px;
  color: var(--color-text-tertiary);
}

.search-wrap :deep(.app-input) {
  flex: 1;
}

.filter-select {
  width: 132px;
}

.event-list {
  display: flex;
  flex-direction: column;
}

.filtered-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-6) 0;
}

.filtered-empty__text {
  font-size: var(--font-secondary);
  color: var(--color-text-tertiary);
}

.quarantine-hint {
  font-size: var(--font-caption);
  line-height: var(--leading-relaxed);
  color: var(--color-warning-strong);
}

.confirm-text {
  font-size: var(--font-secondary);
  line-height: var(--leading-relaxed);
  color: var(--color-text-secondary);
}

.confirm-text strong {
  color: var(--color-text-primary);
}

@media (max-width: 640px) {
  .page-toolbar {
    align-items: stretch;
  }

  .search-wrap {
    max-width: none;
  }

  .filter-select {
    width: calc(50% - var(--space-1));
  }
}
</style>
