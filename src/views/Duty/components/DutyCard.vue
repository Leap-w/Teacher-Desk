<script setup lang="ts">
import StudentAvatar from '@/views/Students/components/StudentAvatar.vue'
import DutyStatusBadge from './DutyStatusBadge.vue'
import type { DutyMember } from '@/types/duty'

/**
 * DutyCard — 今日值日成员卡（V2.0.6-alpha · Phase UI-4D，StudentCard 同风格）：
 * 姓名 22px（第一优先级）> 状态徽章 > 组名。数据模型不含完成打卡，不放假按钮。
 */
defineProps<{
  member: DutyMember
  /** 组名（如「第 3 组」） */
  groupName: string
}>()
</script>

<template>
  <div class="duty-card">
    <StudentAvatar :name="member.name.split('（')[0] ?? member.name" />
    <div class="duty-card__who">
      <h3 class="duty-card__name">{{ member.name }}</h3>
      <p class="duty-card__group">{{ groupName }}</p>
    </div>
    <DutyStatusBadge :member="member" />
  </div>
</template>

<style scoped>
.duty-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--spacing-card);
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  transition:
    transform var(--duration-base) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out);
}

@media (hover: hover) {
  .duty-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }
}

.duty-card__who {
  flex: 1;
  min-width: 0;
}

.duty-card__name {
  font-size: 22px;
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.01em;
  line-height: var(--leading-tight);
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.duty-card__group {
  margin-top: 2px;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}
</style>
