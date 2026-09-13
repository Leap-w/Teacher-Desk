<script setup lang="ts">
import { computed } from 'vue'

import RegisterStatusLine from '@/components/flow/RegisterStatusLine.vue'
import { AppButton, AppCard } from '@/components/ui'
import { LEAVE_TYPE_LABELS, formatLeaveDuration, formatLeavePeriod } from '@/utils/leave'
import type { LeaveRecord } from '@/types/leave'
import LeaveStatusBadge from './LeaveStatusBadge.vue'

/**
 * LeaveCard — 统一请假卡（V2.0.5-alpha · Phase UI-4C，替换旧 LeaveRecordCard）：
 * 信息优先级：姓名（22px）> 状态徽章 > 时间范围/时长 > 原因 > 登记操作。
 * 校外中（未返校）的记录用强调描边——Record First：一眼锁定还没回来的学生。
 * 登记离校 / 返校按钮保留原逻辑，仅升级视觉。
 */
const props = withDefaults(
  defineProps<{
    record: LeaveRecord
    /** 值日组名（第几组，只读展示） */
    dutyGroup?: string
    /** 需要处理（校外中）时的强调样式 */
    emphasized?: boolean
  }>(),
  {
    dutyGroup: undefined,
    emphasized: false,
  },
)

const emit = defineEmits<{
  edit: [record: LeaveRecord]
  /** 登记 / 修改离校时间 */
  registerLeft: [record: LeaveRecord]
  /** 登记 / 修改返校时间 */
  registerBack: [record: LeaveRecord]
  remove: [record: LeaveRecord]
}>()

const periodText = computed(() => formatLeavePeriod(props.record.start, props.record.end))
const durationText = computed(() => formatLeaveDuration(props.record.start, props.record.end))

/** 已作废的记录不再开放登记（这次请假最终没有发生） */
const isActive = computed(() => props.record.status !== 'rejected')

/** 返校登记需先有离校时间（时间线起点），否则按钮点了也只会被 store 拒绝 */
const canRegisterBack = computed(() => Boolean(props.record.leftSchool))
</script>

<template>
  <AppCard class="leave-card" :class="{ 'is-emphasized': emphasized }">
    <div class="card-head">
      <div class="head-text">
        <h3 class="student-name">{{ record.studentName }}</h3>
        <p class="head-meta">
          <span v-if="dutyGroup">{{ dutyGroup }} · </span>{{ LEAVE_TYPE_LABELS[record.type] }}
        </p>
      </div>
      <LeaveStatusBadge :record="record" />
    </div>

    <div class="card-body">
      <p class="period-line">
        {{ periodText }}<span class="dot" aria-hidden="true"> · </span>共 {{ durationText }}
      </p>
      <p class="reason">{{ record.reason }}</p>
      <p v-if="record.status === 'rejected' && record.decisionNote" class="note">
        备注：{{ record.decisionNote }}
      </p>
    </div>

    <RegisterStatusLine v-if="isActive" class="register-line" :endpoints="record" />

    <div v-if="isActive" class="actions">
      <AppButton
        size="sm"
        :variant="record.leftSchool ? 'secondary' : 'primary'"
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
      <AppButton size="sm" variant="ghost" @click="emit('edit', record)">编辑</AppButton>
      <AppButton size="sm" variant="ghost" class="action-remove" @click="emit('remove', record)">
        删除
      </AppButton>
    </div>
    <p v-else class="archived-note">已作废的记录保留备查，可删除。</p>
  </AppCard>
</template>

<style scoped>
.leave-card {
  cursor: default;
  transition:
    transform var(--duration-base) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out),
    border-color var(--duration-base) var(--ease-out);
}

/* 校外中：强调描边（信息优先级最高，不是按钮感） */
.leave-card.is-emphasized {
  border-color: var(--color-warning);
  box-shadow: 0 0 0 2px var(--color-warning-soft);
}

@media (hover: hover) {
  .leave-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }

  .leave-card.is-emphasized:hover {
    box-shadow:
      0 0 0 2px var(--color-warning-soft),
      var(--shadow-md);
  }
}

.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.head-text {
  min-width: 0;
}

.student-name {
  font-size: 22px;
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.01em;
  line-height: var(--leading-tight);
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.head-meta {
  margin-top: 2px;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.card-body {
  margin-top: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.period-line {
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.dot {
  color: var(--color-text-faint);
}

.reason {
  font-size: var(--font-secondary);
  line-height: 1.6;
  color: var(--color-text-secondary);
}

.note {
  font-size: var(--font-secondary);
  line-height: 1.6;
  color: var(--color-text-tertiary);
}

/* 间距由使用方给：共用组件只管状态行本身 */
.register-line {
  margin-top: var(--space-3);
}

.actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-4);
  padding-top: var(--space-3);
  border-top: var(--border-hairline-width) solid var(--color-border-divider);
}

/* 删除与常用操作拉开距离，避免误点 */
.action-remove {
  margin-left: auto;
  color: var(--color-text-tertiary);
}

.archived-note {
  margin-top: var(--space-3);
  font-size: var(--font-secondary);
  color: var(--color-text-faint);
}
</style>
