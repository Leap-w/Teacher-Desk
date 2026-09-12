<script setup lang="ts">
import { useRouter } from 'vue-router'
import type { Component } from 'vue'
import { CalendarOutline, ChatbubblesOutline, GridOutline, PeopleOutline } from '@vicons/ionicons5'

import { AppCard } from '@/components/ui'
import { useToast } from '@/composables/useToast'

interface QuickLink {
  key: string
  label: string
  icon: Component
  /** 目标路由；缺省表示该入口尚未开放（点击给出提示，不跳转） */
  to?: string
}

const router = useRouter()
const toast = useToast()

/** 四个快捷入口：前三项为既有路由，家校沟通尚未开放（Phase 4 不新增路由） */
const quickLinks: QuickLink[] = [
  { key: 'students', label: '学生档案', icon: PeopleOutline, to: '/students' },
  { key: 'seats', label: '座位管理', icon: GridOutline, to: '/class/seats' },
  { key: 'contact', label: '家校沟通', icon: ChatbubblesOutline },
  { key: 'schedule', label: '我的课表', icon: CalendarOutline, to: '/schedule' },
]

function open(link: QuickLink): void {
  if (!link.to) {
    toast.info(`「${link.label}」规划中，敬请期待`)
    return
  }
  void router.push(link.to)
}
</script>

<template>
  <AppCard title="快捷入口">
    <div class="quick-grid">
      <button
        v-for="link in quickLinks"
        :key="link.key"
        type="button"
        class="quick-tile"
        @click="open(link)"
      >
        <span class="quick-icon" aria-hidden="true">
          <component :is="link.icon" />
        </span>
        <span class="quick-label">{{ link.label }}</span>
        <span v-if="!link.to" class="quick-tag">规划中</span>
      </button>
    </div>
  </AppCard>
</template>

<style scoped>
.quick-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

@media (min-width: 760px) {
  .quick-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.quick-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  cursor: pointer;
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast),
    transform var(--transition-fast);
}

.quick-tile:hover {
  background: var(--color-primary-soft);
  border-color: transparent;
}

.quick-tile:active {
  transform: scale(0.98);
}

.quick-tile:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.quick-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
  font-size: 20px;
}

.quick-icon :deep(svg) {
  width: 20px;
  height: 20px;
}

.quick-label {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
}

.quick-tag {
  position: absolute;
  top: var(--space-1);
  right: var(--space-1);
  padding: var(--space-1) var(--space-2);
  border-radius: 999px;
  background: var(--color-fill-disabled);
  color: var(--color-text-faint);
  font-size: var(--text-xs);
  line-height: 1.4;
}
</style>
