<script lang="ts">
/** 对外类型：调用方 import 后喂 items */
export interface TimelineItem {
  id: string | number
  icon: LucideIcon
  /** 语义色调：映射 Design System 徽章色 */
  tone?: 'primary' | 'success' | 'warning' | 'info'
  title: string
  desc?: string
  time?: string
}
</script>

<script setup lang="ts">
import type { LucideIcon } from 'lucide-vue-next'

/**
 * ActivityTimeline — 最近活动时间轴（V2.0.2-alpha · Phase UI-3 沉淀）：
 * 图标 + 标题 + 描述 + 时间，逐项渐入（每项 200ms、依次延迟 60ms）。
 * 无数据时用默认插槽放 EmptyState（不伪造记录）。
 * 将来接「操作足迹」（修改座位 / 导出座位表 / 更新学生信息）直接喂 items。
 */
defineProps<{
  items: TimelineItem[]
}>()

const TONE_VARS: Record<string, string> = {
  primary: 'var(--color-primary-bg)',
  success: 'var(--color-success-soft)',
  warning: 'var(--color-warning-soft)',
  info: 'var(--color-primary-bg)',
}

function toneBg(tone?: string): string {
  return TONE_VARS[tone ?? 'primary'] ?? TONE_VARS.primary
}
</script>

<template>
  <div v-if="items.length > 0" class="timeline" role="list">
    <div v-for="item in items" :key="item.id" class="timeline__row" role="listitem">
      <span class="timeline__icon" :style="{ background: toneBg(item.tone) }" aria-hidden="true">
        <component :is="item.icon" :size="16" :stroke-width="2" />
      </span>
      <div class="timeline__main">
        <p class="timeline__title">{{ item.title }}</p>
        <p v-if="item.desc" class="timeline__desc">{{ item.desc }}</p>
      </div>
      <span v-if="item.time" class="timeline__time">{{ item.time }}</span>
    </div>
  </div>
  <slot v-else />
</template>

<style scoped>
.timeline {
  display: flex;
  flex-direction: column;
}

.timeline__row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-1);
  border-bottom: var(--border-hairline-width) solid var(--color-border-divider);
  opacity: 0;
  transform: translateY(4px);
  animation: timeline-in var(--duration-base) var(--ease-out) forwards;
  animation-delay: calc(var(--timeline-index, 0) * 60ms);
}

.timeline__row:nth-child(1) {
  --timeline-index: 0;
}

.timeline__row:nth-child(2) {
  --timeline-index: 1;
}

.timeline__row:nth-child(3) {
  --timeline-index: 2;
}

.timeline__row:nth-child(4) {
  --timeline-index: 3;
}

.timeline__row:nth-child(5) {
  --timeline-index: 4;
}

.timeline__row:nth-child(n + 6) {
  --timeline-index: 5;
}

.timeline__row:last-child {
  border-bottom: none;
}

@keyframes timeline-in {
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.timeline__icon {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--color-primary-dark);
  flex-shrink: 0;
}

.timeline__main {
  flex: 1;
  min-width: 0;
}

/* v3.3.1 §五：卡片标题 +2px */
.timeline__title {
  font-size: calc(var(--font-secondary) + 2px);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

/* v3.3.1 §五：副标题 +1px */
.timeline__desc {
  margin-top: 2px;
  font-size: calc(var(--font-caption) + 1px);
  color: var(--color-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 时间与说明同一档，跟着 +1（同一行里两个 12px 只放大一个会显得没对齐） */
.timeline__time {
  flex-shrink: 0;
  font-size: calc(var(--font-caption) + 1px);
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}
</style>
