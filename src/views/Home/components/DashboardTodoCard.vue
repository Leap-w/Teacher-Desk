<script setup lang="ts">
import { computed } from 'vue'
import { CheckmarkOutline } from '@vicons/ionicons5'

import { AppBadge, AppCard, EmptyState } from '@/components/ui'
import type { Todo } from '@/types/dashboard'
import { CircleCheck } from 'lucide-vue-next'

interface Props {
  todos: Todo[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  /** 点击某条待办：请求切换其完成状态（由页面调用 dashboard store） */
  (event: 'toggle', id: string): void
}>()

const doneCount = computed(() => props.todos.filter((todo) => todo.done).length)
const allDone = computed(() => props.todos.length > 0 && doneCount.value === props.todos.length)
</script>

<template>
  <AppCard title="今日待办">
    <template #actions>
      <AppBadge :variant="allDone ? 'success' : 'neutral'" size="sm">
        已完成 {{ doneCount }} / {{ todos.length }}
      </AppBadge>
    </template>

    <ul v-if="todos.length > 0" class="todo-list">
      <li v-for="todo in todos" :key="todo.id">
        <button
          type="button"
          class="todo-item"
          :class="{ 'is-done': todo.done }"
          role="checkbox"
          :aria-checked="todo.done"
          @click="emit('toggle', todo.id)"
        >
          <span class="todo-box" aria-hidden="true">
            <CheckmarkOutline v-if="todo.done" class="todo-check" />
          </span>
          <span class="todo-text">{{ todo.text }}</span>
        </button>
      </li>
    </ul>

    <EmptyState
      v-else
      :icon="CircleCheck"
      title="今天还没有待办"
      description="待办的添加与删除将在后续版本提供。"
    />
  </AppCard>
</template>

<style scoped>
.todo-list {
  display: flex;
  flex-direction: column;
}

.todo-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  /* 触控目标 ≥44px：20px 复选框 + 上下各 var(--space-3)（移动端手指可点，§9.6 审查修复） */
  padding: var(--space-3) var(--space-2);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.todo-item:hover {
  background: var(--color-fill-disabled);
}

.todo-item:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.todo-box {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1.5px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  color: #ffffff;
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast);
}

.todo-item.is-done .todo-box {
  background: var(--color-primary);
  border-color: var(--color-primary);
}

.todo-check {
  width: 14px;
  height: 14px;
}

.todo-text {
  font-size: var(--text-md);
  color: var(--color-text);
  transition: color var(--transition-fast);
}

.todo-item.is-done .todo-text {
  color: var(--color-text-faint);
  text-decoration: line-through;
}
</style>
