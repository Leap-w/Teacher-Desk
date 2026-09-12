<script setup lang="ts">
import { computed, ref } from 'vue'

import { AppBadge, AppButton, AppCard, AppInput, EmptyState } from '@/components/ui'
import type { SeatPlan } from '@/types/seat'
import { Armchair } from 'lucide-vue-next'

interface Props {
  /** 全部座位方案（数组顺序即创建顺序） */
  plans: SeatPlan[]
  /** 可就座人数（即 config.occupiedSeats，展示用） */
  occupiedSeats: number
}

const props = defineProps<Props>()

const emit = defineEmits<{
  create: []
  select: [planId: string]
  rename: [planId: string, name: string]
  remove: [plan: SeatPlan]
}>()

/** 内联重命名状态：一次只编辑一个方案 */
const editingId = ref<string | undefined>(undefined)
const draft = ref('')

const cardSubtitle = computed(() => `共 ${props.plans.length} 个方案`)

/** 某方案的就座人数（Phase 3B 起无悬空座位：学生删除时 seat store 已自动释放） */
function occupiedOf(plan: SeatPlan): number {
  return plan.seats.filter((seat) => seat.studentId).length
}

/** 方案更新时间的展示文案；时间戳缺失或非法时不显示 */
function updatedLabel(plan: SeatPlan): string {
  const iso = plan.updatedAt || plan.createdAt
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return ` · 更新于 ${date.getMonth() + 1} 月 ${date.getDate()} 日`
}

function isEditing(planId: string): boolean {
  return editingId.value === planId
}

function startRename(plan: SeatPlan) {
  editingId.value = plan.id
  draft.value = plan.name
}

function cancelRename() {
  editingId.value = undefined
  draft.value = ''
}

/** 提交重命名：名称为空视为取消（与 AppInput trim 语义一致），由父级执行 store 并提示 */
function submitRename(planId: string, event?: KeyboardEvent) {
  if (event?.isComposing) return
  const name = draft.value.trim()
  if (!name) {
    cancelRename()
    return
  }
  emit('rename', planId, name)
  editingId.value = undefined
}
</script>

<template>
  <AppCard class="plan-panel" title="座位方案" :subtitle="cardSubtitle" padding="compact">
    <ul v-if="plans.length" class="plan-list" aria-label="座位方案列表">
      <li
        v-for="plan in plans"
        :key="plan.id"
        class="plan-item"
        :class="{ 'is-current': plan.isCurrent, 'is-editing': isEditing(plan.id) }"
        :aria-current="plan.isCurrent ? 'true' : undefined"
      >
        <div v-if="isEditing(plan.id)" class="plan-rename">
          <AppInput
            v-model="draft"
            class="plan-rename-input"
            size="sm"
            autofocus
            placeholder="方案名称"
            @keydown.enter.prevent="submitRename(plan.id, $event)"
            @keydown.esc.prevent="cancelRename"
          />
          <button
            class="icon-action is-confirm"
            type="button"
            aria-label="保存方案名称"
            title="保存"
            @click="submitRename(plan.id)"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </button>
          <button
            class="icon-action"
            type="button"
            aria-label="取消重命名"
            title="取消"
            @click="cancelRename"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <template v-else>
          <div class="plan-top">
            <div class="plan-title-row">
              <span class="plan-name">{{ plan.name }}</span>
              <AppBadge v-if="plan.isCurrent" size="sm" variant="primary">当前</AppBadge>
            </div>
            <div class="plan-actions" @click.stop>
              <button
                v-if="!plan.isCurrent"
                class="plan-link is-switch"
                type="button"
                title="切换为当前方案"
                @click="emit('select', plan.id)"
              >
                切换
              </button>
              <button class="plan-link" type="button" title="重命名方案" @click="startRename(plan)">
                重命名
              </button>
              <button
                v-if="!plan.isCurrent"
                class="plan-link is-danger"
                type="button"
                title="删除该历史方案"
                @click="emit('remove', plan)"
              >
                删除
              </button>
            </div>
          </div>
          <p class="plan-meta">
            就座 {{ occupiedOf(plan) }}/{{ occupiedSeats }}{{ updatedLabel(plan) }}
          </p>
        </template>
      </li>
    </ul>

    <EmptyState
      v-else
      :icon="Armchair"
      title="暂无座位方案"
      description="点击右上角「＋ 新建方案」创建第一份排座方案。"
    >
      <AppButton size="sm" @click="emit('create')">新建方案</AppButton>
    </EmptyState>

    <p class="plan-hint">
      方案仅保存在本机浏览器。新建方案时学生按档案座位号自动就座 1–62 号（第 63
      号尾座默认留空，可手动拖入）；拖拽换座只改当前方案，不改学生档案。当前方案不可删除。
    </p>
  </AppCard>
</template>

<style scoped>
.plan-panel {
  width: 100%;
}

.plan-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  list-style: none;
}

.plan-item {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  transition:
    border-color var(--transition-fast),
    background var(--transition-fast);
}

.plan-item.is-current {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
}

.plan-item.is-editing {
  border-color: var(--color-primary);
}

.plan-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.plan-title-row {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.plan-name {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plan-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

/* 行内轻量操作按钮（惯例同 segmented 自定义按钮） */
.plan-link {
  border: none;
  border-radius: 7px;
  background: transparent;
  padding: 4px 8px;
  font-size: var(--text-sm);
  cursor: pointer;
  transition:
    background var(--transition-fast),
    color var(--transition-fast);
}

.plan-link:hover {
  background: var(--color-fill-disabled);
  color: var(--color-text);
}

.plan-link:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.plan-link.is-switch {
  color: var(--color-primary-strong);
  font-weight: 600;
}

.plan-link.is-switch:hover {
  background: var(--color-primary-soft);
}

.plan-link.is-danger {
  color: var(--color-danger-strong);
}

.plan-link.is-danger:hover {
  background: var(--color-danger-soft);
  color: var(--color-danger-strong);
}

.plan-meta {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  line-height: 1.4;
}

/* 内联重命名 */
.plan-rename {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.plan-rename-input {
  flex: 1;
  min-width: 0;
}

.icon-action {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background var(--transition-fast),
    color var(--transition-fast);
}

.icon-action:hover {
  background: var(--color-fill-disabled);
  color: var(--color-text);
}

.icon-action.is-confirm {
  color: var(--color-primary-strong);
}

.icon-action.is-confirm:hover {
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
}

.icon-action:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.icon-action svg {
  width: 13px;
  height: 13px;
}

.plan-hint {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
  font-size: var(--text-xs);
  line-height: 1.7;
  color: var(--color-text-faint);
}
</style>
