<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  Armchair,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  House,
  ListTodo,
  Luggage,
  NotebookPen,
  Paintbrush,
  School,
  UserRound,
  UsersRound,
  type LucideIcon,
} from 'lucide-vue-next'

import { routes } from '@/router'

/**
 * 侧边栏（V2.0.1-alpha · Phase UI-2 App Shell，Apple Sidebar 风格）：
 * 一级五项（首页/学生档案/班级管理/工作管理/我的）+ 班级、工作的二级展开菜单。
 * Active = 松石青柔和高亮 + 左侧细强调条；Hover = 轻微背景；展开动画 200ms 高度渐变。
 * 桌面端常驻；小屏（<1024px）为抽屉（open prop 控制，路由跳转自动收起）。
 */
const route = useRoute()

defineProps<{
  /** 小屏抽屉是否展开 */
  open: boolean
}>()

const emit = defineEmits<{
  navigate: []
}>()

interface SecondaryItem {
  path: string
  label: string
  icon: LucideIcon
}

interface PrimaryItem {
  path: string
  label: string
  icon: LucideIcon
  children: SecondaryItem[]
}

/** 一级菜单（顺序固定，不加不减）；二级由路由表 children 派生 + 手工配图标 */
const PRIMARY_ICONS: Record<string, LucideIcon> = {
  '/': House,
  '/students': UsersRound,
  '/class': School,
  '/work': ClipboardList,
  '/my': UserRound,
}

const SECONDARY_ICONS: Record<string, LucideIcon> = {
  '/class/seats': Armchair,
  '/class/leave': NotebookPen,
  '/class/duty': Paintbrush,
  '/class/weekend': Luggage,
  '/work/schedule': CalendarDays,
  '/work/works': ListTodo,
}

const items = computed<PrimaryItem[]>(() =>
  routes
    .filter((r) => !r.redirect && !r.meta?.hidden)
    .map((r) => {
      const children = (r.children ?? [])
        .filter((child) => !child.redirect && child.path !== '' && !child.meta?.hidden)
        .map((child) => ({
          path: `${r.path}/${child.path}`.replace(/\/+/g, '/'),
          label: child.meta?.title ?? child.path,
          icon: SECONDARY_ICONS[`${r.path}/${child.path}`] ?? CalendarDays,
        }))
      return {
        path: r.path,
        label: r.meta?.title ?? r.path,
        icon: PRIMARY_ICONS[r.path] ?? House,
        children,
      }
    }),
)

function isPrimaryActive(path: string): boolean {
  if (path === '/') return route.path === '/'
  return route.path === path || route.path.startsWith(path + '/')
}

/** 展开状态：默认展开当前所在分组，其余可手工开合 */
const expanded = ref<Record<string, boolean>>({})
function ensureExpandedForRoute(): void {
  for (const item of items.value) {
    if (item.children.length > 0 && isPrimaryActive(item.path)) {
      expanded.value[item.path] = true
    }
  }
}
watch(() => route.path, ensureExpandedForRoute, { immediate: true })

function toggleExpand(path: string): void {
  expanded.value[path] = !expanded.value[path]
}

/** 一级点击：有二级 → 只开合；无二级 → 跳转（并收起小屏抽屉） */
function onPrimaryClick(item: PrimaryItem): void {
  if (item.children.length > 0) {
    toggleExpand(item.path)
    return
  }
  emit('navigate')
}
</script>

<template>
  <Teleport to="body">
    <!-- 小屏遮罩 -->
    <Transition name="scrim">
      <div v-if="open" class="sidebar-scrim" aria-hidden="true" @click="emit('navigate')" />
    </Transition>

    <aside class="app-sidebar" :class="{ 'is-open': open }" aria-label="侧边导航">
      <nav class="app-sidebar__nav">
        <template v-for="item in items" :key="item.path">
          <!-- 有二级：开合按钮 + 展开区 -->
          <template v-if="item.children.length > 0">
            <button
              type="button"
              class="side-item"
              :class="{
                'is-active': isPrimaryActive(item.path),
                'is-expanded': expanded[item.path],
              }"
              :aria-expanded="expanded[item.path] ? 'true' : 'false'"
              @click="onPrimaryClick(item)"
            >
              <component :is="item.icon" class="side-item__icon" :size="18" :stroke-width="2" />
              <span class="side-item__label">{{ item.label }}</span>
              <ChevronDown class="side-item__chevron" :size="16" :stroke-width="2" />
            </button>

            <div class="side-sub" :class="{ 'is-expanded': expanded[item.path] }">
              <div class="side-sub__clip">
                <RouterLink
                  v-for="child in item.children"
                  :key="child.path"
                  :to="child.path"
                  class="side-sub__item"
                  :class="{ 'is-active': route.path.startsWith(child.path) }"
                  :aria-current="route.path.startsWith(child.path) ? 'page' : undefined"
                  @click="emit('navigate')"
                >
                  <component :is="child.icon" class="side-sub__icon" :size="16" :stroke-width="2" />
                  <span>{{ child.label }}</span>
                </RouterLink>
              </div>
            </div>
          </template>

          <!-- 无二级：直接跳转 -->
          <RouterLink
            v-else
            :to="item.path"
            class="side-item"
            :class="{ 'is-active': isPrimaryActive(item.path) }"
            :aria-current="isPrimaryActive(item.path) ? 'page' : undefined"
            @click="emit('navigate')"
          >
            <component :is="item.icon" class="side-item__icon" :size="18" :stroke-width="2" />
            <span class="side-item__label">{{ item.label }}</span>
          </RouterLink>
        </template>
      </nav>
    </aside>
  </Teleport>
</template>

<style scoped>
.app-sidebar {
  position: fixed;
  top: calc(var(--nav-height) + env(safe-area-inset-top, 0px));
  bottom: 0;
  left: 0;
  z-index: var(--z-sidebar);
  width: var(--sidebar-width);
  padding: var(--spacing-md) var(--space-3) var(--spacing-xl);
  overflow-y: auto;
  background: transparent;
  border-right: 1px solid var(--color-border-light);
}

.side-item {
  width: 100%;
  height: 40px;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 0 var(--space-3);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--text-md);
  font-weight: var(--font-weight-medium);
  text-align: left;
  cursor: pointer;
  user-select: none;
  position: relative;
  transition:
    background var(--transition-fast),
    color var(--transition-fast);
}

/* 左侧细强调条：Apple Sidebar 风格，只给当前一级 */
.side-item.is-active::before {
  content: '';
  position: absolute;
  left: -12px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 18px;
  border-radius: var(--radius-full);
  background: var(--color-primary);
}

.side-item:hover:not(.is-active) {
  background: var(--bg-hover);
  color: var(--color-text-primary);
}

.side-item:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

/* Active：松石青柔和高亮，不用大色块 */
.side-item.is-active {
  background: var(--color-primary-soft);
  color: var(--color-primary-dark);
  font-weight: var(--font-weight-semibold);
}

.side-item__icon {
  flex-shrink: 0;
}

.side-item__label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.side-item__chevron {
  flex-shrink: 0;
  color: var(--color-text-tertiary);
  transition: transform var(--duration-base) var(--ease-out);
}

.side-item.is-expanded .side-item__chevron {
  transform: rotate(180deg);
}

/* ---- 二级菜单：200ms 高度渐变（grid-rows 0fr→1fr） ---- */
.side-sub {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--duration-base) var(--ease-out);
}

.side-sub.is-expanded {
  grid-template-rows: 1fr;
}

.side-sub__clip {
  overflow: hidden;
  min-height: 0;
}

.side-sub__item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 34px;
  margin: 1px 0;
  padding: 0 var(--space-3) 0 var(--space-6);
  border-radius: var(--radius-sm);
  color: var(--color-text-tertiary);
  font-size: var(--text-sm);
  transition:
    background var(--transition-fast),
    color var(--transition-fast);
}

.side-sub__item:hover:not(.is-active) {
  background: var(--bg-hover);
  color: var(--color-text-primary);
}

.side-sub__item:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.side-sub__item.is-active {
  background: var(--color-primary-bg);
  color: var(--color-primary-dark);
  font-weight: var(--font-weight-medium);
}

.side-sub__icon {
  flex-shrink: 0;
  opacity: 0.85;
}

/* ---- 小屏抽屉 ---- */
.sidebar-scrim {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-sidebar) - 1);
  background: var(--overlay-scrim);
  backdrop-filter: var(--glass-blur-overlay);
  -webkit-backdrop-filter: var(--glass-blur-overlay);
}

.scrim-enter-active,
.scrim-leave-active {
  transition: opacity var(--duration-base) var(--ease-out);
}

.scrim-enter-from,
.scrim-leave-to {
  opacity: 0;
}

@media (max-width: 1023px) {
  .app-sidebar {
    background: var(--glass-bg-card);
    backdrop-filter: blur(var(--nav-blur)) saturate(150%);
    -webkit-backdrop-filter: blur(var(--nav-blur)) saturate(150%);
    transform: translateX(-100%);
    transition: transform var(--duration-base) var(--ease-out);
  }

  .app-sidebar.is-open {
    transform: translateX(0);
  }

  .side-item.is-active::before {
    left: 0;
  }
}
</style>
