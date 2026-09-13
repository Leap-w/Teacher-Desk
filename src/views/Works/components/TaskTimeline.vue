<script setup lang="ts">
import { computed } from 'vue'

import { EmptyState } from '@/components/ui'
import { CheckCircle2 } from 'lucide-vue-next'
import type { WorkItem } from '@/types/work'
import { workDateLabel } from '@/utils/work'

/**
 * TaskTimeline — 已完成任务时间轴（V2.0.9-alpha · Phase UI-5B）：
 * Layer 4 历史记录：完成日期分组、组内按更新时间倒序，逐项 200ms 渐入（延迟 60ms）。
 * 顶部为「最近完成」的日期标签；不新增任何数据，仅排布。
 */
const props = defineProps<{
  works: WorkItem[]
}>()

const emit = defineEmits<{
  (event: 'toggle', work: WorkItem): void
}>()

interface DayBucket {
  date: string
  label: string
  items: WorkItem[]
}

const buckets = computed<DayBucket[]>(() => {
  const done = props.works
    .filter((work) => work.status === 'done')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const map = new Map<string, DayBucket>()
  for (const work of done) {
    const bucket = map.get(work.date) ?? {
      date: work.date,
      label: workDateLabel(work.date),
      items: [],
    }
    bucket.items.push(work)
    map.set(work.date, bucket)
  }
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date))
})
</script>

<template>
  <div v-if="buckets.length" class="task-timeline">
    <div
      v-for="(bucket, bucketIndex) in buckets"
      :key="bucket.date"
      class="timeline-day"
      role="listitem"
    >
      <p class="timeline-date">{{ bucket.label }}</p>
      <div class="timeline-items">
        <div
          v-for="(work, index) in bucket.items"
          :key="work.id"
          class="timeline-item"
          :style="{ animationDelay: `${Math.min((bucketIndex + 1) * (index + 1) * 60, 480)}ms` }"
        >
          <span class="timeline-dot" aria-hidden="true">
            <CheckCircle2 :size="14" :stroke-width="2.2" />
          </span>
          <span class="timeline-title">{{ work.title }}</span>
          <span class="timeline-chip">{{ work.category }}</span>
          <button
            type="button"
            class="timeline-restore"
            aria-label="恢复任务"
            @click="emit('toggle', work)"
          >
            恢复
          </button>
        </div>
      </div>
    </div>
  </div>
  <EmptyState
    v-else
    :icon="CheckCircle2"
    title="还没有已完成的任务"
    description="完成今天的第一件事，它会出现在这里。"
  />
</template>

<style scoped>
.task-timeline {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.timeline-date {
  margin: 0 0 var(--space-2);
  font-size: var(--font-caption);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-tertiary);
}

.timeline-items {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding-left: var(--space-2);
  border-left: var(--border-hairline-width) solid var(--color-border-light);
}

.timeline-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) 0;
  animation: timeline-fade var(--duration-base) var(--ease-out) both;
}

@keyframes timeline-fade {
  from {
    opacity: 0;
    transform: translateY(4px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.timeline-dot {
  display: inline-flex;
  color: var(--color-text-faint);
  flex-shrink: 0;
}

.timeline-title {
  flex: 1;
  min-width: 0;
  font-size: var(--font-secondary);
  color: var(--color-text-secondary);
  text-decoration: line-through;
  text-decoration-color: var(--color-text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timeline-chip {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: var(--color-fill-disabled);
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.timeline-restore {
  flex-shrink: 0;
  border: none;
  background: transparent;
  padding: 3px 8px;
  border-radius: var(--radius-sm);
  font-size: var(--font-caption);
  color: var(--color-text-faint);
  cursor: pointer;
  opacity: 0;
  transition:
    opacity var(--transition-fast),
    background var(--transition-fast),
    color var(--transition-fast);
}

.timeline-item:hover .timeline-restore {
  opacity: 1;
}

.timeline-restore:hover {
  background: var(--bg-hover);
  color: var(--color-text-primary);
}

@media (hover: none) {
  .timeline-restore {
    opacity: 1;
  }
}
</style>
