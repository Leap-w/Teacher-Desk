<script setup lang="ts">
import { computed } from 'vue'

import TaskCard from './TaskCard.vue'
import { EmptyState } from '@/components/ui'
import { ListTodo } from 'lucide-vue-next'
import type { WorkItem } from '@/types/work'

/**
 * TodayTaskList — 今日待完成（V2.0.9-alpha · Phase UI-5B）：
 * Action First 第二层，页面第一优先级内容。数据 = workStore.todayList
 * （归属日期 ≤ 今天且未完成，含逾期——逾期项由卡片自身的紧急色阶自然强调）。
 */
const props = defineProps<{
  works: WorkItem[]
}>()

const emit = defineEmits<{
  (event: 'toggle', work: WorkItem): void
  (event: 'edit', work: WorkItem): void
  (event: 'remove', work: WorkItem): void
}>()

const overdueFirst = computed(() => [...props.works].sort((a, b) => a.date.localeCompare(b.date)))
</script>

<template>
  <div class="today-list">
    <TaskCard
      v-for="work in overdueFirst"
      :key="work.id"
      :work="work"
      @toggle="emit('toggle', $event)"
      @edit="emit('edit', $event)"
      @remove="emit('remove', $event)"
    />
  </div>
  <EmptyState
    v-if="props.works.length === 0"
    :icon="ListTodo"
    title="今天没有要做的任务"
    description="「今天」= 归属今天或更早且未完成的工作。用右下角「＋ 新建工作」记录第一件。"
  />
</template>

<style scoped>
.today-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
</style>
