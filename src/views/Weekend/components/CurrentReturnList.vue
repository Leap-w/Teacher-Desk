<script setup lang="ts">
import { Luggage } from 'lucide-vue-next'

import { EmptyState } from '@/components/ui'
import type { WeekendReturnRecord } from '@/types/weekend'
import WeekendCard from './WeekendCard.vue'

/**
 * CurrentReturnList — 本期返家名单（V2.0.7-alpha · Phase UI-4E，Return First 重点）：
 * 返家学生卡片流（人周末不在校）；地区筛选联动后为空给对应 EmptyState。
 */
defineProps<{
  records: WeekendReturnRecord[]
  /** 学生 id → 家庭地区文案（在读学生才有） */
  regionNames?: Map<string, string>
  /** 学生 id → 值日组名 */
  dutyGroupNames?: Map<string, string>
  /** 学生 id → 登记时间（已格式化） */
  createdAtLabels?: Map<string, string>
  /** 当前地区筛选（用于空态文案） */
  regionLabel?: string
}>()

const emit = defineEmits<{
  remove: [record: WeekendReturnRecord]
}>()
</script>

<template>
  <div v-if="records.length" class="return-list">
    <WeekendCard
      v-for="record in records"
      :key="record.id"
      :record="record"
      :region="regionNames?.get(record.studentId)"
      :duty-group="dutyGroupNames?.get(record.studentId)"
      :created-at-label="createdAtLabels?.get(record.id)"
      @remove="emit('remove', $event)"
    />
  </div>
  <div v-else class="return-empty">
    <EmptyState
      :icon="Luggage"
      :title="regionLabel ? `${regionLabel}暂无返家登记` : '这一期还没有登记返家'"
      description="点右上角「登记返家」勾上回家的学生；没登记的即视为留校。"
    />
  </div>
</template>

<style scoped>
.return-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-3);
}

.return-empty {
  padding: var(--space-4) 0;
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
}
</style>
