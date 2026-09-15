<script setup lang="ts">
import type { LucideIcon } from 'lucide-vue-next'

/**
 * ToolCard — 课堂工具卡片壳（V2.3.0-alpha · Phase Classroom-1；**v3.3.0 改为等高骨架**）。
 *
 * 大控件、远距离可操作：卡片本身是**非按钮**容器（内部有各自的开始按钮），
 * Hover 2px 抬升、200ms 过渡。
 *
 * **v3.3.0 的三条结构约束**（三张卡并排时必须像一套东西，而不是三张各写各的卡）：
 *
 * 1. **等高**：`min-height` 由本组件统一给出（`--tool-card-h`），三张卡在任何视口下一样高。
 *    此前高度由各自内容决定，计时器比抽签高出小半张卡，一排看过去参差不齐。
 * 2. **内容区吃掉剩余空间**（`.tool-body { flex: 1 }`）：中间那行「结果大字」因此被推到
 *    三张卡里完全相同的位置，不再是「内容多的高、内容少的矮」。
 * 3. **主按钮固定在底部**：动作按钮走 `#footer` 插槽，落在卡片最下沿——
 *    **三个主按钮必然在同一水平线上**，这是本页最容易看出「整齐不整齐」的一条。
 *
 * 布局：标题行（图标 + 标题 + 说明）→ 内容区（弹性）→ 底部动作区（贴底）。
 */
defineProps<{
  title: string
  description: string
  icon: LucideIcon
}>()
</script>

<template>
  <section class="tool-card">
    <header class="tool-head">
      <span class="tool-icon" aria-hidden="true">
        <component :is="icon" :size="20" :stroke-width="2" />
      </span>
      <span class="tool-text">
        <h2 class="tool-title">{{ title }}</h2>
        <p class="tool-desc">{{ description }}</p>
      </span>
      <slot name="actions" />
    </header>

    <div class="tool-body">
      <slot />
    </div>

    <!-- 主按钮区：贴卡片底沿，三张卡在同一水平线上 -->
    <div class="tool-foot">
      <slot name="footer" />
    </div>
  </section>
</template>

<style scoped>
.tool-card {
  /* 三张卡统一高度：430–460 之间取中，MacBook Air 13" 三列并排时不撑出首屏 */
  --tool-card-h: 448px;

  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-height: var(--tool-card-h);
  padding: var(--spacing-lg);
  border: var(--border-hairline-width) solid var(--color-border-light);
  border-radius: var(--radius-xl);
  background: var(--bg-card);
  box-shadow: var(--shadow-xs);
  transition:
    transform var(--duration-base) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out);
}

.tool-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-sm);
}

.tool-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.tool-icon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  background: var(--color-primary-bg);
  color: var(--color-primary-strong);
}

.tool-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tool-title {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.tool-desc {
  margin: 0;
  font-size: var(--font-secondary);
  color: var(--color-text-tertiary);
}

/*
  内容区：**吃掉标题行与底部按钮之间的全部剩余高度**。
  `min-height: 0` 让内部的换行 / 滚动区域真的能被压缩，而不是把卡片顶高。
*/
.tool-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* 动作区：贴底（内容区已把剩余空间吃光，这里紧跟其后） */
.tool-foot {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}

/* 手机单列时不必强留高度——一列排开，各自按内容收着更好看 */
@media (max-width: 720px) {
  .tool-card {
    min-height: 0;
  }
}
</style>
