<script setup lang="ts">
import { computed } from 'vue'

import { AppBadge, AppButton, AppCard } from '@/components/ui'
import {
  LEAVE_STATUS_LABELS,
  LEAVE_TYPE_LABELS,
  formatLeaveDuration,
  formatLeavePeriod,
  formatLeavePoint,
} from '@/utils/leave'
import type { BadgeVariant } from '@/types'
import type { LeaveRecord } from '@/types/leave'

interface Props {
  record: LeaveRecord
}

const props = defineProps<Props>()

const emit = defineEmits<{
  edit: [record: LeaveRecord]
  approve: [record: LeaveRecord]
  reject: [record: LeaveRecord]
  /** 登记 / 修改离校时间 */
  registerLeft: [record: LeaveRecord]
  /** 登记 / 修改返校时间 */
  registerBack: [record: LeaveRecord]
  remove: [record: LeaveRecord]
}>()

/**
 * 状态徽标配色：待处理用警示色（需要教师处理）；已驳回用中性色——
 * 驳回是正常的审批结果，标成危险色会让人误以为记录出了错。
 */
const statusVariant = computed(() => {
  if (props.record.status === 'pending') return 'warning'
  if (props.record.status === 'approved') return 'success'
  return 'neutral'
})

const periodText = computed(() => formatLeavePeriod(props.record.start, props.record.end))
const durationText = computed(() => formatLeaveDuration(props.record.start, props.record.end))

/**
 * 离校 / 返校状态由两个时间戳**派生展示**，不新增第四种审批状态（Phase 5 口径）：
 * 有返校时间即已返校，只有离校时间即已离校（学生不在校内，教师最需要一眼看到的），
 * 两者皆无为未离校。配色沿用徽标语义：已离校用警示色、已返校用成功色。
 */
const followUp = computed<{ label: string; variant: BadgeVariant }>(() => {
  const { leftSchool, backToSchool } = props.record
  if (backToSchool) return { label: '已返校', variant: 'success' }
  if (leftSchool) return { label: '已离校', variant: 'warning' }
  return { label: '未离校', variant: 'neutral' }
})

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
      驳回说明：{{ record.decisionNote }}
    </p>

    <p v-if="record.status === 'approved'" class="follow-up">
      <AppBadge :variant="followUp.variant" size="sm">{{ followUp.label }}</AppBadge>
      <span>
        离校时间 {{ record.leftSchool ? formatLeavePoint(record.leftSchool) : '未登记' }}
      </span>
      <span class="follow-divider" aria-hidden="true">·</span>
      <span>
        返校时间 {{ record.backToSchool ? formatLeavePoint(record.backToSchool) : '未登记' }}
      </span>
    </p>

    <div class="actions">
      <template v-if="record.status === 'pending'">
        <AppButton
          size="sm"
          :aria-label="`批准${record.studentName}的请假`"
          @click="emit('approve', record)"
        >
          批准
        </AppButton>
        <AppButton
          size="sm"
          variant="secondary"
          :aria-label="`驳回${record.studentName}的请假`"
          @click="emit('reject', record)"
        >
          驳回
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

      <template v-else-if="record.status === 'approved'">
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
      </template>

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

.follow-up {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-3);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.follow-divider {
  color: var(--color-text-faint);
}

.actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-4);
}

/* 删除与常用操作拉开距离，避免误点 */
.action-remove {
  margin-left: auto;
}
</style>
