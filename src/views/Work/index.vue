<script setup lang="ts">
import { useRouter } from 'vue-router'

import { NavEntryCard } from '@/components/ui'

/**
 * 工作管理枢纽页（V1.2.1 导航 IA 重构）：
 * 课程表 / 工作清单的卡片入口；原页面、原数据、原逻辑不变，仅调整入口位置。
 */
const router = useRouter()

const entries = [
  { icon: '📅', title: '课程表', description: '查看个人课程安排', to: '/work/schedule' },
  { icon: '✅', title: '工作清单', description: '待办事项管理', to: '/work/works' },
]
</script>

<template>
  <div class="hub-page">
    <!-- CDL 页面头：32px 特粗标题 + 副标题 + 底部细线 -->
    <div class="page-head">
      <h1 class="page-head__title">工作管理</h1>
      <p class="page-head__sub">课程安排与工作事项</p>
    </div>

    <!-- 功能入口卡片区：两列响应式 -->
    <nav class="hub-grid" aria-label="工作管理功能入口">
      <NavEntryCard
        v-for="entry in entries"
        :key="entry.to"
        v-bind="entry"
        @open="router.push(entry.to)"
      />
    </nav>
  </div>
</template>

<style scoped>
.hub-page {
  max-width: 880px;
  margin: 0 auto;
}

.page-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 4px 14px;
  margin-bottom: var(--spacing-xl);
  border-bottom: 1px solid var(--color-border);
}

.page-head__title {
  font-size: var(--font-page-title, 32px);
  font-weight: var(--font-weight-extrabold);
  color: var(--color-text-primary);
  line-height: 1.2;
  letter-spacing: -0.01em;
}

.page-head__sub {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.hub-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--spacing-lg);
}

@media (max-width: 640px) {
  .hub-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
