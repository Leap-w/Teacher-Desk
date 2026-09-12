<script setup lang="ts">
import { FolderOpen, type LucideIcon } from 'lucide-vue-next'

interface Props {
  /** Lucide 线性图标组件（V1.3.0：全站禁用 Emoji 图标） */
  icon?: LucideIcon
  title?: string
  description?: string
}

withDefaults(defineProps<Props>(), {
  icon: undefined,
  title: '暂无数据',
  description: '',
})

const fallbackIcon = FolderOpen
</script>

<template>
  <div class="flex flex-col items-center px-4 py-7 text-center">
    <div class="empty-icon" aria-hidden="true">
      <component :is="icon ?? fallbackIcon" :size="26" :stroke-width="1.8" />
    </div>
    <p class="empty-title">{{ title }}</p>
    <p v-if="description" class="empty-description">{{ description }}</p>
    <div v-if="$slots.default" class="mt-4">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.empty-icon {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--color-primary-bg);
  color: var(--color-primary-dark);
  margin-bottom: 14px;
}

.empty-title {
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.empty-description {
  margin-top: 6px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--color-text-secondary);
  max-width: 280px;
}
</style>
