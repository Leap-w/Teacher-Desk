<script setup lang="ts">
import { AppBadge, AppButton, AppCard } from '@/components/ui'
import type { DutyGroup, DutyMember } from '@/types/duty'

interface Props {
  group: DutyGroup
  members: DutyMember[]
  /** 该组是否为当前轮换起点组（起点组删除后轮换会顺延，页面上标出来更放心） */
  anchor: boolean
}

defineProps<Props>()

const emit = defineEmits<{
  (event: 'edit', group: DutyGroup): void
  (event: 'remove', group: DutyGroup): void
}>()
</script>

<template>
  <AppCard padding="compact">
    <div class="group-head">
      <div class="group-title">
        <h4 class="group-name">{{ group.name }}</h4>
        <AppBadge v-if="anchor" variant="primary" size="sm">轮换起点</AppBadge>
        <span class="group-count">{{ members.length }} 人</span>
      </div>
      <div class="group-actions">
        <AppButton size="sm" variant="secondary" @click="emit('edit', group)">编辑</AppButton>
        <AppButton size="sm" variant="ghost" @click="emit('remove', group)">删除</AppButton>
      </div>
    </div>

    <ul v-if="members.length" class="member-list">
      <li v-for="member in members" :key="member.id" class="member-item">
        {{ member.name }}
        <span v-if="!member.active" class="member-gone">已不在档案</span>
      </li>
    </ul>
    <p v-else class="group-empty">还没有组员，点「编辑」把学生加进来。</p>
  </AppCard>
</template>

<style scoped>
.group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.group-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.group-name {
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text);
}

.group-count {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.group-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.member-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding: 0;
  margin: var(--space-3) 0 0;
  list-style: none;
}

.member-item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 2px var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--color-fill-disabled);
  font-size: var(--text-sm);
  color: var(--color-text);
}

.member-gone {
  font-size: var(--text-xs);
  color: var(--color-warning-strong);
}

.group-empty {
  margin-top: var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-text-faint);
}
</style>
