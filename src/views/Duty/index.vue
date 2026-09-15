<script setup lang="ts">
import { computed, ref } from 'vue'

import { AppButton, AppModal } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useNow } from '@/composables/useToday'
import { useDutyStore } from '@/stores/duty'
import { useStudentStore } from '@/stores/student'
import {
  formatDateOnly,
  formatMonthDay,
  formatWeekdayLabel,
  isWeekendDateKey,
  weekdayOfDateKey,
} from '@/utils/date'
import { WEEKDAY_LABELS } from '@/utils/timetable'
import DutyGroupCard from './components/DutyGroupCard.vue'
import DutyGroupEditModal from './components/DutyGroupEditModal.vue'
import DutyHero from './components/DutyHero.vue'
import DutyImportModal from './components/DutyImportModal.vue'
import DutyRotationPanel from './components/DutyRotationPanel.vue'
import DutyStats from './components/DutyStats.vue'
import DutyTimeline from './components/DutyTimeline.vue'
import type { DutyTimelineEntry } from './components/DutyTimeline.vue'
import TodayDutyList from './components/TodayDutyList.vue'
import SettingsEntryButton from '@/components/layout/SettingsEntryButton.vue'
import type { DutyGroup, DutySettings } from '@/types/duty'
import type { DutyDay } from '@/utils/duty'

const dutyStore = useDutyStore()
const studentStore = useStudentStore()
const toast = useToast()
const now = useNow()

/** 今天（与工作台、课表同一个共享时钟；跨零点自动翻篇） */
const todayLabel = computed(() => `${formatDateOnly(now.value)} ${formatWeekdayLabel(now.value)}`)

/**
 * 今天按设置不值日（周末不排）。**必须先有值日组**：一个组都没有时说「今天不值日」
 * 会把「还没建组」这件事盖过去，同一屏上的两张卡片各说各话。
 */
const weekendSkipped = computed(
  () =>
    dutyStore.groups.length > 0 &&
    !dutyStore.settings.includeWeekend &&
    isWeekendDateKey(dutyStore.todayKey),
)

/** 有组但还没设起点日期：轮换没有基准，页面统一提示去「轮换设置」补上（不在每张卡片各说一遍） */
const needsSetup = computed(() => dutyStore.groups.length > 0 && !dutyStore.settings.startDate)

/** 页头副标题：还没有组时先讲下一步，别把一个空轮换口径端出来 */
const pageSubtitle = computed(() =>
  dutyStore.groups.length === 0 ? '先建好值日组，轮换会自动排起来' : dutyStore.rotationSummary,
)

const todayMembers = computed(() =>
  dutyStore.todayGroup ? dutyStore.membersOf(dutyStore.todayGroup) : [],
)

/* ---------- Today First：概览统计与轮换时间轴（全部真实派生） ---------- */

const stats = computed(() => {
  let missing = 0
  const seen = new Set<string>()
  for (const group of dutyStore.groups) {
    for (const member of dutyStore.membersOf(group)) {
      if (!member.active && !seen.has(member.id)) {
        seen.add(member.id)
        missing += 1
      }
    }
  }
  return {
    todayMemberCount: todayMembers.value.length,
    groupCount: dutyStore.groups.length,
    upcomingDays: timelineEntries.value.filter((entry) => entry.group).length,
    missingMembers: missing,
  }
})

/** 近 7 天轮换时间轴（含今天；不值日的日子也列出，明确「这天轮空」） */
const timelineEntries = computed<DutyTimelineEntry[]>(() =>
  dutyStore.upcomingDays.map((day: DutyDay) => ({
    dateKey: day.dateKey,
    label: `${formatMonthDay(day.dateKey)} ${WEEKDAY_LABELS[weekdayOfDateKey(day.dateKey)]}`,
    group: day.group
      ? { name: day.group.name, memberCount: dutyStore.membersOf(day.group).length }
      : undefined,
    isToday: day.dateKey === dutyStore.todayKey,
  })),
)

/**
 * 成员选择器的候选名单：在读学生在前（按学号升序），已不在档案的排在后面并标注——
 * 他们仍留在组里（值日编排不随学生删除悄悄改动），教师可以在这里把他们取消勾选。
 */
const pickerStudents = computed(() => {
  const byStudentNo = (a: { studentNo: string }, b: { studentNo: string }) =>
    a.studentNo.localeCompare(b.studentNo)
  const activeIds = new Set(studentStore.activeStudents.map((item) => item.id))
  const active = [...studentStore.activeStudents].sort(byStudentNo)
  const archived = studentStore.students.filter((item) => !activeIds.has(item.id)).sort(byStudentNo)
  return [...active, ...archived]
})

const activeIds = computed(() => studentStore.activeStudents.map((item) => item.id))

/* ---------- 新建 / 编辑值日组 ---------- */

const groupModalOpen = ref(false)
const editing = ref<DutyGroup | undefined>(undefined)

function openCreate(): void {
  editing.value = undefined
  groupModalOpen.value = true
}

function openEdit(group: DutyGroup): void {
  editing.value = group
  groupModalOpen.value = true
}

/** 写入成功后才关弹窗：被拒时弹窗与已勾选的学生都留着，教师改一改即可重试 */
function onSubmitGroup(payload: { name: string; studentIds: string[] }): void {
  const current = editing.value
  if (current) {
    const updated = dutyStore.updateGroup(current.id, payload)
    if (!updated) {
      toast.danger('保存失败：组名不能为空，或该组已被删除')
      return
    }
    groupModalOpen.value = false
    toast.success(`已更新「${updated.name}」`)
    return
  }
  const created = dutyStore.addGroup(payload.name, payload.studentIds)
  if (!created) {
    toast.danger('保存失败：组名不能为空')
    return
  }
  groupModalOpen.value = false
  toast.success(
    dutyStore.groups.length === 1
      ? `已创建「${created.name}」，并把今天设为轮换起点`
      : `已创建「${created.name}」`,
  )
}

/* ---------- 删除值日组（二次确认） ---------- */

const removeOpen = ref(false)

/**
 * 待删除的值日组 + 弹窗要说的三件事，**打开时一次算好**。
 * 关闭（含删除成功）时不清空、也不用 computed：弹窗有淡出动画、动画期间仍在渲染，
 * 而删除成功会当场改掉 groups——拿实时状态算的话，组名与「顺延到哪一组」会在淡出中途
 * 变空 / 消失（§9.8 记录项）。下次打开时整体覆盖。
 */
const removing = ref<
  { group: DutyGroup; successorName: string; isAnchor: boolean; hasSiblings: boolean } | undefined
>(undefined)

function askRemove(group: DutyGroup): void {
  removing.value = {
    group,
    // 与 store 的实际行为同源（rotationSuccessorOf），弹窗里提前把话说明白
    successorName: dutyStore.rotationSuccessorOf(group.id)?.name ?? '',
    isAnchor: dutyStore.settings.startGroupId === group.id,
    // 组数也要冻住：删除成功后 groups 当场少一个，实时读的话「后面的日子会重新排过」
    // 这句会在淡出中途凭空消失（同 §9.8 的变空，只是少一行字）
    hasSiblings: dutyStore.groups.length > 1,
  }
  removeOpen.value = true
}

function confirmRemove(): void {
  const target = removing.value
  removeOpen.value = false
  if (!target) return
  const successor = dutyStore.rotationSuccessorOf(target.group.id)
  if (!dutyStore.removeGroup(target.group.id)) {
    toast.danger('删除失败：该组可能已被删除')
    return
  }
  toast.success(
    target.isAnchor && successor
      ? `已删除「${target.group.name}」，轮换起点顺延到「${successor.name}」`
      : `已删除「${target.group.name}」`,
  )
}

/* ---------- 轮换设置 ---------- */

function onRotationChange(patch: Partial<Omit<DutySettings, 'id' | 'kind'>>): void {
  if (!dutyStore.setRotation(patch)) {
    toast.danger('没有保存：起点日期要在 2000–2099 年之间，起点组要在现有值日组里')
    return
  }
  // 清空日期 = 轮换暂停（起点是轮换唯一的基准），说清楚它停在哪，别让教师以为排班坏了
  if (patch.startDate === '') {
    toast.warning('已清空起点日期，轮换暂停；重新选好日期就会继续')
    return
  }
  toast.success('轮换设置已更新')
}

/* ---------- Excel 批量导入（V1.1.5：分组 / 安排） ---------- */

const importOpen = ref(false)
const importMode = ref<'groups' | 'arrange'>('groups')

function openImport(mode: 'groups' | 'arrange'): void {
  importMode.value = mode
  importOpen.value = true
}
</script>

<template>
  <div class="duty-page">
    <header class="page-head">
      <div>
        <h1 class="page-title">值日管理</h1>
        <p class="page-subtitle">{{ pageSubtitle }}</p>
      </div>
      <div class="head-actions">
        <SettingsEntryButton module="duty" />
        <AppButton variant="secondary" @click="openImport('groups')">导入分组</AppButton>
        <AppButton variant="secondary" @click="openImport('arrange')">导入安排</AppButton>
        <AppButton @click="openCreate">＋ 新建值日组</AppButton>
      </div>
    </header>

    <!-- ===== Layer 1：今日值日 Hero（Today First 视觉中心） ===== -->
    <DutyHero
      :group="dutyStore.todayGroup"
      :members="todayMembers"
      :date-label="todayLabel"
      :weekday-label="formatWeekdayLabel(now)"
      :weekend-skipped="weekendSkipped"
      :needs-setup="needsSetup"
      @create="openCreate"
    />

    <!-- ===== Layer 2：今日概览 ===== -->
    <section class="layer-section">
      <DutyStats :stats="stats" />
    </section>

    <!-- ===== Layer 3：今日名单 | 轮换时间轴（桌面双列） ===== -->
    <div class="lower-grid">
      <section class="layer-section">
        <h2 class="layer-title">今日名单</h2>
        <TodayDutyList :members="todayMembers" :group-name="dutyStore.todayGroup?.name ?? ''" />
      </section>

      <section class="layer-section">
        <h2 class="layer-title">轮换安排（近 7 天）</h2>
        <div class="panel">
          <DutyTimeline v-if="dutyStore.groups.length > 0" :entries="timelineEntries" />
          <p v-else class="panel-empty">建好值日组后，这里会显示按天轮换的安排。</p>
        </div>
      </section>
    </div>

    <!-- ===== Layer 4：值日组管理 + 轮换设置（低频配置，放最底） ===== -->
    <section v-if="dutyStore.groups.length > 0" class="layer-section">
      <h2 class="layer-title">值日组（轮换顺序）</h2>
      <div class="group-list">
        <DutyGroupCard
          v-for="group in dutyStore.groups"
          :key="group.id"
          :group="group"
          :members="dutyStore.membersOf(group)"
          :anchor="group.id === dutyStore.settings.startGroupId"
          @edit="openEdit"
          @remove="askRemove"
        />
      </div>
    </section>

    <!-- 没有组时轮换设置无处可设（起点组的下拉是空的），整块隐藏：空页面上只留一条清晰的下一步 -->
    <section v-if="dutyStore.groups.length > 0" class="layer-section">
      <h2 class="layer-title">轮换设置</h2>
      <DutyRotationPanel
        :settings="dutyStore.settings"
        :groups="dutyStore.groups"
        :summary="dutyStore.rotationSummary"
        :misaligned="dutyStore.rotationMisaligned"
        @change="onRotationChange"
      />
    </section>

    <DutyGroupEditModal
      v-model="groupModalOpen"
      :group="editing"
      :students="pickerStudents"
      :active-ids="activeIds"
      :groups="dutyStore.groups"
      @submit="onSubmitGroup"
    />

    <!-- Excel 批量导入（分组 / 安排共用一个弹窗，按 mode 切换管道） -->
    <DutyImportModal v-model="importOpen" :mode="importMode" />

    <AppModal v-model="removeOpen" title="删除值日组" :width="380">
      <p class="confirm-text">
        确定删除
        <strong>{{ removing ? removing.group.name : '' }}</strong>
        吗？组名与组员编排会一起删除（学生档案不受影响）。
      </p>
      <p v-if="removing && removing.isAnchor && removing.successorName" class="confirm-text">
        这一组是当前的轮换起点，删除后轮换会顺延到「{{ removing.successorName }}」。
      </p>
      <p v-if="removing && removing.hasSiblings" class="confirm-text">
        删除后组数变少，后面的日子会重新排过（顺序为上方列表的先后）。
      </p>
      <template #footer>
        <AppButton variant="ghost" @click="removeOpen = false">取消</AppButton>
        <AppButton variant="danger" @click="confirmRemove">删除</AppButton>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.duty-page {
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
  flex-wrap: wrap;
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

/* Layer 3：今日名单 | 轮换时间轴（桌面双列）；iPad/手机单列 */
.lower-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--section-gap);
}

@media (min-width: 900px) {
  .lower-grid {
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  }
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

.group-list {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-3);
}

@media (min-width: 760px) {
  .group-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.confirm-text {
  font-size: var(--text-sm);
  line-height: 1.7;
  color: var(--color-text-secondary);
}

.confirm-text + .confirm-text {
  margin-top: var(--space-2);
}

.confirm-text strong {
  color: var(--color-text);
}
</style>
