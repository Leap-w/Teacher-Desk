<script setup lang="ts">
import StudentAvatar from '@/views/Students/components/StudentAvatar.vue'
import { AppButton } from '@/components/ui'
import type { WeekendReturnRecord } from '@/types/weekend'
import WeekendStatusBadge from './WeekendStatusBadge.vue'

/**
 * WeekendCard — 返家学生卡（V2.0.7-alpha · Phase UI-4E，StudentCard 同风格）：
 * 姓名 22px（第一优先级）> 状态徽章 > 家庭地区 / 值日组 / 登记时间 > 撤销登记。
 * 地区来自学生档案 familyLocation（只读），记录本身不带地区字段。
 */
withDefaults(
  defineProps<{
    record: WeekendReturnRecord
    /** 家庭地区文案（在读学生解析；历史遗留为 undefined） */
    region?: string
    /** 值日组名（第几组） */
    dutyGroup?: string
    /** 学生是否仍在本班档案 */
    active?: boolean
    /** 登记时间（已格式化） */
    createdAtLabel?: string
  }>(),
  {
    region: undefined,
    dutyGroup: undefined,
    active: true,
    createdAtLabel: undefined,
  },
)

const emit = defineEmits<{
  remove: [record: WeekendReturnRecord]
}>()
</script>

<template>
  <div class="weekend-card">
    <StudentAvatar :name="record.studentName.split('（')[0] ?? record.studentName" />
    <div class="weekend-card__main">
      <h3 class="weekend-card__name">{{ record.studentName }}</h3>
      <p class="weekend-card__meta">
        <span v-if="region">{{ region }}</span>
        <span v-if="region && dutyGroup" class="meta-dot" aria-hidden="true"> · </span>
        <span v-if="dutyGroup">{{ dutyGroup }}</span>
        <span v-if="createdAtLabel" class="meta-dot" aria-hidden="true"> · </span>
        <span v-if="createdAtLabel">登记于 {{ createdAtLabel }}</span>
      </p>
    </div>
    <div class="weekend-card__side">
      <WeekendStatusBadge :record="record" :active="active" />
      <AppButton size="sm" variant="ghost" @click="emit('remove', record)">撤销</AppButton>
    </div>
  </div>
</template>

<style scoped>
.weekend-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--spacing-card);
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  transition:
    transform var(--duration-base) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out);
}

@media (hover: hover) {
  .weekend-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }
}

.weekend-card__main {
  flex: 1;
  min-width: 0;
}

.weekend-card__name {
  font-size: 22px;
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.01em;
  line-height: var(--leading-tight);
  color: var(--color-text-primary);
  /* 姓名第一优先级：放不下换行（最多两行），不截断消歧后缀 */
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.weekend-card__meta {
  margin-top: 2px;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  overflow-wrap: anywhere;
}

.meta-dot {
  color: var(--color-text-faint);
}

.weekend-card__side {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}
</style>
