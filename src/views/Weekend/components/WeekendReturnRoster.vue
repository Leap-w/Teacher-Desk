<script setup lang="ts">
import { computed } from 'vue'

import { AppBadge, AppButton, AppCard } from '@/components/ui'
import type { WeekendReturnRecord } from '@/types/weekend'

/**
 * 某个周末的返家名单（一张卡装完整份名单）。
 *
 * 不做成「一人一张卡」：返家名单是给人点的花名册，十几个人各自套一张卡只会把页面拉长，
 * 也让「还有谁」这件事看不出来。留校人数由页面算（档案在读人数 − 名单里仍在读的人），
 * 本组件只管名单本身。
 */

interface Props {
  records: WeekendReturnRecord[]
  /** 在读学生 id：名单里的人被删除（软删）后仍在记录里，标注出来免得教师以为名单错了 */
  activeIds: string[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  remove: [record: WeekendReturnRecord]
}>()

const activeIdSet = computed(() => new Set(props.activeIds))
</script>

<template>
  <AppCard padding="none" class="roster-card">
    <ul class="roster-list">
      <li v-for="(record, index) in records" :key="record.id" class="roster-row">
        <span class="roster-index" aria-hidden="true">{{ index + 1 }}</span>
        <span class="roster-name">{{ record.studentName }}</span>
        <AppBadge v-if="!activeIdSet.has(record.studentId)" variant="warning" size="sm">
          已不在档案
        </AppBadge>
        <AppButton
          size="sm"
          variant="ghost"
          class="row-remove"
          :aria-label="`撤销${record.studentName}的返家登记`"
          @click="emit('remove', record)"
        >
          删除
        </AppButton>
      </li>
    </ul>
  </AppCard>
</template>

<style scoped>
.roster-list {
  padding: 0;
  margin: 0;
  list-style: none;
}

.roster-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  /* 触控目标 ≥44px：与值日组员选择同口径 */
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-border);
}

.roster-row:last-child {
  border-bottom: none;
}

.roster-index {
  min-width: 20px;
  font-size: var(--text-sm);
  color: var(--color-text-faint);
  font-variant-numeric: tabular-nums;
}

.roster-name {
  flex: 1;
  font-size: var(--text-md);
  color: var(--color-text);
}

.row-remove {
  flex-shrink: 0;
}
</style>
