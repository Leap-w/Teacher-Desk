<script setup lang="ts">
import { computed } from 'vue'

import { routes } from '@/router'

/**
 * 侧边导航（V1.2.1 导航 IA 重构）：只承担**全局导航**——
 * 有 children 的路由（班级管理 / 工作管理）只出一项，不再把子页展平成二级树；
 * 二级功能入口由各枢纽页（/class、/work）的卡片网格承担，与 Changdu Memory 层级一致。
 */
const navItems = computed(() => {
  const items: { path: string; title?: string; icon?: string }[] = []
  for (const route of routes) {
    if (route.redirect) continue
    // hidden：不在侧边栏出现的页面（如 /my/settings、/my/tools——由「我的」页的功能项进入）
    if (route.meta?.hidden) continue
    items.push({ path: route.path, title: route.meta?.title, icon: route.meta?.icon })
  }
  return items
})
</script>

<template>
  <aside class="sidebar">
    <nav class="flex flex-col gap-1" aria-label="主导航">
      <RouterLink
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        class="nav-item"
        active-class="is-active"
      >
        <span class="nav-icon" aria-hidden="true">{{ item.icon }}</span>
        <span class="nav-label">{{ item.title }}</span>
      </RouterLink>
    </nav>

    <footer class="sidebar-footer">
      <span class="nav-label">TeacherDesk</span>
      <span class="phase-tag">V1.2.1</span>
    </footer>
  </aside>
</template>

<style scoped>
.sidebar {
  /* 内边距拆成两个局部变量：@media 里只改这两个数，安全区（左右刘海 / 底部 home 指示条）不必重复写 */
  --sidebar-pad-y: 20px;
  --sidebar-pad-x: 16px;

  width: 232px;
  flex-shrink: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: calc(var(--sidebar-pad-y) + env(safe-area-inset-top, 0px))
    calc(var(--sidebar-pad-x) + env(safe-area-inset-right, 0px))
    calc(var(--sidebar-pad-y) + env(safe-area-inset-bottom, 0px))
    calc(var(--sidebar-pad-x) + env(safe-area-inset-left, 0px));
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-right: 1px solid var(--color-border);
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font-size: 14px;
  font-weight: 500;
  transition:
    background var(--transition-fast),
    color var(--transition-fast);
}

.nav-item:hover {
  background: var(--color-primary-bg);
  color: var(--color-text-primary);
}

/* CDL 导航激活态：实心主色胶囊 + 白字（同 Changdu Memory top-nav__link--active） */
.nav-item.is-active {
  background: var(--color-primary);
  color: #ffffff;
  font-weight: var(--font-weight-semibold);
  box-shadow: var(--shadow-xs);
}

.nav-icon {
  font-size: 18px;
  line-height: 1;
}

.sidebar-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.phase-tag {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
  font-size: 11px;
  font-weight: var(--font-weight-semibold);
}

@media (max-width: 1024px) {
  .sidebar {
    width: 72px;
    --sidebar-pad-x: 10px;
  }

  .nav-item {
    justify-content: center;
    padding: 12px 0;
  }

  .nav-label {
    display: none;
  }

  .sidebar-footer {
    justify-content: center;
  }
}

@media (max-width: 720px) {
  .sidebar {
    display: none;
  }
}
</style>
