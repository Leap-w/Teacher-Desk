<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { AppButton, AppField, AppModal, AppTextarea } from '@/components/ui'
import { LEAVE_TYPE_LABELS, formatLeaveDuration, formatLeavePeriod } from '@/utils/leave'
import type { LeaveRecord } from '@/types/leave'

interface Props {
  modelValue: boolean
  record?: LeaveRecord
  /** 本次要做的决定：批准 / 驳回 */
  decision: 'approved' | 'rejected'
}

const props = withDefaults(defineProps<Props>(), {
  record: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** 确认：note 仅在驳回时有值（批准一律不带说明） */
  confirm: [note: string]
}>()

const note = ref('')

const isApprove = computed(() => props.decision === 'approved')
const verb = computed(() => (isApprove.value ? '批准' : '驳回'))

watch(
  () => props.modelValue,
  (open) => {
    if (open) note.value = ''
  },
)

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <AppModal
    :model-value="modelValue"
    :title="`${verb}请假`"
    :width="420"
    @update:model-value="close"
  >
    <p class="confirm-text">
      确定{{ verb }}
      <strong>{{ record?.studentName }}</strong>
      的请假申请吗？
    </p>

    <p v-if="record" class="period-text">
      {{ LEAVE_TYPE_LABELS[record.type] }} · {{ formatLeavePeriod(record.start, record.end) }} · 共
      {{ formatLeaveDuration(record.start, record.end) }}
    </p>

    <div v-if="!isApprove" class="note-block">
      <AppField label="驳回说明" hint="选填，会显示在这条记录上，便于日后说明当时的情况">
        <AppTextarea v-model="note" :rows="2" placeholder="如 请说明具体事由后重新提交" />
      </AppField>
    </div>

    <p v-else class="approve-hint">批准后可在记录上登记离校与返校时间。</p>

    <template #footer>
      <AppButton variant="ghost" @click="close">取消</AppButton>
      <AppButton :variant="isApprove ? 'primary' : 'secondary'" @click="emit('confirm', note)">
        确定{{ verb }}
      </AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.confirm-text {
  font-size: var(--text-sm);
  line-height: 1.7;
  color: var(--color-text-secondary);
}

.confirm-text strong {
  color: var(--color-text);
}

.period-text {
  margin-top: var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-text);
}

.note-block {
  margin-top: var(--space-4);
}

.approve-hint {
  margin-top: var(--space-4);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}
</style>
