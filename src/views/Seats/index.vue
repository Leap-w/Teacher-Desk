<script setup lang="ts">
import { computed, ref } from 'vue'

import { AppButton, AppCard, AppModal, AppSelect, EmptyState } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useStudentStore } from '@/stores/student'
import { useSeatStore } from '@/stores/seat'
import type { SeatPlan } from '@/types/seat'
import SeatClassroom from './components/SeatClassroom.vue'
import SeatPlanPanel from './components/SeatPlanPanel.vue'

type SeatView = 'teacher' | 'student'

/** 座位强调标记图例（颜色一律取自 theme.css，与 SeatClassroom 标记一致） */
const ACCENT_LEGEND = [
  { key: 'cadre', label: '班委', cls: 'is-cadre', dot: false },
  { key: 'tall', label: '高个', cls: 'is-tall', dot: false },
  { key: 'tag', label: '其他标签', cls: 'is-tag', dot: true },
] as const

const seatStore = useSeatStore()
const studentStore = useStudentStore()
const toast = useToast()

/** 教室参数唯一来源：store.config（即 DEFAULT_CLASSROOM_CONFIG），页面不另写教室数字 */
const config = seatStore.config

const view = ref<SeatView>('teacher')
const selectedSeatId = ref<string | undefined>(undefined)

const plans = computed(() => seatStore.plans)
const removingPlan = ref<SeatPlan | undefined>(undefined)
const confirmOpen = ref(false)

/** 学生查询表：座位图按 id 找学生（颜色 / 姓名 / 档案信息展示用） */
const studentMap = computed(
  () => new Map(studentStore.activeStudents.map((item) => [item.id, item])),
)

const planOptions = computed(() =>
  plans.value.map((plan) => ({ value: plan.id, label: plan.name })),
)

/** 页面副标题：教室配置 + 当前就座进度，全部来自 config */
const roomSummary = computed(() => {
  const blocks = config.blocks.join('-')
  return `${config.name} · ${config.rows} 排 × ${config.cols} 列 · 分列 ${blocks} · 已就座 ${seatStore.occupiedCount}/${config.occupiedSeats}`
})

/** 方案下拉：切换当前方案（目标是当前或不存在时由 store 拒绝并静默） */
const currentPlanId = computed<string>({
  get: () => seatStore.currentPlan?.id ?? '',
  set: (id: string) => {
    if (!id || id === seatStore.currentPlan?.id) return
    if (!seatStore.switchPlan(id)) {
      toast.danger('切换失败：该方案不存在，请刷新后重试')
      return
    }
    selectedSeatId.value = undefined
  },
})

/** 新建方案：自动命名并切换为当前；学生按 seatNumber 自动就座 */
function createPlan() {
  const plan = seatStore.createPlan()
  selectedSeatId.value = undefined
  toast.success(`已新建方案「${plan.name}」并切换为当前`)
}

function handleRename(planId: string, name: string) {
  if (!seatStore.renamePlan(planId, name)) {
    toast.danger('重命名失败：该方案不存在，请刷新后重试')
    return
  }
  toast.success(`方案已重命名为「${name}」`)
}

function askRemove(plan: SeatPlan) {
  removingPlan.value = plan
  confirmOpen.value = true
}

function confirmRemove() {
  const target = removingPlan.value
  removingPlan.value = undefined
  confirmOpen.value = false
  if (!target) return
  if (!seatStore.removePlan(target.id)) {
    toast.danger('删除失败：当前方案不可删除')
    return
  }
  toast.success(`已删除方案「${target.name}」`)
}

/** 点击座位：选中 / 再次点击取消选中（选中态跨视角保持，Phase 3B 在此选座） */
function onPickSeat(seatId: string) {
  selectedSeatId.value = selectedSeatId.value === seatId ? undefined : seatId
}
</script>

<template>
  <div class="seats-page">
    <header class="page-toolbar">
      <div>
        <h1 class="page-title">座位管理</h1>
        <p class="page-subtitle">{{ roomSummary }}</p>
      </div>
      <AppButton @click="createPlan">＋ 新建方案</AppButton>
    </header>

    <div class="toolbar-row">
      <div class="segmented" role="group" aria-label="教室视角">
        <button
          type="button"
          class="segmented-item"
          :class="{ 'is-active': view === 'teacher' }"
          @click="view = 'teacher'"
        >
          老师视角
        </button>
        <button
          type="button"
          class="segmented-item"
          :class="{ 'is-active': view === 'student' }"
          @click="view = 'student'"
        >
          学生视角
        </button>
      </div>

      <div class="plan-switch">
        <span class="plan-switch-label">当前方案</span>
        <AppSelect
          v-model="currentPlanId"
          class="plan-switch-select"
          :options="planOptions"
          :disabled="!plans.length"
        />
      </div>

      <ul class="legend" aria-label="座位标记图例">
        <li v-for="item in ACCENT_LEGEND" :key="item.key" class="legend-item">
          <i class="swatch" :class="[item.cls, { 'is-dot': item.dot }]" aria-hidden="true"></i>
          {{ item.label }}
        </li>
      </ul>
    </div>

    <div class="seats-layout">
      <AppCard padding="none" class="room-card">
        <SeatClassroom
          v-if="seatStore.currentPlan"
          :config="config"
          :seats="seatStore.currentSeats"
          :students="studentMap"
          :view="view"
          :selected-id="selectedSeatId"
          @select="onPickSeat"
        />
        <EmptyState
          v-else
          icon="🪑"
          title="暂无座位方案"
          description="点击右上角「＋ 新建方案」创建第一份排座方案。"
        >
          <AppButton size="sm" @click="createPlan">新建方案</AppButton>
        </EmptyState>
      </AppCard>

      <SeatPlanPanel
        class="plan-panel"
        :plans="plans"
        :occupied-seats="config.occupiedSeats"
        @create="createPlan"
        @select="currentPlanId = $event"
        @rename="handleRename"
        @remove="askRemove"
      />
    </div>

    <AppModal v-model="confirmOpen" title="删除座位方案" :width="380">
      <p class="confirm-text">
        确定删除座位方案
        <strong>{{ removingPlan ? removingPlan.name : '' }}</strong>
        吗？删除后无法恢复。
      </p>
      <template #footer>
        <AppButton variant="ghost" @click="confirmOpen = false">取消</AppButton>
        <AppButton variant="danger" @click="confirmRemove">删除方案</AppButton>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.seats-page {
  max-width: 1200px;
}

.page-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-5);
}

.page-title {
  font-size: var(--text-xl);
  font-weight: 700;
  letter-spacing: -0.3px;
}

.page-subtitle {
  margin-top: var(--space-1);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.toolbar-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
  margin-bottom: var(--space-5);
}

/* 视角切换（模式同学生页筛选分段控件） */
.segmented {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  background: var(--color-fill-disabled);
  border-radius: var(--radius-md);
}

.segmented-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  padding: 6px 14px;
  border-radius: 9px;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background var(--transition-fast),
    color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.segmented-item.is-active {
  background: var(--color-surface);
  color: var(--color-text);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}

.plan-switch {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.plan-switch-label {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.plan-switch-select {
  width: 190px;
}

.legend {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  list-style: none;
  margin-left: auto;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  white-space: nowrap;
}

/* 图例色块：横条（班委 / 高个）与圆点（其他标签）都取自 theme.css */
.swatch {
  width: 18px;
  height: 3px;
  border-radius: 999px;
}

.swatch.is-dot {
  width: 6px;
  height: 6px;
  background: var(--color-text-secondary);
}

.swatch.is-cadre {
  background: var(--color-primary-strong);
}

.swatch.is-tall {
  background: var(--color-warning);
}

.seats-layout {
  display: flex;
  align-items: flex-start;
  gap: var(--space-5);
}

.room-card {
  flex: 1;
  min-width: 0;
}

.plan-panel {
  width: 272px;
  flex-shrink: 0;
}

@media (max-width: 960px) {
  .seats-layout {
    flex-direction: column;
  }

  .plan-panel {
    width: 100%;
  }

  .legend {
    margin-left: 0;
  }
}

.confirm-text {
  font-size: var(--text-sm);
  line-height: 1.7;
  color: var(--color-text-secondary);
}

.confirm-text strong {
  color: var(--color-text);
}
</style>
