<script setup lang="ts">
import type { ImportHint } from './importUi'

/**
 * ImportHints — 预览上方的提示条（v3.5.0，样式取自座位导入弹窗）。
 *
 * 文案要按教师「要做什么」分类，别按代码里的字段分：
 * 「3 行学号为空，每次导入都会新增一条」比「studentNo 字段为空的行数为 3」有用得多。
 */
defineProps<{
  items: readonly ImportHint[]
}>()
</script>

<template>
  <ul v-if="items.length" class="hints">
    <li v-for="item in items" :key="item.text" class="hint" :class="`is-${item.tone}`">
      {{ item.text }}
    </li>
  </ul>
</template>

<style scoped>
.hints {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-4);
}

.hint {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  font-size: var(--text-xs);
  line-height: 1.6;
}

.hint.is-warning {
  background: var(--color-warning-soft);
  color: var(--color-warning-strong);
}

.hint.is-info {
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
}

.hint.is-danger {
  background: var(--color-danger-soft);
  color: var(--color-danger-strong);
}
</style>
