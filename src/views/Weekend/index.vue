<script setup lang="ts">
import { computed, ref } from 'vue'

import { AppButton, AppCard, AppModal, EmptyState } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useStudentStore } from '@/stores/student'
import { useWeekendStore } from '@/stores/weekend'
import { describeWeekend, formatWeekendLabel } from '@/utils/weekend'
import type { WeekendReturnRecord } from '@/types/weekend'
import WeekendReturnDrawer from './components/WeekendReturnDrawer.vue'
import SettingsEntryButton from '@/components/layout/SettingsEntryButton.vue'
import WeekendReturnRoster from './components/WeekendReturnRoster.vue'

const weekendStore = useWeekendStore()
const studentStore = useStudentStore()
const toast = useToast()

/**
 * 正在查看的周末：默认本周末。取一次快照而不是跟着 store 走——
 * 跨零点时「本周末」会翻篇，但教师正看着的那一期不该跟着跳走。
 */
const selected = ref(weekendStore.currentWeekend)

/** 在读学生的 id 列表：只用来给名单标注「已不在档案」，人数不从这里数 */
const activeIds = computed(() => studentStore.activeStudents.map((item) => item.id))

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
    <header class="page-toolbar">
      <div>
        <h1 class="page-title">周末管理</h1>
        <p class="page-subtitle">
          本周末返家 {{ weekendStore.currentCount }} 人 · 本月累计
          {{ weekendStore.monthReturnCount }} 人次
        </p>
      </div>
      <div class="toolbar-actions">
        <SettingsEntryButton module="weekend" />
        <AppButton @click="registerOpen = true">＋ 登记返家</AppButton>
      </div>
    </header>

    <!-- 周末切换条：手机横向滚动，PC 一行放得下 -->
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
          {{ describeWeekend(key, weekendStore.todayKey) || formatWeekendLabel(key) }}
        </span>
        <span class="chip-count">{{ weekendStore.returnedCountOf(key) }} 人</span>
      </button>
    </div>

    <div class="section-head">
      <h2 class="section-title">
        {{ selectedRelative || selectedLabel }}
        <span v-if="selectedRelative" class="section-date">{{ selectedLabel }}</span>
      </h2>
      <p class="section-sub">
        返家 {{ returnedCount }} 人 · 留校 {{ stayCount }} 人
        <span v-if="staleCount" class="section-note">
          （另有 {{ staleCount }} 条已不在档案的返家记录，仍列在下方）
        </span>
      </p>
    </div>

    <WeekendReturnRoster
      v-if="roster.length"
      :records="roster"
      :active-ids="activeIds"
      @remove="askRemove"
    />

    <AppCard v-else padding="none" class="empty-card">
      <EmptyState
        icon="🧳"
        title="这一期还没有登记返家"
        description="点击右上角「登记返家」，勾上这个周末回家的学生。没登记的学生即视为留校。"
      >
        <AppButton size="sm" @click="registerOpen = true">登记返家</AppButton>
      </EmptyState>
    </AppCard>

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
  max-width: 960px;
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

.weekend-strip {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-5);
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

.chip-name {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
}

.chip-count {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}

.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-bottom: var(--space-3);
}

.section-title {
  font-size: var(--text-md);
  font-weight: 600;
}

.section-date {
  margin-left: var(--space-2);
  font-weight: 400;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.section-sub {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.section-note {
  color: var(--color-text-faint);
}

.empty-card {
  padding: var(--space-6);
}

.confirm-text {
  font-size: var(--text-sm);
  line-height: 1.7;
  color: var(--color-text-secondary);
}

.confirm-text strong {
  color: var(--color-text);
}
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
  flex-wrap: wrap;
}
</style>
