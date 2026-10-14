<script setup lang="ts">
import { computed, ref } from 'vue'
import { Plus } from 'lucide-vue-next'

import { AppButton, AppModal } from '@/components/ui'
import { useNow } from '@/composables/useToday'
import { useToast } from '@/composables/useToast'
import { useSubstituteStore } from '@/stores/substitute'
import type { SubstituteInput, SubstituteRecord } from '@/types/substitute'
import { formatDateKey, formatMonthDay } from '@/utils/date'
import { periodLabelOf } from '@/utils/timetable'
import SubstituteFilterBar from './components/SubstituteFilterBar.vue'
import SubstituteFormDrawer from './components/SubstituteFormDrawer.vue'
import SubstituteList from './components/SubstituteList.vue'
import SubstituteStats from './components/SubstituteStats.vue'

/**
 * 代课管理（v3.7.5 §6，挂在「工作管理」下的第三个子页）。
 *
 * 这是**独立的工作量台账**：登记「某天某节，某某老师的课由某某老师上」，
 * 用来统计谁代了几节。它**不是课程表的子功能**，与课程表 / 换课记录彻底隔离（§6.3）——
 * 本页所有写入都只经 `useSubstituteStore()`，那个 store 只读写自己的键
 * （`teacherdesk:substitutes`），不 import 课程表 store、不改 `Lesson`、不生成换课记录。
 *
 * 页面四层：统计 → 日期范围筛选 → 记录列表 → 右下角登记入口（与工作清单同一副骨架）。
 * 筛选是**纯界面状态**（`from` / `to` 两个 ref）：刷新即回到「不限」，
 * 不进 localStorage、不进备份、不推云端——它只是当下这一次的查看范围。
 */
const substituteStore = useSubstituteStore()
const toast = useToast()

/** 今天：新增记录的默认日期（共享时钟，跨零点自动翻篇） */
const now = useNow()
const today = computed(() => formatDateKey(now.value))

/* ---------- 日期范围筛选（两端都含，留空即该端不限） ---------- */

const from = ref('')
const to = ref('')

const hasRange = computed(() => Boolean(from.value || to.value))

/** 起止填反：此时列表与统计必然为空，但这不是「这段时间没有代课」，列表里会点名 */
const rangeReversed = computed(() => Boolean(from.value && to.value && from.value > to.value))

/** 筛选范围内的记录（已按日期倒序）——列表与统计共用这一份 */
const filtered = computed(() => substituteStore.listIn(from.value, to.value))

/** 筛选范围内的三档统计（实时算，与列表同一份数据） */
const summary = computed(() => substituteStore.summaryIn(from.value, to.value))

function clearRange(): void {
  from.value = ''
  to.value = ''
}

/* ---------- 新增 / 编辑 ---------- */

const formOpen = ref(false)
const editing = ref<SubstituteRecord | undefined>(undefined)

function openCreate(): void {
  editing.value = undefined
  formOpen.value = true
}

function openEdit(record: SubstituteRecord): void {
  editing.value = record
  formOpen.value = true
}

/** 写入成功后才关抽屉：被拒时抽屉与已填内容都留着，教师改一改即可重试 */
function onSubmit(payload: SubstituteInput): void {
  const current = editing.value
  if (current) {
    const updated = substituteStore.update(current.id, payload)
    if (!updated) {
      toast.danger('保存失败：请检查填写内容（五个必填项都要有值）')
      return
    }
    formOpen.value = false
    toast.success(`已更新 ${updated.date} 的代课记录`)
    return
  }
  const created = substituteStore.add(payload)
  if (!created) {
    toast.danger('保存失败：请检查填写内容（五个必填项都要有值）')
    return
  }
  formOpen.value = false
  toast.success(`已记录 ${created.date}：${created.originalTeacher} → ${created.substituteTeacher}`)
}

/* ---------- 删除（二次确认） ---------- */

const confirmOpen = ref(false)
const removing = ref<SubstituteRecord | undefined>(undefined)

/** 确认框里把那一条说清：日期 + 节次 + 谁替谁，避免删错同名同科的记录 */
const removingLabel = computed(() => {
  const record = removing.value
  if (!record) return ''
  return `${formatMonthDay(record.date)} ${periodLabelOf(record.periodId)}：${record.originalTeacher} → ${record.substituteTeacher}（${record.subject}）`
})

function askRemove(record: SubstituteRecord): void {
  removing.value = record
  confirmOpen.value = true
}

function confirmRemove(): void {
  const target = removing.value
  confirmOpen.value = false
  if (!target) return
  if (!substituteStore.remove(target.id)) {
    toast.danger('删除失败：这条记录可能已经被移除')
    return
  }
  toast.success(`已删除 ${formatMonthDay(target.date)} 的代课记录`)
}
</script>

<template>
  <div class="substitutes-page">
    <!-- ===== 统计（三档：总节数 / 按实际代课教师 / 按被代课教师） ===== -->
    <SubstituteStats :summary="summary" :filtered="hasRange" />

    <!-- ===== 日期范围筛选 ===== -->
    <SubstituteFilterBar
      :from="from"
      :to="to"
      @update:from="from = $event"
      @update:to="to = $event"
      @clear="clearRange"
    />

    <!-- ===== 记录列表 ===== -->
    <section class="layer-section">
      <h2 class="layer-title">代课记录</h2>
      <p class="layer-note">登记代课只记在这里：不改课程表，也不生成换课记录。</p>
      <SubstituteList
        :records="filtered"
        :has-any="substituteStore.count > 0"
        :range-reversed="rangeReversed"
        @edit="openEdit"
        @remove="askRemove"
      />
    </section>

    <!-- ===== 登记入口：FAB（与工作清单 / 请假记录同一位置、同一形态） ===== -->
    <button type="button" class="substitutes-fab" aria-label="记录代课" @click="openCreate">
      <Plus :size="22" :stroke-width="2" aria-hidden="true" />
      <span class="fab-label">记录代课</span>
    </button>

    <SubstituteFormDrawer
      v-model="formOpen"
      :record="editing"
      :default-date="today"
      @submit="onSubmit"
    />

    <AppModal v-model="confirmOpen" title="删除代课记录" :width="380">
      <p class="confirm-text">
        确定删除
        <strong>{{ removingLabel }}</strong>
        这条代课记录吗？此操作无法撤销。
      </p>
      <p class="confirm-note">只删这一条台账记录，课程表与换课记录不受影响。</p>
      <template #footer>
        <AppButton variant="ghost" @click="confirmOpen = false">取消</AppButton>
        <AppButton variant="danger" @click="confirmRemove">删除记录</AppButton>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.substitutes-page {
  max-width: var(--page-max-width);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding-bottom: var(--spacing-2xl);
}

.layer-section {
  margin-top: var(--space-2);
}

.layer-title {
  margin-bottom: var(--space-1);
  font-size: var(--text-xl);
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.01em;
  color: var(--color-text-primary);
}

.layer-note {
  margin-bottom: var(--spacing-md);
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

/* 登记入口 FAB：右下角，与工作清单 / 请假记录同一位置与形态 */
.substitutes-fab {
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

.substitutes-fab:hover {
  background: var(--color-primary-hover);
  transform: translateY(-2px);
  box-shadow: var(--shadow-xl);
}

.substitutes-fab:active {
  transform: scale(0.97);
}

.substitutes-fab:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.confirm-text {
  font-size: var(--text-sm);
  line-height: 1.7;
  color: var(--color-text-secondary);
}

.confirm-text strong {
  color: var(--color-text);
}

.confirm-note {
  margin-top: var(--space-2);
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}
</style>
