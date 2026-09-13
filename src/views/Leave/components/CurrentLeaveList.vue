<script setup lang="ts">
import { MoonStar } from 'lucide-vue-next'

import { EmptyState } from '@/components/ui'
import type { LeaveRecord } from '@/types/leave'
import LeaveCard from './LeaveCard.vue'

/**
 * CurrentLeaveList — 「请假中」区（V2.0.5-alpha · Phase UI-4C 沉淀）：
 * 当前校外未返校的学生（Record First 第一屏重点）。每卡强调描边；
 * 没有人在校外时给 EmptyState——今天都回来了是好消息，不是缺数据。
 */
defineProps<{
  records: LeaveRecord[]
  /** 学生 id → 值日组名（第几组，只读） */
  dutyGroupNames?: Map<string, string>
}>()

const emit = defineEmits<{
  edit: [record: LeaveRecord]
  registerLeft: [record: LeaveRecord]
  registerBack: [record: LeaveRecord]
  remove: [record: LeaveRecord]
}>()
</script>

<template>
  <div v-if="records.length" class="current-list">
    <LeaveCard
      v-for="record in records"
      :key="record.id"
      :record="record"
      :duty-group="dutyGroupNames?.get(record.studentId)"
      emphasized
      @edit="emit('edit', $event)"
      @register-left="emit('registerLeft', $event)"
      @register-back="emit('registerBack', $event)"
      @remove="emit('remove', $event)"
    />
  </div>
  <div v-else class="current-empty">
    <EmptyState
      :icon="MoonStar"
      title="当前没有学生在外"
      description="已登记返校的都会归档到历史记录里。"
    />
  </div>
</template>

<style scoped>
.current-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--card-gap);
}

.current-empty {
  padding: var(--space-4) 0;
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
}
</style>
