<script setup lang="ts">
import { MapPin } from 'lucide-vue-next'

/**
 * StudentCardMeta — 学生卡片辅助信息行（V2.0.3-alpha · Phase UI-4A 沉淀）：
 * 值日组 / 家庭地区 / 宿舍等一行式元信息；请假、值日、周末管理可复用。
 * 空值整块隐藏（身份区才用占位符——沿用 Phase 5B 固化的空值规则）。
 */
defineProps<{
  /** 值日组名（如「第3组」）；无组不显示 */
  dutyGroup?: string
  /** 家庭地区短文案（县区优先）；无数据不显示 */
  region?: string
  /** 宿舍；未分配不显示 */
  dormitory?: string
  /** 联系电话；空不显示 */
  phone?: string
}>()
</script>

<template>
  <div class="card-meta">
    <span v-if="dutyGroup" class="meta-chip">
      {{ dutyGroup }}
    </span>
    <span v-if="region" class="meta-line">
      <MapPin :size="14" :stroke-width="2" aria-hidden="true" />
      {{ region }}
    </span>
    <span v-if="dormitory" class="meta-line">宿舍 · {{ dormitory }}</span>
    <span v-if="phone" class="meta-line">电话 · {{ phone }}</span>
  </div>
</template>

<style scoped>
.card-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  margin-top: var(--space-3);
}

/* 值日组：轻底小胶囊，权重低于身份徽章 */
.meta-chip {
  padding: 3px 10px;
  border-radius: var(--radius-full);
  background: var(--color-bg-subtle);
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
  line-height: 1.4;
  white-space: nowrap;
}

.meta-line {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  white-space: nowrap;
}

.meta-line svg {
  opacity: 0.7;
  flex-shrink: 0;
}
</style>
