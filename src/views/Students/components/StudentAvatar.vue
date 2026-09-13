<script setup lang="ts">
interface Props {
  name: string
  /** md: 列表卡片（44px）；lg: 详情头部（52px） */
  size?: 'md' | 'lg'
}

withDefaults(defineProps<Props>(), {
  size: 'md',
})
</script>

<template>
  <span class="student-avatar" :class="`is-${size}`" aria-hidden="true">{{ name.charAt(0) }}</span>
</template>

<style scoped>
.student-avatar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
  font-weight: var(--font-weight-semibold);
}

.is-md {
  width: 44px;
  height: 44px;
  font-size: var(--text-lg);
}

.is-lg {
  width: 52px;
  height: 52px;
  font-size: var(--text-xl);
}
</style>
