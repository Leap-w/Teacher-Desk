<script setup lang="ts">
import { onMounted, ref } from 'vue'

import GroupPicker from './components/GroupPicker.vue'
import RandomPicker from './components/RandomPicker.vue'
import TimerCard from './components/TimerCard.vue'

/**
 * 课堂工具（V2.3.0-alpha · Phase Classroom-1）。
 *
 * **One-Tap Classroom 规范**：进页面即可用（三个工具同屏，无折叠、无配置向导）；
 * 大控件适配讲台距离；数据直接读现有 Store（学生名单 → Student Store，
 * 值日组 → Duty Store），**不维护第二份数据**。
 *
 * 桌面三卡横排 / 平板两列 / 手机单列；不做横向滚动。
 */
const entered = ref(false)
onMounted(() => {
  requestAnimationFrame(() => {
    entered.value = true
  })
})
</script>

<template>
  <div class="classroom-page" :class="{ 'is-entered': entered }">
    <header class="page-head">
      <h1 class="page-head__title">课堂工具</h1>
      <p class="page-head__sub">随机点名 · 课堂计时器 · 抽签（进页面即可用）</p>
    </header>

    <div class="tool-grid">
      <RandomPicker />
      <TimerCard />
      <GroupPicker />
    </div>

    <p class="page-foot">
      点名与抽签直接读现有数据：学生来自「学生档案」，值日组来自「值日管理」——不另存一份。
    </p>
  </div>
</template>

<style scoped>
.classroom-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  opacity: 0;
  transform: translateY(6px);
  transition:
    opacity var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}

.classroom-page.is-entered {
  opacity: 1;
  transform: translateY(0);
}

.page-head {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.page-head__title {
  margin: 0;
  font-size: var(--font-h2);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  letter-spacing: -0.01em;
}

.page-head__sub {
  margin: 0;
  font-size: var(--font-content);
  color: var(--color-text-secondary);
}

/* 桌面三卡横排 / 平板两列 / 手机单列 —— 不出现横向滚动 */
.tool-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-4);
  align-items: start;
}

@media (max-width: 1100px) {
  .tool-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .tool-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.page-foot {
  margin: 0;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}
</style>
