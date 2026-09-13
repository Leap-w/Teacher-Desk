<script setup lang="ts">
import { Check } from 'lucide-vue-next'

import { AppBadge } from '@/components/ui'
import type { WorkItem } from '@/types/work'
import { workDateLabel, workPriorityLabel } from '@/utils/work'

/**
 * TaskCard — 统一任务卡（V2.0.9-alpha · Phase UI-5B，取代 WorkRow）：
 * Things 3 风格：完成勾选（原逻辑经 toggle 上抛）+ 标题 22px（信息第一优先级）
 * + 分类/时间/优先级徽章 + 描述。完成态灰化划线；紧急/重要沿用标题色阶。
 * Hover：2px 微抬升（UI-1 Motion）。
 */
const props = defineProps<{
  work: WorkItem
}>()

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
    class="task-card"
    :class="{ 'is-done': props.work.status === 'done' }"
    :data-priority="props.work.priority"
  >
    <button
      type="button"
      class="task-check"
      :class="{ 'is-checked': props.work.status === 'done' }"
      :aria-label="props.work.status === 'done' ? '取消完成' : '标记完成'"
      @click="emit('toggle', props.work)"
    >
      <Check v-if="props.work.status === 'done'" class="task-check-icon" :stroke-width="2.4" />
    </button>

    <div class="task-main">
      <h3 class="task-title">{{ props.work.title }}</h3>
      <p v-if="props.work.description" class="task-desc">{{ props.work.description }}</p>
      <p class="task-meta">
        <TaskStatusBadge :status="props.work.status" />
        <span class="task-chip">{{ props.work.category }}</span>
        <AppBadge :variant="priorityVariant(props.work.priority)" size="sm">
          {{ workPriorityLabel(props.work.priority) }}
        </AppBadge>
        <span class="task-date">{{ workDateLabel(props.work.date) }}</span>
        <span v-if="props.work.deadline" class="task-deadline"> {{ props.work.deadline }} 前 </span>
      </p>
    </div>

    <div class="task-actions">
      <button
        type="button"
        class="task-action"
        aria-label="编辑任务"
        @click="emit('edit', props.work)"
      >
        编辑
      </button>
      <button
        type="button"
        class="task-action is-danger"
        aria-label="删除任务"
        @click="emit('remove', props.work)"
      >
        删除
      </button>
    </div>
  </article>
</template>

<style scoped>
.task-card {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-4);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  border: var(--border-hairline-width) solid var(--color-border);
  transition:
    transform var(--duration-base) var(--ease-out),
    border-color var(--transition-fast),
    box-shadow var(--duration-base) var(--ease-out);
}

.task-card:hover {
  transform: translateY(-2px);
  border-color: var(--color-border-medium);
  box-shadow: var(--shadow-sm);
}

.task-card[data-priority='urgent'] {
  border-color: var(--color-danger-strong);
}

.task-check {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
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
    background var(--duration-base) var(--ease-out),
    border-color var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}

.task-check:hover {
  border-color: var(--color-primary);
}

.task-check.is-checked {
  background: var(--color-primary);
  border-color: var(--color-primary);
}

.task-check-icon {
  width: 14px;
  height: 14px;
}

.task-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.task-title {
  margin: 0;
  font-size: 22px;
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.01em;
  line-height: var(--leading-tight);
  color: var(--color-text-primary);
}

.task-card[data-priority='urgent'] .task-title {
  color: var(--color-danger-strong);
}

.task-card[data-priority='important'] .task-title {
  color: var(--color-warning-strong);
}

.task-card.is-done .task-title {
  text-decoration: line-through;
  color: var(--color-text-faint);
  font-weight: var(--font-weight-medium);
}

.task-desc {
  margin: 0;
  font-size: var(--font-secondary);
  color: var(--color-text-secondary);
}

.task-meta {
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.task-chip {
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: var(--color-fill-disabled);
  color: var(--color-text-secondary);
}

.task-date {
  font-variant-numeric: tabular-nums;
}

.task-deadline {
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  background: var(--color-warning-soft);
  color: var(--color-warning-strong);
  font-weight: var(--font-weight-medium);
}

.task-actions {
  flex-shrink: 0;
  display: flex;
  gap: var(--space-1);
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.task-card:hover .task-actions,
.task-card:focus-within .task-actions {
  opacity: 1;
}

.task-action {
  border: none;
  background: transparent;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  font-size: var(--font-caption);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background var(--transition-fast),
    color var(--transition-fast);
}

.task-action:hover {
  background: var(--bg-hover);
  color: var(--color-text-primary);
}

.task-action.is-danger:hover {
  background: var(--color-danger-soft);
  color: var(--color-danger-strong);
}

@media (hover: none) {
  .task-actions {
    opacity: 1;
  }
}
</style>
