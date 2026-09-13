<script setup lang="ts">
/**
 * WeekView — 周视图画布（V2.0.8-alpha · Phase UI-5A）：
 * 白纸画布 + 大留白，内嵌既有 ScheduleWeekGrid（星期 × 时段归位 / 调课标记 /
 * 空格新增等逻辑全部原样保留，不在本组件重复）。
 * 当前课程高亮由页面在 Grid 上传 currentLessonId 实现。
 */
</script>

<template>
  <div class="week-view-canvas">
    <slot />
  </div>
</template>

<style scoped>
.week-view-canvas {
  min-width: 0;
}

/* 画布纸面：与 SeatCanvas 同一质感（白纸 + hairline + 极浅阴影 + 大留白） */
.week-view-canvas {
  padding: var(--spacing-lg);
  background: var(--color-surface);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-card);
}

@media (max-width: 900px) {
  .week-view-canvas {
    padding: var(--spacing-card) var(--space-3);
  }
}
</style>
