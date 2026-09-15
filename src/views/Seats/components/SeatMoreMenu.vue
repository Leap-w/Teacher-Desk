<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ChevronDown, Copy, GitCompare, PencilLine, Sparkles, Trash2 } from 'lucide-vue-next'

import type { LucideIcon } from 'lucide-vue-next'

/**
 * SeatMoreMenu — 座位页的「更多」菜单（v3.3.0 建；**v3.3.1 补齐方案动作**）。
 *
 * 工具栏改三层后，一排里只留得下最高频的几个动作（设置 / 约束 / 导入 / 导出）。
 * 这里收着两类动作，中间一条分隔线：
 *
 * ① **对这个班做什么**：自动排座（Phase 3D）、方案对比（Phase 3C）——
 *    都是真功能，各有自己的弹窗与撤销，按「未实现才删」的原则保留；
 * ② **对这份方案做什么**：重命名 / 复制 / 删除。**v3.3.1 补的三项**：
 *    重命名与删除原先只在「方案下拉 → 管理方案」里能点到（入口太深，教师找不到），
 *    复制方案则是全项目都没有——三者现在都作用于**当前方案**，一点即达。
 *
 * **触发器永远可点**（v3.3.1 修）：v3.3.0 在「所有动作都不可用」时把触发器整个禁用，
 * 那正是教师看到「点更多没反应」的另一种形态——按钮灰着，点了当然没反应。
 * 现在触发器恒亮，不可用的**条目**各自灰着并在悬停时说明原因（不要保留空按钮）。
 *
 * 结构与 `SeatExportMenu` 完全一致（同一个交互范式，不另立一套）：
 * 胶囊按钮 → 下拉列表项 → 交给父级执行，本组件不碰业务逻辑。
 */
const ITEMS: { key: SeatMoreAction; label: string; desc: string; icon: LucideIcon }[] = [
  {
    key: 'arrange',
    label: '自动排座',
    desc: '按约束与规则生成一份新方案',
    icon: Sparkles,
  },
  {
    key: 'compare',
    label: '方案对比',
    desc: '比较两份方案的座位差异（只读）',
    icon: GitCompare,
  },
  {
    key: 'rename',
    label: '重命名方案',
    desc: '给当前方案换个名字',
    icon: PencilLine,
  },
  {
    key: 'duplicate',
    label: '复制方案',
    desc: '复制当前方案（含约束）并切换过去',
    icon: Copy,
  },
  {
    key: 'remove',
    label: '删除方案',
    desc: '删除当前方案并切回另一份',
    icon: Trash2,
  },
]

/** 分隔线插在这两个动作之间（上：对这个班；下：对这份方案） */
const DIVIDER_BEFORE: SeatMoreAction = 'rename'

/** 全部动作的对外契约（父级据此分发） */
export type SeatMoreAction = 'arrange' | 'compare' | 'rename' | 'duplicate' | 'remove'

const props = defineProps<{
  /** 自动排座是否可用（无方案 / 无学生时不可用） */
  arrangeDisabled?: boolean
  /** 方案对比是否可用（不足两份方案时不可用） */
  compareDisabled?: boolean
  /** 重命名 / 复制是否可用（没有当前方案时不可用） */
  planDisabled?: boolean
  /** 删除当前方案是否可用（只剩一份方案时不可用——删完就没方案了） */
  removeDisabled?: boolean
}>()

const emit = defineEmits<{
  choose: [action: SeatMoreAction]
}>()

const open = ref(false)
const rootEl = ref<HTMLElement>()

function disabledOf(action: SeatMoreAction): boolean {
  if (action === 'arrange') return Boolean(props.arrangeDisabled)
  if (action === 'compare') return Boolean(props.compareDisabled)
  if (action === 'remove') return Boolean(props.removeDisabled)
  return Boolean(props.planDisabled)
}

/** 不可用时的悬停说明：让教师知道差什么，而不是对着灰按钮猜 */
function titleOf(action: SeatMoreAction): string {
  const item = ITEMS.find((entry) => entry.key === action)
  if (!disabledOf(action)) return item?.desc ?? ''
  if (action === 'arrange') return '需要先有一份座位方案，且学生档案里至少有一名学生'
  if (action === 'compare') return '至少要有两份座位方案才能对比'
  if (action === 'remove') return '至少保留一份方案（删除后会切回另一份）'
  return '当前没有座位方案'
}

function toggle() {
  open.value = !open.value
}

function choose(action: SeatMoreAction) {
  if (disabledOf(action)) return
  open.value = false
  emit('choose', action)
}

function onDocumentClick(event: MouseEvent) {
  if (open.value && rootEl.value && !rootEl.value.contains(event.target as Node)) {
    open.value = false
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="rootEl" class="more-menu">
    <button
      type="button"
      class="more-trigger"
      :class="{ 'is-open': open }"
      aria-haspopup="menu"
      :aria-expanded="open ? 'true' : 'false'"
      @click="toggle"
    >
      更多
      <ChevronDown :size="16" :stroke-width="2" aria-hidden="true" />
    </button>

    <ul v-if="open" class="more-list" role="menu">
      <template v-for="item in ITEMS" :key="item.key">
        <li v-if="item.key === DIVIDER_BEFORE" class="more-divider" role="separator" />
        <li>
          <button
            type="button"
            class="more-item"
            :class="{ 'is-danger': item.key === 'remove' }"
            role="menuitem"
            :disabled="disabledOf(item.key)"
            :title="titleOf(item.key)"
            @click="choose(item.key)"
          >
            <component
              :is="item.icon"
              class="more-item__icon"
              :size="20"
              :stroke-width="2"
              aria-hidden="true"
            />
            <span class="more-item__text">
              <span class="more-item__label">{{ item.label }}</span>
              <span class="more-item__desc">{{ item.desc }}</span>
            </span>
          </button>
        </li>
      </template>
    </ul>
  </div>
</template>

<style scoped>
.more-menu {
  position: relative;
}

/* 触发器与工具栏其余按钮同高（44px），并排时不参差 */
.more-trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: 44px;
  padding: 0 var(--space-4);
  border: var(--border-hairline-width) solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--bg-card);
  font-family: inherit;
  font-size: var(--font-content);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    border-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}

.more-trigger:hover,
.more-trigger.is-open {
  border-color: var(--color-border-medium);
  color: var(--color-text-primary);
}

.more-list {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: var(--z-dropdown, 400);
  min-width: 232px;
  margin: 0;
  padding: var(--space-1);
  list-style: none;
  border: var(--border-hairline-width) solid var(--color-border-light);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: var(--shadow-md);
}

.more-divider {
  height: 1px;
  margin: var(--space-1) var(--space-2);
  background: var(--color-border-light);
}

.more-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out);
}

.more-item:hover:not(:disabled) {
  background: var(--color-bg-subtle);
}

.more-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.more-item.is-danger .more-item__icon,
.more-item.is-danger .more-item__label {
  color: var(--color-danger-strong);
}

.more-item.is-danger:hover:not(:disabled) {
  background: var(--color-danger-soft);
}

.more-item__icon {
  flex-shrink: 0;
  color: var(--color-text-secondary);
}

.more-item__text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.more-item__label {
  font-size: var(--font-content);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.more-item__desc {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}
</style>
