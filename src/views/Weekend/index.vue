<script setup lang="ts">
import { computed, ref } from 'vue'

import { AppButton, AppModal } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useDutyStore } from '@/stores/duty'
import { useStudentStore } from '@/stores/student'
import { useWeekendStore } from '@/stores/weekend'
import { describeWeekend, formatWeekendLabel } from '@/utils/weekend'
import { FAMILY_SCOPE_LABELS, familyScopeLabel } from '@/utils/student'
import type { FamilyScope } from '@/types'
import type { WeekendReturnRecord } from '@/types/weekend'
import CurrentReturnList from './components/CurrentReturnList.vue'
import RegionSummary from './components/RegionSummary.vue'
import type { RegionStat } from './components/RegionCard.vue'
import WeekendHero from './components/WeekendHero.vue'
import WeekendStats from './components/WeekendStats.vue'
import WeekendTimeline from './components/WeekendTimeline.vue'
import type { WeekendTimelineEvent } from './components/WeekendTimeline.vue'
import WeekendReturnDrawer from './components/WeekendReturnDrawer.vue'
import SettingsEntryButton from '@/components/layout/SettingsEntryButton.vue'

/**
 * 周末返校中心（V2.0.7-alpha · Phase UI-4E，Return First）：
 * 打开页面第一眼 = 这一期谁返家（人不在校）、谁留校；地区分布联动筛选是班主任特色；
 * 登记入口在页头。数据模型只记「学生 × 周末是否返家」——离校 / 返校时刻、手机交接
 * 在数据模型中不存在，不发明假事件。
 */
const weekendStore = useWeekendStore()
const studentStore = useStudentStore()
const dutyStore = useDutyStore()
const toast = useToast()

/**
 * 正在查看的周末：默认本周末。取一次快照而不是跟着 store 走——
 * 跨零点时「本周末」会翻篇，但教师正看着的那一期不该跟着跳走。
 */
const selected = ref(weekendStore.currentWeekend)

/** **完整**名单（含已退档学生的历史记录，由名单组件标注后照常列出） */
const roster = computed(() => weekendStore.listReturns(selected.value))

/**
 * 返家 / 留校 / 已不在档案的条数都问 store，页面不再自己数一遍（Phase 8 上收）：
 * 「只算在读」这条口径若在两处各实现一次，改一处就会留下另一处（§11.1）。
 * 注：留校人数是派生的（在读人数 − 这一期仍在读的返家人数），不落库（§2.2 只有「返家」是事实）。
 */
const returnedCount = computed(() => weekendStore.returnedCountOf(selected.value))
const stayCount = computed(() => weekendStore.stayCountOf(selected.value))
const staleCount = computed(() => weekendStore.staleCountOf(selected.value))

const selectedLabel = computed(() => formatWeekendLabel(selected.value))
const selectedRelative = computed(() => describeWeekend(selected.value, weekendStore.todayKey))

/* ---------- 学生 / 值日组只读查表（地区 / 第几组展示用） ---------- */

const studentById = computed(
  () => new Map(studentStore.activeStudents.map((item) => [item.id, item])),
)

const dutyGroupNames = computed(() => {
  const map = new Map<string, string>()
  for (const group of dutyStore.groups) {
    for (const id of group.studentIds) {
      if (!map.has(id)) map.set(id, group.name)
    }
  }
  return map
})

/** 学生 id → 家庭地区文案（在读学生；只读展示） */
const regionNames = computed(() => {
  const map = new Map<string, string>()
  for (const [id, student] of studentById.value) {
    const label = familyScopeLabel(student.familyLocation)
    if (label) map.set(id, label)
  }
  return map
})

/* ---------- 地区联动筛选（昌都市区 / 其他县 / 市外；家庭地区算法不改，只做只读分组） ---------- */

const regionFilter = ref<FamilyScope | undefined>(undefined)

const regionStats = computed<RegionStat[]>(() => {
  const counts = new Map<FamilyScope, number>()
  for (const record of roster.value) {
    const scope = studentById.value.get(record.studentId)?.familyLocation?.scope
    if (scope) counts.set(scope, (counts.get(scope) ?? 0) + 1)
  }
  return (Object.keys(FAMILY_SCOPE_LABELS) as FamilyScope[]).map((scope) => ({
    scope,
    label: FAMILY_SCOPE_LABELS[scope],
    count: counts.get(scope) ?? 0,
    active: regionFilter.value === scope,
  }))
})

/** 地区筛选后的名单（已不在档案的记录不受地区筛选影响，始终保留展示） */
const filteredRoster = computed(() => {
  if (!regionFilter.value) return roster.value
  return roster.value.filter(
    (record) =>
      studentById.value.get(record.studentId)?.familyLocation?.scope === regionFilter.value,
  )
})

const regionFilterLabel = computed(() =>
  regionFilter.value ? FAMILY_SCOPE_LABELS[regionFilter.value] : undefined,
)

/* ---------- Layer 4：登记时间轴（createdAt 派生，新 → 旧） ---------- */

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const timelineEvents = computed<WeekendTimelineEvent[]>(() =>
  [...roster.value]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((record) => ({
      id: record.id,
      studentName: record.studentName,
      timeLabel: timeFormatter.format(new Date(record.createdAt)),
    })),
)

const stats = computed(() => ({
  returnedCount: returnedCount.value,
  stayCount: stayCount.value,
  staleCount: staleCount.value,
  monthCount: weekendStore.monthReturnCount,
}))

const createdAtLabels = computed(() => {
  const map = new Map<string, string>()
  for (const record of roster.value) {
    const date = new Date(record.createdAt)
    if (!Number.isNaN(date.getTime())) map.set(record.id, timeFormatter.format(date))
  }
  return map
})

/* ---------- 登记返家 ---------- */

const registerOpen = ref(false)

function onSubmit(payload: { weekendKey: string; studentIds: string[] }) {
  const added = weekendStore.addReturns(payload.weekendKey, payload.studentIds)
  if (added === 0) {
    // 0 只表示「一条也没加」，不含原因（都登记过了 / 名单里混进了已删除的学生），
    // 所以文案不断言是哪一个（store 的 addReturns 注释有说明）
    toast.danger('没有新增登记：这几位要么这个周末已经登记过，要么已不在档案中')
    return
  }
  registerOpen.value = false
  // 跳到刚登记的那一期：教师的下一步就是核对这份名单
  selected.value = payload.weekendKey
  toast.success(`已登记 ${added} 人返家（${formatWeekendLabel(payload.weekendKey)}）`)
}

/* ---------- 撤销登记（二次确认） ---------- */

const confirmOpen = ref(false)
/**
 * 删除目标。**确认后不清空**（同请假页）：弹窗关闭有淡出动画，动画期间它仍在渲染，
 * 清掉会让姓名先变空再消失（§9.8 记录项）。下次打开时覆盖。
 */
const removing = ref<WeekendReturnRecord | undefined>(undefined)

function askRemove(record: WeekendReturnRecord) {
  removing.value = record
  confirmOpen.value = true
}

function confirmRemove() {
  const target = removing.value
  confirmOpen.value = false
  if (!target) return
  if (!weekendStore.removeReturn(target.id)) {
    toast.danger('撤销失败：该记录可能已被移除')
    return
  }
  toast.success(`已撤销 ${target.studentName} 的返家登记`)
  // 撤掉的若是这一期最后一条记录，这一期就从切换条上消失了（weekendKeys 只列有记录的周末 ∪ 本周 / 下周）。
  // 不回落的话，「正在看的期次」会变成一个切换条里不存在的键：没有高亮、也切不回去（§9.17 审查修复）
  if (!weekendStore.weekendKeys.includes(selected.value)) {
    selected.value = weekendStore.currentWeekend
  }
}
</script>

<template>
  <div class="weekend-page">
    <header class="page-head">
      <div>
        <h1 class="page-title">周末管理</h1>
        <p class="page-subtitle">本月累计 {{ weekendStore.monthReturnCount }} 人次</p>
      </div>
      <div class="head-actions">
        <SettingsEntryButton module="weekend" />
      </div>
    </header>

    <!-- ===== Layer 1：返校状态 Hero（Return First 视觉中心） ===== -->
    <WeekendHero
      :relative-label="selectedRelative"
      :period-label="selectedLabel"
      :returned-count="returnedCount"
      :stay-count="stayCount"
      @register="registerOpen = true"
    />

    <!-- 期次切换条（手机横向滚动，PC 一行放得下） -->
    <div class="weekend-strip" role="group" aria-label="切换周末">
      <button
        v-for="key in weekendStore.weekendKeys"
        :key="key"
        type="button"
        class="weekend-chip"
        :class="{ 'is-active': key === selected }"
        :aria-pressed="key === selected"
        @click="selected = key"
      >
        <span class="chip-name">
          {{ describeWeekend(key, weekendStore.todayKey) }}
        </span>
        <span class="chip-count">{{ weekendStore.returnedCountOf(key) }} 人</span>
      </button>
    </div>

    <!-- ===== Layer 2：概览统计 ===== -->
    <section class="layer-section">
      <WeekendStats :stats="stats" />
    </section>

    <!-- ===== Layer 3：地区分布（点击联动筛选） + 本期返家名单 ===== -->
    <section class="layer-section">
      <h2 class="layer-title">家庭地区分布</h2>
      <RegionSummary
        :stats="regionStats"
        :selected="regionFilter"
        @select="regionFilter = regionFilter === $event ? undefined : ($event as FamilyScope)"
      />
    </section>

    <section class="layer-section">
      <h2 class="layer-title">
        本期返家名单<span v-if="regionFilterLabel" class="title-filter"
          >（{{ regionFilterLabel }}）</span
        >
        <span class="title-sub">{{ selectedRelative || selectedLabel }}</span>
      </h2>
      <CurrentReturnList
        :records="filteredRoster"
        :region-names="regionNames"
        :duty-group-names="dutyGroupNames"
        :created-at-labels="createdAtLabels"
        :region-label="regionFilterLabel"
        @remove="askRemove"
      />
      <p v-if="staleCount" class="stale-note">
        另有 {{ staleCount }} 条已不在档案的返家记录
        <template v-if="regionFilter">（可能被地区筛选隐藏）</template>，撤销后即从名单移除。
      </p>
    </section>

    <!-- ===== Layer 4：登记时间轴（本期，新 → 旧） ===== -->
    <section class="layer-section">
      <h2 class="layer-title">登记时间轴</h2>
      <div class="panel">
        <WeekendTimeline v-if="timelineEvents.length" :events="timelineEvents" />
        <p v-else class="panel-empty">这一期还没有登记记录。</p>
      </div>
    </section>

    <WeekendReturnDrawer
      v-model="registerOpen"
      :default-weekend-key="selected"
      @submit="onSubmit"
    />

    <AppModal v-model="confirmOpen" title="撤销返家登记" :width="380">
      <p class="confirm-text">
        确定撤销
        <strong>{{ removing ? removing.studentName : '' }}</strong>
        在
        <strong>{{ removing ? formatWeekendLabel(removing.weekendDate) : '' }}</strong>
        的返家登记吗？撤销后这位学生即视为留校。
      </p>
      <template #footer>
        <AppButton variant="ghost" @click="confirmOpen = false">取消</AppButton>
        <AppButton variant="danger" @click="confirmRemove">撤销登记</AppButton>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.weekend-page {
  max-width: var(--page-max-width);
}

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--spacing-lg);
}

.page-title {
  font-size: var(--font-h2);
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.01em;
  color: var(--color-text-primary);
}

.page-subtitle {
  margin-top: var(--space-1);
  font-size: var(--font-secondary);
  color: var(--color-text-tertiary);
}

.head-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.weekend-strip {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-4);
  padding-bottom: var(--space-1);
  overflow-x: auto;
}

.weekend-chip {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  flex: 0 0 auto;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast);
}

.weekend-chip:hover {
  background: var(--color-fill-disabled);
}

.weekend-chip.is-active {
  background: var(--color-primary-soft);
  border-color: var(--color-primary);
}

.weekend-chip:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.chip-name {
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  white-space: nowrap;
}

.chip-count {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}

.layer-section {
  margin-top: var(--section-gap);
}

.layer-title {
  margin-bottom: var(--spacing-md);
  font-size: var(--text-xl);
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.01em;
  color: var(--color-text-primary);
}

.title-filter {
  color: var(--color-primary-dark);
}

.title-sub {
  margin-left: var(--space-2);
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-normal);
  color: var(--color-text-tertiary);
}

.stale-note {
  margin-top: var(--space-3);
  font-size: var(--font-caption);
  color: var(--color-text-faint);
}

.panel {
  padding: var(--spacing-card);
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
}

.panel-empty {
  padding: var(--space-4) 0;
  text-align: center;
  font-size: var(--font-secondary);
  color: var(--color-text-tertiary);
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
