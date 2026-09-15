<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Check, ChevronDown } from 'lucide-vue-next'

import { useAppSettingsStore } from '@/stores/appSettings'
import { COUNTDOWN_TARGETS } from '@/types/appSettings'
import type { CountdownTargetKey } from '@/types/appSettings'

/**
 * DashboardHero — 首页 Hero（v3.0.4-rc · 对齐 Changdu-Memory `HeroSection.vue`）。
 *
 * **DOM 与视觉层级与昌都记忆首页 Hero 一一对应**，只替换内容来源：
 * `section.hero > img.hero__bg + div.hero__overlay + div.hero__content`
 * → `div.hero__text`（h1 标题 / p 副标题 / 巨幅「第 X 天」）+ `div.hero__countdown`（玻璃倒计时卡）。
 *
 * **数据全部来自 `useAppSettingsStore`（v3.0.4-rc 统一 / v3.0.5-rc 加倒计时选择器）**：
 * 背景图、Hero 标题与副标题、支教第 X 天、倒计时天数与进度读的是同一份设置——
 * 「我的 → 工作时光」读的也是它，改一处两边同步。这里不再有第二份倒计时状态
 * （旧 `useCountdownSettings` 已并入 store）。
 *
 * **倒计时选择器（v3.0.5-rc）**对齐昌都记忆 `HeroSection.vue` 的 `.hero__countdown-picker`：
 * 卡片左上角的标题是个下拉按钮，选中哪一项就倒数到哪个日期，选择**立刻写盘**
 * （`appSettings.update()` → `teacherdesk:settings`），刷新后保持——
 * 与「学期与倒计时」设置页里那个下拉是**同一个字段**，两处互相同步。
 * 下拉向上展开（`.hero__countdown-list` 是 `bottom: calc(100% + 6px)`），
 * 免得被 Hero 的 `overflow: hidden` 圆角裁掉——这一句是参考版的原设计，照搬。
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
/** Hero 标题 = 倒计时卡的标题（如「距离期末考试」），同时也是选择器按钮上的文字 */
const heroTitle = computed(() => appSettings.settings.heroTitle)
/** Hero 副标题：空字符串 = 这一行整个不渲染（默认就是空的） */
const heroSubtitle = computed(() => appSettings.settings.heroSubtitle)
const showProgress = computed(() => appSettings.settings.showProgress)
/** 工作时光：支教第 X 天 */
const daysWorked = computed(() => appSettings.daysWorked)

/* ---- 倒计时卡（数字跟目标走，进度条跟学期走，口径见 store） ---- */
const countdownMagnitude = computed(() => appSettings.countdownMagnitude)
const countdownLabel = computed(() => appSettings.countdownLabel)
const countdownTitle = computed(() => appSettings.countdownTarget.label)
const progress = computed(() => appSettings.countdownProgress)

/** 下拉开关（参考版是点开卡片里的按钮，不持久化——开合状态不属于设置） */
const pickerOpen = ref(false)

/** 下拉里的三个目标（与「学期与倒计时」设置页同一份来源） */
const countdownOptions = COUNTDOWN_TARGETS

/** 选中一个倒计时目标：写盘后 store 立刻重算，首页与「我的」两处同帧跟上 */
function selectCountdown(value: CountdownTargetKey): void {
  appSettings.update({ countdownTarget: value })
  pickerOpen.value = false
}

const entered = ref(false)
onMounted(() => {
  requestAnimationFrame(() => {
    entered.value = true
  })
})
</script>

<template>
  <!-- 点卡片以外的地方收起下拉（参考版同款：section 上收，卡片内 stop） -->
  <section class="hero" :class="{ 'is-entered': entered }" @click="pickerOpen = false">
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
        <!-- Hero 副标题（「学期与倒计时」里填，默认空 = 这一行不出现） -->
        <p v-if="heroSubtitle" class="hero__subtitle hero__subtitle--custom">{{ heroSubtitle }}</p>

        <!-- 视觉中心：工作时光 · 第 X 天 -->
        <div class="hero__day-block">
          <span class="hero__day-label">第</span>
          <span class="hero__day-number">{{ daysWorked }}</span>
          <span class="hero__day-label">天</span>
        </div>
      </div>

      <!-- 右侧：玻璃拟态倒计时卡片（标题即倒计时选择器） -->
      <div class="hero__countdown" @click.stop>
        <div class="hero__countdown-head">
          <button
            class="hero__countdown-picker"
            type="button"
            :aria-expanded="pickerOpen"
            :title="countdownTitle"
            @click.stop="pickerOpen = !pickerOpen"
          >
            <span class="hero__countdown-picker-label">{{ heroTitle }}</span>
            <ChevronDown
              class="hero__countdown-caret"
              :class="{ 'hero__countdown-caret--open': pickerOpen }"
              :size="12"
              :stroke-width="2"
              aria-hidden="true"
            />
          </button>
          <span class="hero__countdown-target">{{ countdownLabel }}</span>
        </div>

        <div class="hero__countdown-body">
          <span class="hero__countdown-num">{{ countdownMagnitude }}</span>
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

        <!-- 倒计时选择下拉（向上展开，见脚本注释） -->
        <Transition name="picker">
          <div v-if="pickerOpen" class="hero__countdown-list">
            <button
              v-for="opt in countdownOptions"
              :key="opt.value"
              class="hero__countdown-opt"
              :class="{
                'hero__countdown-opt--active': opt.value === appSettings.settings.countdownTarget,
              }"
              type="button"
              @click.stop="selectCountdown(opt.value)"
            >
              <span class="hero__countdown-opt-text">{{ opt.label }}</span>
              <Check
                v-if="opt.value === appSettings.settings.countdownTarget"
                class="hero__countdown-opt-check"
                :size="12"
                :stroke-width="2.5"
                aria-hidden="true"
              />
            </button>
          </div>
        </Transition>
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

/* 自定义副标题：与日期行同一位置、同样的浅色，只是不抢日期那一行 */
.hero__subtitle--custom {
  color: rgba(226, 232, 240, 0.8);
}

/* ---- 右侧：玻璃拟态倒计时卡片 ---- */
.hero__countdown {
  /* 下拉以卡片为定位基准（参考版同款） */
  position: relative;
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

/* 倒计时选择按钮（标题本身就是下拉入口，参考版同款） */
.hero__countdown-picker {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 68%;
  padding: 0;
  border: none;
  background: transparent;
  color: rgba(226, 232, 240, 0.9);
  font-family: inherit;
  font-size: var(--font-caption);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out);
}

.hero__countdown-picker:hover {
  color: #ffffff;
}

.hero__countdown-picker-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hero__countdown-caret {
  flex-shrink: 0;
  transition: transform 0.25s ease;
}

.hero__countdown-caret--open {
  transform: rotate(180deg);
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

/* ---- 倒计时选择下拉（向上展开，避免被 hero 的 overflow: hidden 圆角裁剪） ---- */
.hero__countdown-list {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  background: rgba(16, 24, 32, 0.92);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.35);
  max-height: 200px;
  overflow-y: auto;
}

.hero__countdown-opt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border: none;
  background: transparent;
  border-radius: 8px;
  color: rgba(226, 232, 240, 0.9);
  font-family: inherit;
  font-size: var(--font-caption);
  cursor: pointer;
  text-align: left;
  transition: background var(--duration-fast) var(--ease-out);
}

.hero__countdown-opt:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #ffffff;
}

.hero__countdown-opt--active {
  color: var(--color-gold);
  font-weight: var(--font-weight-semibold);
}

.hero__countdown-opt-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hero__countdown-opt-check {
  flex-shrink: 0;
}

/* 下拉过渡 */
.picker-enter-active,
.picker-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.picker-enter-from,
.picker-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
