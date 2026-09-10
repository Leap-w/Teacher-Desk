<script setup lang="ts">
import { computed } from 'vue'

import { AppBadge, AppButton, AppCard, EmptyState } from '@/components/ui'
import { LEAVE_TYPE_LABELS, formatLeavePeriod } from '@/utils/leave'
import type { LeaveRecord } from '@/types/leave'

interface Props {
  /** 待处理的请假（store 已按开始时间升序——最早请假的先批） */
  pending: LeaveRecord[]
  /** 本月已批准的请假人次 */
  monthCount: number
}

const props = defineProps<Props>()

const emit = defineEmits<{
  /** 请求打开请假管理页（由页面跳转，卡片不管路由） */
  open: []
}>()

/** 卡片篇幅有限：最多列 3 条，其余在页脚提示「还有 N 条」 */
const MAX_ROWS = 3

const visible = computed(() => props.pending.slice(0, MAX_ROWS))
const restCount = computed(() => props.pending.length - visible.value.length)

const footNote = computed(() =>
  restCount.value > 0
    ? `本月已批准 ${props.monthCount} 人次 · 还有 ${restCount.value} 条待处理`
    : `本月已批准 ${props.monthCount} 人次`,
)
</script>

<template>
  <AppCard title="请假审批">
    <template #actions>
      <AppBadge :variant="pending.length > 0 ? 'warning' : 'neutral'" size="sm">
        待处理 {{ pending.length }}
      </AppBadge>
    </template>

    <ul v-if="visible.length > 0" class="leave-list">
      <li v-for="record in visible" :key="record.id">
        <button type="button" class="leave-item" @click="emit('open')">
          <span class="item-head">
            <span class="item-name">{{ record.studentName }}</span>
            <span class="item-type">{{ LEAVE_TYPE_LABELS[record.type] }}</span>
          </span>
          <span class="item-period">{{ formatLeavePeriod(record.start, record.end) }}</span>
        </button>
      </li>
    </ul>

    <EmptyState
      v-else
      icon="🎉"
      title="没有待处理的请假"
      description="需要记录学生请假时，点下方进入请假管理。"
    />

    <div class="card-foot">
      <p class="foot-note">{{ footNote }}</p>
      <AppButton size="sm" variant="secondary" @click="emit('open')">
        {{ pending.length > 0 ? '去审批' : '去请假管理' }}
      </AppButton>
    </div>
  </AppCard>
</template>

<style scoped>
.leave-list {
  display: flex;
  flex-direction: column;
}

.leave-item {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-3) var(--space-2);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.leave-item:hover {
  background: var(--color-fill-disabled);
}

.leave-item:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.item-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}

.item-name {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--color-text);
}

.item-type {
  flex-shrink: 0;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.item-period {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-top: var(--space-4);
}

.foot-note {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
</style>
