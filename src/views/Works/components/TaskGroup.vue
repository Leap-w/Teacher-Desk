<script setup lang="ts">
import { computed } from 'vue'

import TaskCard from './TaskCard.vue'
import TaskStatusBadge from './TaskStatusBadge.vue'
import type { WorkItem } from '@/types/work'

/**
 * TaskGroup — Things 风格任务分组（V2.0.9-alpha · Phase UI-5B）：
 * 标题 + 数量徽章 + 卡片流。逾期组标题用警示色。
 * 空态可由调用方给插槽，默认渲染 EmptyState。
 */
const props = defineProps<{
  title: string
  works: WorkItem[]
  /** 分组语气：默认中性；overdue=警示红、today=松石青 */
  tone?: 'default' | 'overdue' | 'today'
}>()

const emit = defineEmits<{
  (event: 'toggle', work: WorkItem): void
  (event: 'edit', work: WorkItem): void
  (event: 'remove', work: WorkItem): void
}>()

const count = computed(() => props.works.length)
</script>

<template>
  <section class="task-group">
    <header class="group-head">
      <h2 class="group-title" :class="{ 'is-overdue': props.tone === 'overdue' }">
        {{ props.title }}
      </h2>
      <TaskStatusBadge v-if="props.tone === 'today'" status="todo" />
      <span class="group-count" :class="{ 'is-overdue': props.tone === 'overdue' }">
        {{ count }}
      </span>
    </header>

    <div v-if="props.works.length" class="group-list">
      <TaskCard
        v-for="work in props.works"
        :key="work.id"
        :work="work"
        @toggle="emit('toggle', $event)"
        @edit="emit('edit', $event)"
        @remove="emit('remove', $event)"
      />
    </div>
    <!-- 空组默认不渲染：是否展示空态由调用方决定（页面只在「今天」组给 EmptyState） -->
    <slot v-else name="empty" />
  </section>
</template>

<style scoped>
.task-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.group-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.group-title {
  margin: 0;
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
}

.group-title.is-overdue {
  color: var(--color-danger-strong);
}

.group-count {
  min-width: 20px;
  padding: 1px 7px;
  border-radius: var(--radius-full);
  background: var(--color-fill-disabled);
  font-size: var(--font-caption);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  text-align: center;
}

.group-count.is-overdue {
  background: var(--color-danger-soft);
  color: var(--color-danger-strong);
}

.group-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
</style>
