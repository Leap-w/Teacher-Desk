<script setup lang="ts">
import { computed } from 'vue'

import { routes } from '@/router'

const navItems = computed(() => routes.filter((item) => !item.redirect))
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
        <span class="nav-icon" aria-hidden="true">{{ item.meta?.icon }}</span>
        <span class="nav-label">{{ item.meta?.title }}</span>
      </RouterLink>
    </nav>

    <footer class="sidebar-footer">
      <span class="nav-label">TeacherDesk</span>
      <span class="phase-tag">V1.0</span>
    </footer>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 232px;
  flex-shrink: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 20px 16px;
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
    padding: 20px 10px;
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
