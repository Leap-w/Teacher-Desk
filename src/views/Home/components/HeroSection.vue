<script setup lang="ts">
import { useCountdownSettings } from '@/composables/useCountdownSettings'
import { useUserStore } from '@/stores/user'

/**
 * 首页 Hero（V1.3.1，首页1.1.html 同源视觉）：
 * 高原雪山背景（可自定义）+ 深色渐变遮罩 + 左侧巨幅「第 X 天」+ 右侧玻璃拟态倒计时卡。
 * 数字全部来自倒计时设置（我的 → 设置 → 时间设置）自动计算。
 */
const userStore = useUserStore()
const { settings, daysPassed, daysRemaining, progress } = useCountdownSettings()

const subtitle = `${userStore.profile.className} 班主任工作台`
</script>

<template>
  <section class="hero">
    <!-- 高原雪山大图背景（设置里可换预设 / 自定义 URL） -->
    <img class="hero__bg" :src="settings.background" alt="" />
    <!-- 天幕遮罩与底栏沉浸渐变 -->
    <div class="hero__overlay" />

    <!-- 底部主内容：左标题 + 巨幅天数，右玻璃拟态倒计时卡 -->
    <div class="hero__content">
      <div class="hero__text">
        <h1 class="hero__title">TeacherDesk</h1>
        <p class="hero__subtitle">{{ subtitle }}</p>

        <!-- 视觉中心：第 X 天 -->
        <div class="hero__day-block">
          <span class="hero__day-label">第</span>
          <span class="hero__day-number">{{ daysPassed }}</span>
          <span class="hero__day-label">天</span>
        </div>
      </div>

      <!-- 右侧：玻璃拟态倒计时卡片 -->
      <div class="hero__countdown">
        <div class="hero__countdown-head">
          <span class="hero__countdown-title">{{ settings.title }}</span>
          <span class="hero__countdown-target">目标 {{ settings.targetDate }}</span>
        </div>

        <div class="hero__countdown-body">
          <span class="hero__countdown-num">{{ daysRemaining }}</span>
          <span class="hero__countdown-unit">天</span>
        </div>

        <!-- 柔和进度条（可在设置中关闭） -->
        <template v-if="settings.showProgress">
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
/* 首页1.1.html 同源：雪山背景 + 沉浸渐变 + 巨幅天数 + 玻璃拟态倒计时卡 */
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

.hero:hover .hero__bg {
  transform: scale(1.05);
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
}

.hero__title {
  margin: 0;
  font-size: clamp(36px, 4.5vw, 48px);
  line-height: 1.15;
  font-weight: var(--font-weight-extrabold);
  letter-spacing: -0.02em;
  color: #ffffff;
  white-space: nowrap;
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
