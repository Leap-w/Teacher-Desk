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

/*
  画布纸面：纯白 + hairline + 极浅阴影。
  v3.3.0：左右留白由 24px 收到 16px——这一圈padding 直接从座位图宽度里扣，
  需求要的是「座位图占满页面」，纸面内部的留白就不该再吃掉十几像素。
  上下仍然宽松（视觉呼吸），左右只留够贴边的量。
*/
.seat-canvas__paper {
  padding: var(--spacing-lg) var(--space-4);
  background: var(--color-surface);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-card);
}

@media (max-width: 900px) {
  .seat-canvas__paper {
    padding: var(--space-4) var(--space-2);
  }
}
</style>
