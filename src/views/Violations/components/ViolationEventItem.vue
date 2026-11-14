<script setup lang="ts">
/**
 * 单条违纪事件卡片（列表 / 个人档案共用）。
 *
 * 只做展示与事件转发：编辑 / 删除 / 查看详情都由页面调用 Store。
 * 严重程度**同时用文字与徽标**表达（不只靠颜色）。
 */
import { computed } from 'vue'

import { AppBadge, AppButton } from '@/components/ui'
import { formatViolationOccurredAt, VIOLATION_SEVERITY_LABELS } from '@/utils/violation'
import { severityBadgeVariant } from '@/utils/violationUi'
import type { ViolationEvent } from '@/types/violation'

const props = withDefaults(
  defineProps<{
    event: ViolationEvent
    /** 是否显示学生姓名（个人档案里姓名已知，可关掉） */
    showStudent?: boolean
    /** 是否显示 编辑 / 删除 按钮 */
    showActions?: boolean
  }>(),
  { showStudent: true, showActions: true },
)

const emit = defineEmits<{
  view: [event: ViolationEvent]
  edit: [event: ViolationEvent]
  remove: [event: ViolationEvent]
  profile: [studentId: string]
}>()

const severityLabel = computed(() => VIOLATION_SEVERITY_LABELS[props.event.severity])
const occurredAt = computed(() => formatViolationOccurredAt(props.event))
const teacherNote = computed(() => props.event.teacherNote?.trim() ?? '')
const parentNote = computed(() => props.event.parentNote?.trim() ?? '')
</script>

<template>
  <article class="event-item">
    <button type="button" class="event-main" @click="emit('view', event)">
      <span class="event-top">
        <AppBadge :variant="severityBadgeVariant(event.severity)">{{ severityLabel }}</AppBadge>
        <span class="event-behavior">{{ event.behaviorLabel }}</span>
      </span>
      <span class="event-meta">
        <span v-if="showStudent" class="event-student">{{ event.studentName }}</span>
        <span v-if="showStudent" aria-hidden="true">·</span>
        <span>{{ occurredAt }}</span>
      </span>
      <span v-if="teacherNote" class="event-note">教师备注：{{ teacherNote }}</span>
      <span v-if="parentNote" class="event-note event-note--parent">
        家长处理意见：{{ parentNote }}
      </span>
    </button>

    <div v-if="showActions" class="event-actions">
      <AppButton
        v-if="showStudent"
        size="sm"
        variant="ghost"
        @click="emit('profile', event.studentId)"
      >
        违纪档案
      </AppButton>
      <AppButton size="sm" variant="ghost" @click="emit('view', event)">详情</AppButton>
      <AppButton size="sm" variant="ghost" @click="emit('edit', event)">编辑</AppButton>
      <AppButton size="sm" variant="ghost" @click="emit('remove', event)">删除</AppButton>
    </div>
  </article>
</template>

<style scoped>
.event-item {
  display: flex;
  align-items: stretch;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  background: var(--color-bg-white);
}

.event-item + .event-item {
  margin-top: var(--space-2);
}

.event-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: inherit;
}

.event-main:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
  border-radius: var(--radius-xs);
}

.event-top {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.event-behavior {
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.event-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  font-size: var(--font-secondary);
  color: var(--color-text-secondary);
}

.event-student {
  color: var(--color-text-primary);
  font-weight: var(--font-weight-medium);
}

.event-note {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  overflow-wrap: anywhere;
}

.event-note--parent {
  color: var(--color-text-secondary);
}

.event-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-wrap: wrap;
  justify-content: flex-end;
  flex-shrink: 0;
}

@media (max-width: 640px) {
  .event-item {
    flex-direction: column;
  }

  .event-actions {
    justify-content: flex-start;
  }
}
</style>
