<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ArrowLeft } from 'lucide-vue-next'
import { useRouter } from 'vue-router'

import GroupPicker from './components/GroupPicker.vue'
import RandomPicker from './components/RandomPicker.vue'
import TimerCard from './components/TimerCard.vue'

/**
 * 课堂工具（V2.3.0-alpha · Phase Classroom-1；返回入口 RC-05 · v2.3.1-rc）。
 *
 * **One-Tap Classroom 规范**：进页面即可用（三个工具同屏，无折叠、无配置向导）；
 * 大控件适配讲台距离；数据直接读现有 Store（学生名单 → Student Store，
 * 值日组 → Duty Store），**不维护第二份数据**。
 *
 * **快速返回（RC-05）**：工具用完（点完名 / 计时结束 / 抽完签）教师要做的是
 * 立刻回到工作台，而不是去找浏览器的后退键——页面左上角常驻一个大号返回入口，
 * 从工具箱点进来的走历史回退，直接开链接的兜底回工具箱（不会退出应用）。
 *
 * 桌面三卡横排 / 平板两列 / 手机单列；不做横向滚动。
 */
const router = useRouter()

const entered = ref(false)
onMounted(() => {
  requestAnimationFrame(() => {
    entered.value = true
  })
})

/** 回工作台：有站内来源就回退（回到触发它的那一页），否则回首页 */
function goBack(): void {
  const back = router.options.history.state.back
  if (typeof back === 'string' && back) {
    router.back()
    return
  }
  void router.push('/')
}
</script>

<template>
  <div class="classroom-page" :class="{ 'is-entered': entered }">
    <header class="page-head">
      <button type="button" class="back-btn" @click="goBack">
        <ArrowLeft :size="20" :stroke-width="2" aria-hidden="true" />
        返回工作台
      </button>
      <div class="page-head__text">
        <h1 class="page-head__title">课堂工具</h1>
        <p class="page-head__sub">随机点名 · 课堂计时器 · 抽签（进页面即可用）</p>
      </div>
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
  gap: var(--space-3);
}

/* RC-05：大号返回入口（讲台上单手也能按到） */
.back-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  align-self: flex-start;
  min-height: 44px;
  padding: 0 var(--space-4);
  border: var(--border-hairline-width) solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--bg-card);
  font-family: inherit;
  font-size: var(--font-content);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background var(--duration-base) var(--ease-out),
    border-color var(--duration-base) var(--ease-out),
    color var(--duration-base) var(--ease-out);
}

.back-btn:hover {
  border-color: var(--color-border-medium);
  color: var(--color-text-primary);
}

.back-btn:active {
  transform: scale(0.99);
}

.page-head__text {
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

/*
  桌面三卡横排 / 平板两列 / 手机单列 —— 不出现横向滚动。
  v3.3.0：`align-items: stretch`（默认值）——三张卡**拉成同一高度**。
  此前是 `start`，每张卡各按自己的内容收着，于是计时器比抽签高出小半张，
  三个主按钮也落在三条不同的水平线上。
*/
.tool-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-4);
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
