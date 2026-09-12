<script setup lang="ts">
import { useRouter } from 'vue-router'

import { NavEntryCard } from '@/components/ui'

/**
 * 班级管理枢纽页（V1.2.1 导航 IA 重构）：
 * 侧边栏只承担全局导航后，二级功能入口收敛到本页的卡片网格。
 * 仅做路由跳转，不包含任何业务逻辑；原子路由（/class/seats 等）全部保留。
 */
const router = useRouter()

const entries = [
  { icon: '🎓', title: '学生档案', description: '学生信息与名单管理', to: '/students' },
  { icon: '🪑', title: '座位管理', description: '查看与调整座位表', to: '/class/seats' },
  { icon: '📝', title: '请假管理', description: '请假登记与记录', to: '/class/leave' },
  { icon: '🧹', title: '值日管理', description: '值日安排', to: '/class/duty' },
  { icon: '🧳', title: '周末管理', description: '周末离返校管理', to: '/class/weekend' },
]
</script>

<template>
  <div class="hub-page">
    <!-- CDL 页面头：32px 特粗标题 + 副标题 + 底部细线 -->
    <div class="page-head">
      <h1 class="page-head__title">班级管理</h1>
      <p class="page-head__sub">班级事务与学生管理</p>
    </div>

    <!-- 功能入口卡片区：两列响应式，卡片间大留白 -->
    <nav class="hub-grid" aria-label="班级管理功能入口">
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
