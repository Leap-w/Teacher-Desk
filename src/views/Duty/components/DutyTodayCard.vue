<script setup lang="ts">
import { AppBadge, AppButton, AppCard, EmptyState } from '@/components/ui'
import type { DutyGroup, DutyMember } from '@/types/duty'

interface Props {
  /** 今天值日的组；不值日（周末不排）或还没有组时为 undefined */
  group?: DutyGroup
  /** 该组成员（含已不在档案的，已在页面上标注） */
  members: DutyMember[]
  /** 今天的日期 + 星期文案 */
  dateLabel: string
  /** 今天是周末且「周末值日」未开启 */
  weekendSkipped: boolean
  /** 有值日组但还没设轮换起点：排班要等教师去「轮换设置」里补一步 */
  needsSetup: boolean
}

defineProps<Props>()

const emit = defineEmits<{
  /** 还没有值日组时，引导去新建第一个组 */
  (event: 'create'): void
}>()
</script>

<template>
  <AppCard title="今日值日">
    <template #actions>
      <span class="today-date">{{ dateLabel }}</span>
    </template>

    <div v-if="group" class="today-body">
      <div class="today-head">
        <p class="today-group">{{ group.name }}</p>
        <AppBadge variant="primary" size="sm">共 {{ members.length }} 人</AppBadge>
      </div>
      <ul v-if="members.length" class="member-chips">
        <li v-for="member in members" :key="member.id" class="member-chip">
          {{ member.name }}
          <span v-if="!member.active" class="member-gone">已不在档案</span>
        </li>
      </ul>
      <p v-else class="today-empty">这个组还没有组员，去下面「值日组」里加人。</p>
    </div>

    <EmptyState
      v-else-if="needsSetup"
      icon="🗓️"
      title="还没设置轮换起点"
      description="在下面的「轮换设置」里选好起点日期和起点组，排班就会自动排开。"
    />

    <EmptyState
      v-else-if="weekendSkipped"
      icon="🌙"
      title="今天不值日"
      description="当前设置为周末不排值日，周一继续轮到下一组。"
    />

    <EmptyState
      v-else
      icon="🧹"
      title="还没有值日组"
      description="值日组就是轮换的单位：建好组、把同学分进去，轮换会自动按天推进。"
    >
      <AppButton size="sm" @click="emit('create')">新建值日组</AppButton>
    </EmptyState>
  </AppCard>
</template>

<style scoped>
.today-date {
  font-size: var(--text-sm);
  color: var(--color-text-faint);
}

.today-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.today-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.today-group {
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--color-text);
}

.member-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding: 0;
  margin: 0;
  list-style: none;
}

.member-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-3);
  border-radius: 999px;
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
  font-size: var(--text-sm);
}

.member-gone {
  font-size: var(--text-xs);
  color: var(--color-warning-strong);
}

.today-empty {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}
</style>
