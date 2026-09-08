<script setup lang="ts">
interface Props {
  icon?: string
  title?: string
  description?: string
}

withDefaults(defineProps<Props>(), {
  icon: '🗂️',
  title: '暂无数据',
  description: '',
})
</script>

<template>
  <div class="flex flex-col items-center px-4 py-7 text-center">
    <div class="empty-icon" aria-hidden="true">{{ icon }}</div>
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
  font-size: 26px;
  border-radius: 50%;
  background: var(--color-primary-soft);
  margin-bottom: 14px;
}

.empty-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
}

.empty-description {
  margin-top: 6px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--color-text-secondary);
  max-width: 280px;
}
</style>
