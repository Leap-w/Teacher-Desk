<script setup lang="ts">
import { computed } from 'vue'

import RegisterStatusLine from '@/components/flow/RegisterStatusLine.vue'
import { AppBadge, AppButton, AppCard } from '@/components/ui'
import {
  LEAVE_STATUS_LABELS,
  LEAVE_TYPE_LABELS,
  formatLeaveDuration,
  formatLeavePeriod,
} from '@/utils/leave'
import type { LeaveRecord } from '@/types/leave'

/**
 * 请假记录卡（V1.1.5 记录口径）：**没有批准 / 驳回**——记录即事实，
 * 教师在这里做的是「补录 / 修改 / 登记离校返校 / 删除」，不是审批。
 */
interface Props {
  record: LeaveRecord
}

const props = defineProps<Props>()

const emit = defineEmits<{
  edit: [record: LeaveRecord]
  /** 登记 / 修改离校时间 */
  registerLeft: [record: LeaveRecord]
  /** 登记 / 修改返校时间 */
  registerBack: [record: LeaveRecord]
  remove: [record: LeaveRecord]
}>()

/**
 * 状态徽标配色：生效中的记录用成功色；「已作废」（旧审批流驳回的历史遗留）用中性色——
 * 它不代表记录出错，只是这次请假最终没有发生。
 */
const statusVariant = computed(() => {
  if (props.record.status === 'approved') return 'success'
  return 'neutral'
})

const periodText = computed(() => formatLeavePeriod(props.record.start, props.record.end))
const durationText = computed(() => formatLeaveDuration(props.record.start, props.record.end))

/** 「已作废」的记录不再开放登记（这次请假最终没有发生）；其余都可补录 / 修改 */
const isActive = computed(() => props.record.status !== 'rejected')

/** 返校登记需先有离校时间（时间线起点），否则按钮点了也只会被 store 拒绝 */
const canRegisterBack = computed(() => Boolean(props.record.leftSchool))
</script>

<template>
  <AppCard class="leave-card">
    <div class="card-head">
      <div class="head-text">
        <h3 class="student-name">{{ record.studentName }}</h3>
        <p class="period">{{ periodText }} · 共 {{ durationText }}</p>
      </div>
      <div class="badges">
        <AppBadge variant="neutral">{{ LEAVE_TYPE_LABELS[record.type] }}</AppBadge>
        <AppBadge :variant="statusVariant">{{ LEAVE_STATUS_LABELS[record.status] }}</AppBadge>
      </div>
    </div>

    <p class="reason">原因：{{ record.reason }}</p>

    <p v-if="record.status === 'rejected' && record.decisionNote" class="note">
      备注：{{ record.decisionNote }}
    </p>

    <RegisterStatusLine v-if="isActive" class="register-line" :endpoints="record" />

    <div class="actions">
      <template v-if="isActive">
        <AppButton
          size="sm"
          variant="secondary"
          :aria-label="`${record.leftSchool ? '修改' : '登记'}${record.studentName}的离校时间`"
          @click="emit('registerLeft', record)"
        >
          {{ record.leftSchool ? '修改离校' : '登记离校' }}
        </AppButton>
        <AppButton
          size="sm"
          variant="secondary"
          :disabled="!canRegisterBack"
          :title="canRegisterBack ? undefined : '请先登记离校时间'"
          :aria-label="`${record.backToSchool ? '修改' : '登记'}${record.studentName}的返校时间`"
          @click="emit('registerBack', record)"
        >
          {{ record.backToSchool ? '修改返校' : '登记返校' }}
        </AppButton>
        <AppButton
          size="sm"
          variant="ghost"
          :aria-label="`编辑${record.studentName}的请假`"
          @click="emit('edit', record)"
        >
          编辑
        </AppButton>
      </template>
      <span v-else class="archived-note">已作废的记录保留备查，可删除。</span>

      <AppButton
        size="sm"
        variant="ghost"
        class="action-remove"
        :aria-label="`删除${record.studentName}的请假记录`"
        @click="emit('remove', record)"
      >
        删除
      </AppButton>
    </div>
  </AppCard>
</template>

<style scoped>
.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.student-name {
  font-size: var(--text-md);
  font-weight: 600;
}

.period {
  margin-top: var(--space-1);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.badges {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}

.reason {
  margin-top: var(--space-3);
  font-size: var(--text-sm);
  line-height: 1.7;
  color: var(--color-text-secondary);
}

.note {
  margin-top: var(--space-2);
  font-size: var(--text-sm);
  line-height: 1.7;
  color: var(--color-text-secondary);
}

/* 间距由使用方给：共用组件只管状态行本身，不管落在页面的哪里 */
.register-line {
  margin-top: var(--space-3);
}

.actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-4);
}

.archived-note {
  font-size: var(--text-sm);
  color: var(--color-text-faint);
}

/* 删除与常用操作拉开距离，避免误点 */
.action-remove {
  margin-left: auto;
}
</style>
