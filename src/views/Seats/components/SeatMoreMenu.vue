<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ChevronDown, GitCompare, Sparkles } from 'lucide-vue-next'

import type { LucideIcon } from 'lucide-vue-next'

/**
 * SeatMoreMenu — 座位页的「更多」菜单（v3.3.0）。
 *
 * 工具栏改三层后，一排里只留得下最高频的几个动作（设置 / 约束 / 导入 / 导出）。
 * 自动排座与方案对比**都是真功能**（Phase 3D / Phase 3C 交付，各有自己的弹窗与撤销），
 * 所以按需求「未实现才删」的原则不删——但也不必常驻占位，
 * 收进这个菜单：仍然一点可达，工具栏不再是一排按钮。
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
]

/** 两个动作的对外契约（父级据此分发） */
export type SeatMoreAction = 'arrange' | 'compare'

const props = defineProps<{
  /** 自动排座是否可用（无方案 / 无学生时不可用） */
  arrangeDisabled?: boolean
  /** 方案对比是否可用（不足两份方案时不可用） */
  compareDisabled?: boolean
}>()

const emit = defineEmits<{
  choose: [action: SeatMoreAction]
}>()

const open = ref(false)
const rootEl = ref<HTMLElement>()

function disabledOf(action: SeatMoreAction): boolean {
  return action === 'arrange' ? Boolean(props.arrangeDisabled) : Boolean(props.compareDisabled)
}

const allDisabled = computed(() => disabledOf('arrange') && disabledOf('compare'))

function toggle() {
  if (!allDisabled.value) open.value = !open.value
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
      :disabled="allDisabled"
      aria-haspopup="menu"
      :aria-expanded="open ? 'true' : 'false'"
      @click="toggle"
    >
      更多
      <ChevronDown :size="16" :stroke-width="2" aria-hidden="true" />
    </button>

    <ul v-if="open" class="more-list" role="menu">
      <li v-for="item in ITEMS" :key="item.key">
        <button
          type="button"
          class="more-item"
          role="menuitem"
          :disabled="disabledOf(item.key)"
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

.more-trigger:hover:not(:disabled) {
  border-color: var(--color-border-medium);
  color: var(--color-text-primary);
}

.more-trigger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
