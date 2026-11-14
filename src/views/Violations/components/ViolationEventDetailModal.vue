<script setup lang="ts">
/**
 * 单条违纪事件详情弹窗。
 *
 * 教师备注与家长处理意见**分区展示、互不混用**；未填写时显示「暂未填写」，
 * 不生成任何虚构内容。支持从详情进入编辑/删除/学生档案。
 */
import { computed } from 'vue'

import { AppBadge, AppButton, AppModal } from '@/components/ui'
import { VIOLATION_SEVERITY_LABELS, formatViolationOccurredAt } from '@/utils/violation'
import { severityBadgeVariant } from '@/utils/violationUi'
import type { ViolationEvent } from '@/types/violation'

const props = withDefaults(defineProps<{ modelValue: boolean; event?: ViolationEvent }>(), {
  event: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  edit: [event: ViolationEvent]
  remove: [event: ViolationEvent]
  profile: [studentId: string]
}>()

const occurredAt = computed(() => (props.event ? formatViolationOccurredAt(props.event) : ''))
const severityLabel = computed(() =>
  props.event ? VIOLATION_SEVERITY_LABELS[props.event.severity] : '',
)
const createdAt = computed(() => formatDateTime(props.event?.createdAt))
const updatedAt = computed(() => formatDateTime(props.event?.updatedAt))

function formatDateTime(iso: string | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

function close(): void {
  emit('update:modelValue', false)
}
</script>

<template>
  <AppModal :model-value="modelValue" title="违纪事件详情" :width="560" @update:model-value="close">
    <div v-if="event" class="detail">
      <header class="detail-head">
        <div class="detail-head__main">
          <p class="detail-student">{{ event.studentName }}</p>
          <p class="detail-behavior">{{ event.behaviorLabel }}</p>
        </div>
        <AppBadge :variant="severityBadgeVariant(event.severity)">{{ severityLabel }}</AppBadge>
      </header>

      <dl class="detail-list">
        <div class="detail-row">
          <dt>发生时间</dt>
          <dd>{{ occurredAt }}</dd>
        </div>
        <div class="detail-row detail-row--block">
          <dt>事件描述</dt>
          <dd>{{ event.description?.trim() || '暂未填写' }}</dd>
        </div>
        <div class="detail-row detail-row--block">
          <dt>教师备注</dt>
          <dd>{{ event.teacherNote?.trim() || '暂未填写' }}</dd>
        </div>
        <div class="detail-row detail-row--block detail-row--parent">
          <dt>家长处理意见</dt>
          <dd>{{ event.parentNote?.trim() || '暂未填写' }}</dd>
        </div>
        <div class="detail-row">
          <dt>记录创建</dt>
          <dd>{{ createdAt }}</dd>
        </div>
        <div class="detail-row">
          <dt>最后更新</dt>
          <dd>{{ updatedAt }}</dd>
        </div>
      </dl>
    </div>

    <template #footer>
      <AppButton v-if="event" variant="ghost" @click="emit('profile', event.studentId)">
        学生违纪档案
      </AppButton>
      <AppButton variant="ghost" :disabled="!event" @click="event && emit('remove', event)">
        删除
      </AppButton>
      <AppButton :disabled="!event" @click="event && emit('edit', event)">编辑</AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3);
  background: var(--color-bg-subtle);
  border-radius: var(--radius-md);
}

.detail-student {
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.detail-behavior {
  margin-top: 2px;
  font-size: var(--font-secondary);
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}

.detail-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.detail-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  font-size: var(--font-secondary);
}

.detail-row dt {
  width: 76px;
  flex-shrink: 0;
  color: var(--color-text-tertiary);
}

.detail-row dd {
  min-width: 0;
  color: var(--color-text-primary);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.detail-row--block {
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  background: var(--color-bg-subtle);
  border-radius: var(--radius-sm);
}

.detail-row--block dt {
  width: auto;
}

.detail-row--parent {
  background: var(--color-primary-bg);
}
</style>
