<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { routes } from '@/router'

/**
 * ModuleLayout — 二级模块的统一页面骨架（V1.3.0 导航 IA）
 *
 * 「一级菜单 → 默认进入第一个子模块 → 顶部次级导航切换」：
 * 父路由（/class、/work）用本布局替代裸 RouterView，结构统一为
 * 大标题 → 副标题 → 分割线 → 次级导航 → 具体内容。
 * 标题 / 副标题来自路由 meta，次级导航项由路由表 children 自动派生。
 */
const route = useRoute()

/** 当前激活的父路由记录（/class 或 /work） */
const parentRoute = computed(() => {
  const seg = '/' + (route.path.split('/')[1] ?? '')
  return routes.find((r) => r.path === seg && r.children?.length)
})

const title = computed(() => parentRoute.value?.meta?.title ?? '')
const subtitle = computed(() => parentRoute.value?.meta?.subtitle ?? '')

/** 次级导航项：children 中非 redirect 的子路由 */
const tabs = computed(() => {
  const children = parentRoute.value?.children ?? []
  return children
    .filter((child) => !child.redirect && child.path !== '')
    .map((child) => ({
      path: `${parentRoute.value!.path}/${child.path}`.replace(/\/+/g, '/'),
      label: child.meta?.title ?? child.path,
    }))
})
</script>

<template>
  <div class="module-page">
    <header class="module-page__head">
      <h1 class="module-page__title">{{ title }}</h1>
      <p class="module-page__subtitle">{{ subtitle }}</p>
    </header>

    <nav class="module-page__tabs" aria-label="次级导航">
      <RouterLink
        v-for="tab in tabs"
        :key="tab.path"
        :to="tab.path"
        class="module-page__tab"
        :class="{ 'is-active': route.path.startsWith(tab.path) }"
      >
        {{ tab.label }}
      </RouterLink>
    </nav>

    <main class="module-page__body">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.module-page {
  max-width: var(--page-max-width);
  margin: 0 auto;
}

.module-page__head {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: 0 4px var(--spacing-lg);
  border-bottom: 1px solid var(--color-border);
}

/* V5.2 一级标题：56–64px Bold */
.module-page__title {
  font-size: var(--font-page-title);
  font-weight: var(--font-weight-bold);
  line-height: var(--leading-tight);
  letter-spacing: -0.02em;
  color: var(--color-text-primary);
}

/* 页面副标题：16px Secondary */
.module-page__subtitle {
  font-size: var(--font-content);
  color: var(--color-text-secondary);
}

.module-page__tabs {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  max-width: 100%;
  padding: 3px;
  margin: var(--spacing-lg) 0 var(--spacing-xl);
  background: var(--color-border-light);
  border-radius: var(--radius-lg);
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
}

/* UI-2：桌面端二级导航由侧栏接管，胶囊 Tab 只在小屏（<1024px）显示 */
@media (min-width: 1024px) {
  .module-page__tabs {
    display: none;
  }

  .module-page__head {
    margin-bottom: var(--spacing-lg);
  }
}

.module-page__tab {
  padding: 7px 18px;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
  white-space: nowrap;
  user-select: none;
}

.module-page__tab:hover:not(.is-active) {
  color: var(--color-text-primary);
  background: rgba(15, 23, 42, 0.04);
}

.module-page__tab.is-active {
  background: var(--color-bg-white);
  color: var(--color-text-primary);
  box-shadow: var(--shadow-xs);
  font-weight: var(--font-weight-semibold);
}

.module-page__tab:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
</style>
