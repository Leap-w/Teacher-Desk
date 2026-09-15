<script setup lang="ts">
import { GraduationCap } from 'lucide-vue-next'

import { CLASSROOM_TOOLS } from '@/utils/classroom'

/**
 * ClassroomEntryCard — 课堂工具入口（V2.3.0-alpha · Phase Classroom-1）。
 *
 * 位置：**首页「课堂工具」区块**（v3.0.3-rc 起；此前挂在我的 → 工具箱）。
 * 整卡可点（Hover 抬升 + 箭头），文案列出三个工具的用途，
 * 让教师不必点进去才知道里面有什么。课堂工具本身仍是独立页面 `/my/classroom`。
 */
const tools = CLASSROOM_TOOLS
</script>

<template>
  <RouterLink class="entry-card" to="/my/classroom">
    <span class="entry-icon" aria-hidden="true">
      <GraduationCap :size="22" :stroke-width="2" />
    </span>
    <span class="entry-main">
      <span class="entry-title">课堂工具</span>
      <span class="entry-sub">
        <template v-for="(tool, index) in tools" :key="tool.key">
          <span>{{ tool.title }}</span>
          <span v-if="index < tools.length - 1" class="entry-sep">·</span>
        </template>
      </span>
    </span>
    <span class="entry-arrow" aria-hidden="true">→</span>
  </RouterLink>
</template>

<style scoped>
.entry-card {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border: var(--border-hairline-width) solid var(--color-border-light);
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, var(--color-primary-bg) 0%, var(--bg-card) 70%);
  box-shadow: var(--shadow-xs);
  text-decoration: none;
  transition:
    transform var(--duration-base) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out),
    border-color var(--transition-fast);
}

.entry-card:hover {
  transform: translateY(-2px);
  border-color: var(--color-border-medium);
  box-shadow: var(--shadow-sm);
}

.entry-card:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.entry-icon {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  background: var(--color-primary-bg);
  color: var(--color-primary-strong);
}

.entry-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* v3.3.1 §五：卡片标题 +2px */
.entry-title {
  font-size: calc(var(--font-content) + 2px);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

/* v3.3.1 §五：副标题 +1px */
.entry-sub {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: calc(var(--font-caption) + 1px);
  color: var(--color-text-tertiary);
}

.entry-sep {
  opacity: 0.6;
}

.entry-arrow {
  flex-shrink: 0;
  color: var(--color-primary-strong);
  font-size: var(--text-lg);
  transition: transform var(--duration-base) var(--ease-out);
}

.entry-card:hover .entry-arrow {
  transform: translateX(3px);
}
</style>
