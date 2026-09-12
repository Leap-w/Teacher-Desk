<script setup lang="ts">
import { computed } from 'vue'

import { routes } from '@/router'

/**
 * 侧边导航：过滤掉 redirect 项 + 自动把嵌套子路由展平成同级的二级项。
 * 「工作管理」由父级（带 children 的路由）展现，子页「课程表 / 工作清单」作为它的二级项。
 */
const navItems = computed(() => {
  const items = []
  for (const route of routes) {
    if (route.redirect) continue
    if (route.children && route.children.length > 0) {
      // 父级：加一项「工作管理」+ 它的子项
      items.push({
        path: route.path,
        title: route.meta?.title,
        icon: route.meta?.icon,
        isGroup: true,
      })
      for (const child of route.children) {
        if (child.redirect) continue
        const fullPath = `${route.path}/${child.path}`.replace(/\/$/, '').replace(/\/+/g, '/')
        items.push({
          path: fullPath,
          title: child.meta?.title,
          icon: child.meta?.icon,
          isSub: true,
        })
      }
    } else {
      items.push({ path: route.path, title: route.meta?.title, icon: route.meta?.icon })
    }
  }
  return items
})
</script>

<template>
  <aside class="sidebar">
    <nav class="flex flex-col gap-1" aria-label="主导航">
      <template v-for="item in navItems" :key="item.path">
        <RouterLink
          v-if="!item.isSub"
          :to="item.path"
          class="nav-item"
          :class="{ 'is-group': item.isGroup }"
          active-class="is-active"
        >
          <span class="nav-icon" aria-hidden="true">{{ item.icon }}</span>
          <span class="nav-label">{{ item.title }}</span>
        </RouterLink>
        <RouterLink v-else :to="item.path" class="nav-item nav-item-sub" active-class="is-active">
          <span class="nav-icon" aria-hidden="true">{{ item.icon }}</span>
          <span class="nav-label">{{ item.title }}</span>
        </RouterLink>
      </template>
    </nav>

    <footer class="sidebar-footer">
      <span class="nav-label">TeacherDesk</span>
      <span class="phase-tag">V1.1.3</span>
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
  background: rgba(29, 29, 31, 0.05);
  color: var(--color-text);
}

.nav-item.is-active {
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
  font-weight: 600;
}

.nav-item.is-group {
  font-weight: 700;
}

.nav-item-sub {
  padding-left: 28px;
  font-size: 13px;
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
  font-weight: 600;
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
  background: rgba(29, 29, 31, 0.05);
  color: var(--color-text);
}

.nav-item.is-active {
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
  font-weight: 600;
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
  font-weight: 600;
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
