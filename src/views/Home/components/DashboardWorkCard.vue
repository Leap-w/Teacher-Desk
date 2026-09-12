<script setup lang="ts">
import { computed } from 'vue'

import { AppBadge, AppCard, EmptyState } from '@/components/ui'
import { useWorkStore } from '@/stores/work'
import { PartyPopper } from 'lucide-vue-next'

const emit = defineEmits<{
  (event: 'open'): void
}>()

const workStore = useWorkStore()

/** 顶多列 3 条；总条数由徽标显示 */
const previewList = computed(() => workStore.todayList.slice(0, 3))
const totalCount = computed(() => workStore.todayList.length)
const overdueCount = computed(() => workStore.summary.overdue)
</script>

<template>
  <AppCard title="今日工作">
    <template #actions>
      <AppBadge
        :variant="totalCount === 0 ? 'success' : overdueCount > 0 ? 'danger' : 'neutral'"
        size="sm"
      >
        今日 {{ totalCount }}
        <span v-if="overdueCount > 0"> · 逾期 {{ overdueCount }}</span>
      </AppBadge>
    </template>

    <ul v-if="previewList.length > 0" class="work-list">
      <li v-for="work in previewList" :key="work.id" class="work-row">
        <span class="work-dot" :data-priority="work.priority" aria-hidden="true" />
        <span class="work-title">{{ work.title }}</span>
        <span v-if="work.deadline" class="work-deadline">{{ work.deadline }}</span>
      </li>
    </ul>

    <EmptyState
      v-else
      :icon="PartyPopper"
      title="今日没有待办"
      description="点下方按钮新建，或从 Excel 批量导入。"
    />

    <button
      v-if="totalCount > previewList.length"
      type="button"
      class="more-link"
      @click="emit('open')"
    >
      还有 {{ totalCount - previewList.length }} 条 →
    </button>
    <button v-else-if="totalCount === 0" type="button" class="more-link" @click="emit('open')">
      去新建 →
    </button>
  </AppCard>
</template>

<style scoped>
.work-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.work-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) 0;
  font-size: var(--text-sm);
  color: var(--color-text);
}

.work-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-text-faint);
}

.work-dot[data-priority='urgent'] {
  background: var(--color-danger-strong);
}

.work-dot[data-priority='important'] {
  background: var(--color-warning-strong);
}

.work-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.work-deadline {
  flex-shrink: 0;
  font-size: var(--text-xs);
  color: var(--color-warning-strong);
}

.more-link {
  margin-top: var(--space-2);
  padding: 0;
  border: none;
  background: transparent;
  font: inherit;
  font-size: var(--text-xs);
  color: var(--color-primary-strong);
  cursor: pointer;
}

.more-link:hover {
  text-decoration: underline;
}
</style>
