<script setup lang="ts">
import { Check } from 'lucide-vue-next'

import { AppBadge, AppButton } from '@/components/ui'
import type { WorkItem } from '@/types/work'
import { workDateLabel, workPriorityLabel } from '@/utils/work'

interface Props {
  work: WorkItem
}

defineProps<Props>()

const emit = defineEmits<{
  (event: 'toggle', work: WorkItem): void
  (event: 'edit', work: WorkItem): void
  (event: 'remove', work: WorkItem): void
}>()

function priorityVariant(priority: WorkItem['priority']): 'neutral' | 'warning' | 'danger' {
  if (priority === 'urgent') return 'danger'
  if (priority === 'important') return 'warning'
  return 'neutral'
}
</script>

<template>
  <article
    class="work-row"
    :class="{ 'is-done': work.status === 'done' }"
    :data-priority="work.priority"
  >
    <button
      type="button"
      class="work-check"
      :class="{ 'is-checked': work.status === 'done' }"
      :aria-label="work.status === 'done' ? '取消完成' : '标记完成'"
      @click="emit('toggle', work)"
    >
      <Check v-if="work.status === 'done'" class="work-check-icon" :stroke-width="2" />
    </button>

    <div class="work-main">
      <p class="work-title">
        <span class="work-date">
          {{ workDateLabel(work.date) }}
          <span v-if="work.deadline" class="work-deadline">{{ work.deadline }}</span>
        </span>
        <span class="work-title-text">{{ work.title }}</span>
      </p>
      <p class="work-meta">
        <AppBadge :variant="priorityVariant(work.priority)" size="sm">
          {{ workPriorityLabel(work.priority) }}
        </AppBadge>
        <span class="work-category">{{ work.category }}</span>
        <span v-if="work.description" class="work-desc">{{ work.description }}</span>
      </p>
    </div>

    <div class="work-actions">
      <AppButton variant="ghost" size="sm" @click="emit('edit', work)">编辑</AppButton>
      <AppButton variant="ghost" size="sm" @click="emit('remove', work)">删除</AppButton>
    </div>
  </article>
</template>

<style scoped>
.work-row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  transition: border-color var(--transition-fast);
}

.work-row:hover {
  border-color: var(--color-border-emphasis);
}

.work-check {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  margin-top: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1.5px solid var(--color-border-strong);
  border-radius: 50%;
  background: transparent;
  color: #ffffff;
  cursor: pointer;
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast);
}

.work-check.is-checked {
  background: var(--color-primary);
  border-color: var(--color-primary);
}

.work-check-icon {
  width: 14px;
  height: 14px;
}

.work-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.work-title {
  font-size: var(--text-md);
  margin: 0;
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.work-row[data-priority='urgent'] .work-title-text {
  color: var(--color-danger-strong);
  font-weight: 700;
}

.work-row[data-priority='important'] .work-title-text {
  color: var(--color-warning-strong);
  font-weight: 600;
}

.work-row.is-done .work-title-text {
  text-decoration: line-through;
  color: var(--color-text-faint);
}

.work-date {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  font-weight: 500;
}

.work-deadline {
  margin-left: var(--space-1);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  background: var(--color-warning-soft);
  color: var(--color-warning-strong);
}

.work-title-text {
  flex: 1;
  min-width: 0;
  color: var(--color-text);
}

.work-meta {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.work-category {
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: var(--color-fill-disabled);
}

.work-desc {
  color: var(--color-text-faint);
}

.work-actions {
  flex-shrink: 0;
  display: flex;
  gap: 4px;
}
</style>
