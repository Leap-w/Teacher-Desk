<script setup lang="ts">
import { Search } from 'lucide-vue-next'

import { AppButton, AppInput, EmptyState } from '@/components/ui'
import type { StudentSortMode } from '@/utils/studentQuery'
import StudentFilterChips from './StudentFilterChips.vue'
import type { FilterChipOption, StudentFilterKey } from './StudentFilterChips.vue'
import StudentSummary from './StudentSummary.vue'
import type { ClassSummary } from './StudentSummary.vue'

/**
 * StudentHubSidebar — 学生中心左侧栏（V2.0.3-alpha · Phase UI-4A）：
 * 搜索（置顶）→ 快速筛选 Chips → 排序 → 班级概览统计。
 * 桌面（≥1024px）常驻 280px；小屏为抽屉（open 控制，遮罩点击关闭）。
 * 值日 / 周末管理等模块后续可直接复用此结构。
 */
const SORT_OPTIONS: { value: StudentSortMode; label: string }[] = [
  { value: 'default', label: '默认' },
  { value: 'pinyin', label: '首字母' },
  { value: 'random', label: '随机' },
]

defineProps<{
  keyword: string
  chipOptions: FilterChipOption[]
  filter: StudentFilterKey
  sortMode: StudentSortMode
  summary: ClassSummary
  /** 小屏抽屉是否展开 */
  open?: boolean
  /** 无学生时的引导动作由父级插槽提供 */
  showEmptyGuide?: boolean
}>()

const emit = defineEmits<{
  'update:keyword': [value: string]
  'update:filter': [key: StudentFilterKey]
  'update:sortMode': [mode: StudentSortMode]
  close: []
}>()
</script>

<template>
  <div>
    <Transition name="hub-scrim">
      <div v-if="open" class="hub-scrim" aria-hidden="true" @click="emit('close')" />
    </Transition>

    <aside class="hub-sidebar" :class="{ 'is-open': open }" aria-label="学生筛选">
      <div class="hub-sidebar__inner">
        <!-- 搜索置顶 -->
        <AppInput
          :model-value="keyword"
          class="hub-search"
          placeholder="搜索姓名、班委、宿舍或标签…"
          clearable
          @update:model-value="emit('update:keyword', $event)"
        />

        <!-- 快速筛选 -->
        <div class="hub-block">
          <p class="hub-block__title">快速筛选</p>
          <StudentFilterChips
            :options="chipOptions"
            :model-value="filter"
            @update:model-value="emit('update:filter', $event)"
          />
        </div>

        <!-- 排序 -->
        <div class="hub-block">
          <p class="hub-block__title">排序方式</p>
          <div class="sort-list" role="group" aria-label="排序方式">
            <button
              v-for="option in SORT_OPTIONS"
              :key="option.value"
              type="button"
              class="sort-item"
              :class="{ 'is-active': sortMode === option.value }"
              :aria-pressed="sortMode === option.value ? 'true' : 'false'"
              @click="emit('update:sortMode', option.value)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <!-- 班级概览 -->
        <div class="hub-block">
          <p class="hub-block__title">班级概览</p>
          <StudentSummary :summary="summary" />
        </div>

        <!-- 无学生引导（小屏抽屉里也要能到达） -->
        <div v-if="showEmptyGuide" class="hub-guide">
          <EmptyState
            :icon="Search"
            title="还没有学生"
            description="用「批量导入」一次建档，或逐个新增。"
          />
          <div class="hub-guide__actions">
            <slot name="guideActions" />
          </div>
        </div>

        <AppButton
          v-if="open"
          class="hub-done"
          variant="secondary"
          size="sm"
          @click="emit('close')"
        >
          完成
        </AppButton>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.hub-sidebar {
  /* 桌面：网格内的 sticky 侧栏列 */
  position: sticky;
  top: calc(var(--nav-height) + var(--page-top-gap));
  align-self: start;
  max-height: calc(100vh - var(--nav-height) - var(--page-top-gap) * 2);
  overflow-y: auto;
}

.hub-scrim {
  display: none;
}

.hub-scrim-enter-active,
.hub-scrim-leave-active {
  transition: opacity var(--duration-base) var(--ease-out);
}

.hub-scrim-enter-from,
.hub-scrim-leave-to {
  opacity: 0;
}

.hub-sidebar__inner {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding-bottom: var(--spacing-xl);
}

.hub-search {
  flex-shrink: 0;
}

.hub-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.hub-block__title {
  font-size: var(--font-caption);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-tertiary);
  letter-spacing: 0.02em;
}

/* 排序：纵向列表，Apple Sidebar 风 */
.sort-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sort-item {
  height: 34px;
  display: flex;
  align-items: center;
  padding: 0 var(--space-3);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
  transition:
    background var(--transition-fast),
    color var(--transition-fast);
}

.sort-item:hover:not(.is-active) {
  background: var(--bg-hover);
  color: var(--color-text-primary);
}

.sort-item:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.sort-item.is-active {
  background: var(--color-primary-soft);
  color: var(--color-primary-dark);
  font-weight: var(--font-weight-medium);
}

.hub-guide {
  padding: var(--space-3) 0;
}

.hub-guide__actions {
  display: flex;
  justify-content: center;
  gap: var(--space-2);
}

.hub-done {
  align-self: stretch;
  margin-top: var(--space-2);
}

/* 小屏抽屉 */
@media (max-width: 1023px) {
  .hub-sidebar {
    position: fixed;
    top: calc(var(--nav-height) + env(safe-area-inset-top, 0px));
    bottom: 0;
    left: 0;
    z-index: var(--z-sidebar);
    width: 280px;
    max-height: none;
    background: var(--glass-bg-card);
    backdrop-filter: blur(var(--nav-blur)) saturate(150%);
    -webkit-backdrop-filter: blur(var(--nav-blur)) saturate(150%);
    border-right: var(--border-hairline-width) solid var(--color-border-light);
    padding: var(--spacing-card) var(--spacing-card) var(--spacing-xl);
    transform: translateX(-100%);
    transition: transform var(--duration-base) var(--ease-out);
  }

  .hub-sidebar.is-open {
    transform: translateX(0);
  }

  .hub-scrim {
    display: block;
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-sidebar) - 1);
    background: var(--overlay-scrim);
    backdrop-filter: var(--glass-blur-overlay);
    -webkit-backdrop-filter: var(--glass-blur-overlay);
  }

  .hub-sidebar__inner {
    padding-bottom: 0;
  }
}

@media (min-width: 1024px) {
  .hub-done {
    display: none;
  }
}
</style>
