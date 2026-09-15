<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { useAppSettingsStore } from '@/stores/appSettings'

/**
 * DashboardHero — 首页 Hero（v3.0.4-rc · 对齐 Changdu-Memory `HeroSection.vue`）。
 *
 * **DOM 与视觉层级与昌都记忆首页 Hero 一一对应**，只替换内容来源：
 * `section.hero > img.hero__bg + div.hero__overlay + div.hero__content`
 * → `div.hero__text`（h1 标题 / p 副标题 / 巨幅「第 X 天」）+ `div.hero__countdown`（玻璃倒计时卡）。
 *
 * **数据全部来自 `useAppSettingsStore`（v3.0.4-rc 统一）**：背景图、Hero 文案、支教第 X 天
 * 与学期倒计时读的是同一份设置——「我的 → 工作时光」读的也是它，改一处两边同步。
 * 这里不再有第二份倒计时状态（旧 `useCountdownSettings` 已并入 store）。
 */
defineProps<{
  /** 问候语，如「早上好，王老师」 */
  greeting: string
  /** 日期行，如「今天是 2026 年 9 月 14 日 · 星期一」 */
  dateLine: string
  /** 右上角身份标签（当前班级 / 当前身份） */
  badges?: string[]
}>()

const appSettings = useAppSettingsStore()

const background = computed(() => appSettings.settings.heroBackground)
const heroTitle = computed(() => appSettings.settings.heroTitle)
const semesterEnd = computed(() => appSettings.settings.semesterEnd)
const showProgress = computed(() => appSettings.settings.showProgress)
/** 工作时光：支教第 X 天 */
const daysWorked = computed(() => appSettings.daysWorked)
/** 学期倒计时与进度（与「我的 → 工作时光」同一份数据） */
const daysRemaining = computed(() => appSettings.termDaysRemaining)
const progress = computed(() => appSettings.termProgress)
const termIsOver = computed(() => appSettings.termIsOver)

const entered = ref(false)
onMounted(() => {
  requestAnimationFrame(() => {
    entered.value = true
  })
})
</script>

<template>
  <section class="hero" :class="{ 'is-entered': entered }">
    <!-- 高原雪山大图背景（学期与倒计时设置里可换预设 / 自定义 URL） -->
    <img class="hero__bg" :src="background" alt="" />
    <!-- 天幕遮罩与底栏沉浸渐变 -->
    <div class="hero__overlay" />

    <!-- 右上角身份标签（原有「班级 · 班主任 / 学科教师」信息，不占正文层级） -->
    <div v-if="badges && badges.length" class="hero__badges">
      <span v-for="badge in badges" :key="badge" class="hero__badge">{{ badge }}</span>
    </div>

    <!-- 底部主内容：左标题 + 巨幅天数，右玻璃拟态倒计时卡 -->
    <div class="hero__content">
      <div class="hero__text">
        <h1 class="hero__title">{{ greeting }}</h1>
        <p class="hero__subtitle">{{ dateLine }}</p>

        <!-- 视觉中心：工作时光 · 第 X 天 -->
        <div class="hero__day-block">
          <span class="hero__day-label">第</span>
          <span class="hero__day-number">{{ daysWorked }}</span>
          <span class="hero__day-label">天</span>
        </div>
      </div>

      <!-- 右侧：玻璃拟态倒计时卡片 -->
      <div class="hero__countdown">
        <div class="hero__countdown-head">
          <span class="hero__countdown-title">{{ heroTitle }}</span>
          <span class="hero__countdown-target">
            {{ termIsOver ? '学期已结束' : `期末 ${semesterEnd}` }}
          </span>
        </div>

        <div class="hero__countdown-body">
          <span class="hero__countdown-num">{{ daysRemaining }}</span>
          <span class="hero__countdown-unit">天</span>
        </div>

        <!-- 柔和进度条（可在显示设置中关闭） -->
        <template v-if="showProgress">
          <div class="hero__progress-track">
            <div class="hero__progress-fill" :style="{ width: progress + '%' }" />
          </div>
          <div class="hero__countdown-foot">
            <span class="hero__progress-pct">{{ progress }}% Completed</span>
          </div>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* ================================================
   Hero — 层级与取值对齐 Changdu-Memory HeroSection.vue
   ================================================ */
.hero {
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-2xl);
  aspect-ratio: 16 / 6;
  min-height: 340px;
  background: #101820; /* 图片加载前底色 */
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  box-shadow: var(--shadow-card);
  opacity: 0;
  transform: translateY(6px);
  transition:
    opacity var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}

.hero.is-entered {
  opacity: 1;
  transform: translateY(0);
}

@media (max-width: 900px) {
  .hero {
    aspect-ratio: auto;
    min-height: 380px;
  }
}

/* ---- 背景大图 ---- */
.hero__bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.65;
  transition: transform 1s ease-out;
}

@media (hover: hover) {
  .hero:hover .hero__bg {
    transform: scale(1.05);
  }
}

/* ---- 天幕遮罩与底栏沉浸渐变 ---- */
.hero__overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to top,
    rgba(16, 24, 32, 0.95) 0%,
    rgba(16, 24, 32, 0.3) 50%,
    rgba(0, 0, 0, 0.3) 100%
  );
}

/* ---- 右上角身份标签 ---- */
.hero__badges {
  position: absolute;
  top: 20px;
  right: 20px;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.hero__badge {
  padding: 4px 12px;
  border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.14);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  font-size: var(--font-caption);
  font-weight: var(--font-weight-medium);
  color: rgba(226, 232, 240, 0.95);
  white-space: nowrap;
}

@media (min-width: 768px) {
  .hero__badges {
    top: 28px;
    right: 28px;
  }
}

/* ---- 底部主内容 ---- */
.hero__content {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--spacing-card);
  padding: var(--spacing-xl);
}

@media (max-width: 760px) {
  .hero__content {
    flex-direction: column;
    align-items: stretch;
    padding: var(--spacing-lg);
  }
}

/* ---- 左侧：标题 + 巨幅天数 ---- */
.hero__text {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.hero__title {
  margin: 0;
  font-size: var(--font-hero-title);
  line-height: 1.15;
  font-weight: var(--font-weight-extrabold);
  letter-spacing: -0.02em;
  color: #ffffff;
}

.hero__subtitle {
  margin: 0;
  font-size: var(--font-secondary);
  line-height: 1.4;
  color: rgba(203, 213, 225, 0.9);
  letter-spacing: 0.02em;
}

.hero__day-block {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding-top: 4px;
}

.hero__day-label {
  font-size: 24px;
  font-weight: var(--font-weight-normal);
  color: rgba(226, 232, 240, 0.9);
}

.hero__day-number {
  /* 昌都记忆同款巨幅数字：日照金 */
  font-size: var(--font-hero-num);
  line-height: 1;
  font-weight: var(--font-weight-extrabold);
  color: var(--color-gold);
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}

/* ---- 右侧：玻璃拟态倒计时卡片 ---- */
.hero__countdown {
  background: rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 20px;
  padding: var(--spacing-card);
  width: 240px;
  max-width: 240px;
  flex-shrink: 0;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

@media (max-width: 760px) {
  .hero__countdown {
    width: 100%;
    max-width: 100%;
  }
}

.hero__countdown-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: var(--font-caption);
  color: rgba(226, 232, 240, 0.9);
}

.hero__countdown-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hero__countdown-target {
  color: #ffffff;
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
  flex-shrink: 0;
}

.hero__countdown-body {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.hero__countdown-num {
  font-size: 36px;
  line-height: 1;
  font-weight: 900;
  color: #ffffff;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}

.hero__countdown-unit {
  font-size: var(--font-caption);
  color: rgba(226, 232, 240, 0.9);
  font-weight: var(--font-weight-medium);
}

.hero__progress-track {
  width: 100%;
  height: 6px;
  background: rgba(0, 0, 0, 0.4);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.hero__progress-fill {
  height: 100%;
  border-radius: var(--radius-full);
  background: var(--color-gold);
  transition: width 1000ms ease;
}

.hero__countdown-foot {
  text-align: right;
}

.hero__progress-pct {
  font-size: 11px;
  color: rgba(203, 213, 225, 0.9);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
</style>
