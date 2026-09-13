<script setup lang="ts">
/**
 * SeatCanvas — 教室画布框（V2.0.4-alpha · Phase UI-4B）：
 * 页面视觉中心（UI-4B 规范：座位图优先于工具栏）——白板质感、四周大留白、内容居中。
 * 具体教室渲染（SeatClassroom）由默认插槽注入，交互逻辑不经过本组件。
 */
</script>

<template>
  <div class="seat-canvas">
    <div class="seat-canvas__paper">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.seat-canvas {
  min-width: 0;
}

/* 画布纸面：纯白 + hairline + 极浅阴影，四周留白明显放大 */
.seat-canvas__paper {
  padding: var(--spacing-xl) var(--spacing-lg) var(--spacing-lg);
  background: var(--color-surface);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-card);
}

@media (max-width: 900px) {
  .seat-canvas__paper {
    padding: var(--spacing-card) var(--space-3) var(--spacing-card);
  }
}
</style>
