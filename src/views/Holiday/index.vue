<script setup lang="ts">
import { computed, ref } from 'vue'
import { CalendarPlus, PartyPopper } from 'lucide-vue-next'

import { AppButton, AppModal, EmptyState } from '@/components/ui'
import SettingsEntryButton from '@/components/layout/SettingsEntryButton.vue'
import { useToast } from '@/composables/useToast'
import { useHolidayStore } from '@/stores/holiday'
import HolidayCard from './components/HolidayCard.vue'
import HolidayDetail from './components/HolidayDetail.vue'
import HolidayFormModal from './components/HolidayFormModal.vue'
import type { Holiday, HolidayInput } from '@/types/holiday'

/**
 * 假期管理（v3.6.1）—— 由 v3.6.0 的「周末管理」升级而来。
 *
 * 三件事在这一个页面里：
 * 1. **假期列表**：自定义假期与虚拟周末并列（周末的 `id` 由周六日期键派生，不落库）；
 * 2. **某个假期的详情**：三态统计 + 筛选 + 多选 + 批量登记 + 导出名单；
 * 3. **假期的增删改**（只有自定义假期可改可删）。
 *
 * 详情**不占独立路由**，是同一页里换上去的一屏（`selectedId` 有值即进详情）：
 * 刷新会回到列表。这是为「不给 CloudBase 静态托管多出一堆动态占位」付的代价（方案 §六.5），
 * 而详情本来就只在「刚登记完接着核对」这一个动作里停留。
 *
 * 登记时间轴（v3.6.0 及以前在周末页的那一屏）**已删**：它由 `createdAt` 现算，没有独立存储，
 * 删组件即等于删功能，历史记录本身一条不动。
 */
const holidayStore = useHolidayStore()
const toast = useToast()

/** 正在看的假期 id；undefined = 停在列表 */
const selectedId = ref<string | undefined>(undefined)

const entries = computed(() => holidayStore.entries)

/**
 * 当前详情项。**找不到就退回列表**——假期可能刚被别处删掉（跨标签页 / 云端合并），
 * 那时继续渲染一个已不存在的假期，屏幕上会是一份三态全是「未登记」的空名单。
 */
const selectedEntry = computed(() =>
  selectedId.value === undefined
    ? undefined
    : entries.value.find((entry) => entry.holiday.id === selectedId.value),
)

/* ---------- 新建 / 编辑 ---------- */

const formOpen = ref(false)
const editing = ref<Holiday | undefined>(undefined)

function askCreate(): void {
  editing.value = undefined
  formOpen.value = true
}

function askEdit(): void {
  const entry = selectedEntry.value
  if (!entry || entry.kind === 'weekend') return
  editing.value = entry.holiday
  formOpen.value = true
}

function onSubmit(payload: HolidayInput): void {
  const editingId = editing.value?.id
  if (editingId) {
    const updated = holidayStore.updateHoliday(editingId, payload)
    if (!updated) {
      toast.danger('保存失败：名称与起止日期不能为空')
      return
    }
    formOpen.value = false
    toast.success(`已保存「${updated.name}」`)
    return
  }

  const created = holidayStore.createHoliday(payload)
  if (!created) {
    toast.danger('创建失败：名称与起止日期不能为空')
    return
  }
  formOpen.value = false
  // 建完直接进详情：教师的下一步就是往这个假期里登记人（同「登记返家后跳到那一期」）
  selectedId.value = created.id
  toast.success(`已创建「${created.name}」`)
}

/* ---------- 删除（二次确认，文案带联带影响） ---------- */

const confirmOpen = ref(false)
/**
 * 待删除的假期。确认后**不清空**（同请假页）：弹窗关闭有淡出动画，动画期间它仍在渲染，
 * 清掉会让名字先变空再消失（§9.8 记录项）。下次打开时覆盖。
 */
const removing = ref<Holiday | undefined>(undefined)

/** 联带删除的登记数（实时算：弹窗开着的时候别处也可能在改） */
const cascade = computed(() =>
  removing.value ? holidayStore.cascadeCountOf(removing.value.id) : undefined,
)

function askRemove(): void {
  const entry = selectedEntry.value
  if (!entry || entry.kind === 'weekend') return
  removing.value = entry.holiday
  confirmOpen.value = true
}

function confirmRemove(): void {
  const target = removing.value
  confirmOpen.value = false
  if (!target) return
  if (!holidayStore.removeHoliday(target.id)) {
    toast.danger('删除失败：这个假期可能已经不在了')
    return
  }
  selectedId.value = undefined
  const removed = cascade.value?.total ?? 0
  toast.success(
    removed > 0 ? `已删除「${target.name}」及其 ${removed} 条登记` : `已删除「${target.name}」`,
  )
}

/* ---------- 孤儿登记 ---------- */

function clearOrphans(): void {
  const cleared = holidayStore.clearOrphans()
  if (cleared === 0) {
    toast.info('没有需要清理的登记')
    return
  }
  toast.success(`已清理 ${cleared} 条不属于任何假期的登记`)
}
</script>

<template>
  <div class="holiday-page">
    <!-- ================= 详情 ================= -->
    <HolidayDetail
      v-if="selectedEntry"
      :entry="selectedEntry"
      @back="selectedId = undefined"
      @edit="askEdit"
      @remove="askRemove"
    />

    <!-- ================= 列表 ================= -->
    <template v-else>
      <header class="page-head">
        <div>
          <h1 class="page-title">假期管理</h1>
          <p class="page-subtitle">本月累计 {{ holidayStore.monthHomeCount }} 人次回家</p>
        </div>
        <div class="head-actions">
          <AppButton size="sm" @click="askCreate">
            <CalendarPlus :size="15" :stroke-width="2" aria-hidden="true" />
            新建假期
          </AppButton>
          <SettingsEntryButton module="weekend" />
        </div>
      </header>

      <div v-if="entries.length" class="entry-list">
        <HolidayCard
          v-for="entry in entries"
          :key="entry.holiday.id"
          :entry="entry"
          :counts="holidayStore.countsOf(entry.holiday.id)"
          :today-key="holidayStore.todayKey"
          @select="selectedId = entry.holiday.id"
        />
      </div>

      <!-- 一个假期都没有：列表空态。理论上至少有两个虚拟周末，所以这条只在日历异常时出现 -->
      <div v-else class="entry-empty">
        <EmptyState
          :icon="PartyPopper"
          title="还没有任何假期"
          description="新建一个假期（如国庆、藏历新年），或者等这一周过完再来。"
        >
          <AppButton size="sm" @click="askCreate">新建假期</AppButton>
        </EmptyState>
      </div>

      <p v-if="holidayStore.orphanCount" class="orphan-note">
        另有 {{ holidayStore.orphanCount }} 条登记属于已不在列表的假期（可能是云端只同步到了一半）。
        <button type="button" class="orphan-link" @click="clearOrphans">清理</button>
      </p>
    </template>

    <HolidayFormModal v-model="formOpen" :holiday="editing" @submit="onSubmit" />

    <AppModal v-model="confirmOpen" title="删除假期" :width="380">
      <p class="confirm-text">
        确定删除
        <strong>{{ removing ? removing.name : '' }}</strong>
        吗？<template v-if="cascade && cascade.total > 0">
          <br />这个假期下的
          <strong>{{ cascade.total }}</strong>
          条登记记录（回家 {{ cascade.home }} · 留校 {{ cascade.stay }}）会一起删除。
        </template>
        <br />此操作不可撤销。
      </p>
      <template #footer>
        <AppButton variant="ghost" @click="confirmOpen = false">取消</AppButton>
        <AppButton variant="danger" @click="confirmRemove">删除</AppButton>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.holiday-page {
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

.entry-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.entry-empty {
  padding: var(--space-4) 0;
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
}

.orphan-note {
  margin-top: var(--spacing-lg);
  font-size: var(--font-caption);
  color: var(--color-text-faint);
}

.orphan-link {
  padding: 0;
  border: none;
  background: none;
  font-size: inherit;
  color: var(--color-primary-dark);
  text-decoration: underline;
  cursor: pointer;
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
