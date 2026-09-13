<script setup lang="ts">
/**
 * SeatStatusBar — 座位页底部状态栏（V2.0.4-alpha · Phase UI-4B）：
 * 当前方案 · 最后修改时间 · 已保存状态；图例插槽放右侧。轻量、最低视觉权重。
 */
defineProps<{
  planName: string
  /** 最后修改时间（已格式化文案；空显示 —） */
  updatedAt?: string
  /** 未保存调整条数；0 = 已保存 */
  pendingCount: number
}>()
</script>

<template>
  <div class="seat-status">
    <div class="seat-status__left">
      <span class="status-plan">{{ planName }}</span>
      <span class="status-dot" aria-hidden="true">·</span>
      <span>最后修改 {{ updatedAt ?? '—' }}</span>
      <span class="status-dot" aria-hidden="true">·</span>
      <span v-if="pendingCount > 0" class="status-pending"> {{ pendingCount }} 条调整未保存 </span>
      <span v-else class="status-saved">已保存</span>
    </div>
    <div class="seat-status__right">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.seat-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
  padding: var(--space-2) var(--space-2) 0;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  user-select: none;
}

.seat-status__left,
.seat-status__right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.status-plan {
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-dot {
  opacity: 0.6;
}

.status-pending {
  color: var(--color-warning-strong);
}

.seat-status__right :deep(.legend) {
  margin-left: 0;
}
</style>
