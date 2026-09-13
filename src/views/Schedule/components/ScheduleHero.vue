<script setup lang="ts">
import { onMounted, ref } from 'vue'

/**
 * ScheduleHero — 今日课程 Hero（V2.0.8-alpha · Phase UI-5A，Calendar First 视觉中心）：
 * 今天星期 + 今日节数 + 当前 / 下一节课大字 + 状态；极轻渐变、进入 200ms 渐入。
 * 状态机来自 utils/scheduleNow（与 Dashboard「下一节课」同一份实现）。
 */
defineProps<{
  weekdayLabel: string
  /** 今日节数（0 时显示「今天没有课」） */
  todayCount: number
  state: 'ongoing' | 'next' | 'done' | 'empty'
  subject?: string
  className?: string
  /** 如「第2节 · 09:20-10:00」 */
  timeLabel?: string
  minutesLeft?: number
}>()

const entered = ref(false)
onMounted(() => {
  requestAnimationFrame(() => {
    entered.value = true
  })
})
</script>

<template>
  <div class="schedule-hero" :class="{ 'is-entered': entered }">
    <div class="hero-top">
      <span class="hero-badge">{{ weekdayLabel }}</span>
      <span class="hero-count">今日 {{ todayCount }} 节</span>
    </div>

    <template v-if="state === 'ongoing' || state === 'next'">
      <p class="hero-eyebrow">
        <span class="hero-pulse" aria-hidden="true" />
        {{ state === 'ongoing' ? '正在上课' : '下一节课' }}
      </p>
      <p class="hero-subject">
        {{ subject }}<span class="hero-class">{{ className }}</span>
      </p>
      <p class="hero-meta">
        {{ timeLabel }}
        <span class="hero-dot" aria-hidden="true"> · </span>
        {{ state === 'ongoing' ? `剩 ${minutesLeft} 分钟` : `${minutesLeft} 分钟后上课` }}
      </p>
    </template>

    <template v-else-if="state === 'done'">
      <p class="hero-subject hero-subject--soft">今天课上完啦</p>
      <p class="hero-meta">全部课程已结束，安心批作业。</p>
    </template>

    <template v-else>
      <p class="hero-subject hero-subject--soft">今天没有课</p>
      <p class="hero-meta">课程表里没有今天的安排，好好休息。</p>
    </template>
  </div>
</template>

<style scoped>
.schedule-hero {
  min-height: 170px;
  padding: var(--spacing-lg) var(--spacing-xl);
  border-radius: var(--radius-xl);
  background: linear-gradient(
    120deg,
    var(--color-primary-bg) 0%,
    rgba(111, 168, 220, 0.08) 55%,
    transparent 100%
  );
  border: 1px solid var(--color-border-light);
  opacity: 0;
  transform: translateY(6px);
  transition:
    opacity var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}

.schedule-hero.is-entered {
  opacity: 1;
  transform: translateY(0);
}

.hero-top {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.hero-badge {
  padding: 3px 10px;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  color: #ffffff;
  font-size: var(--font-caption);
  font-weight: var(--font-weight-semibold);
}

.hero-count {
  font-size: var(--font-secondary);
  color: var(--color-text-secondary);
}

.hero-eyebrow {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: var(--space-3);
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-semibold);
  color: var(--color-primary-dark);
}

.hero-pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-primary);
  animation: hero-pulse 2s ease-in-out infinite;
}

@keyframes hero-pulse {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.35;
  }
}

.hero-subject {
  margin-top: var(--space-2);
  font-size: 32px;
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.02em;
  line-height: var(--leading-tight);
  color: var(--color-text-primary);
  overflow-wrap: anywhere;
}

.hero-class {
  margin-left: var(--space-3);
  font-size: var(--text-lg);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
}

.hero-subject--soft {
  font-size: 26px;
  color: var(--color-text-secondary);
}

.hero-meta {
  margin-top: var(--space-2);
  font-size: var(--font-content);
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}

.hero-dot {
  color: var(--color-text-faint);
}

@media (max-width: 640px) {
  .schedule-hero {
    min-height: 0;
    padding: var(--spacing-card);
  }

  .hero-subject {
    font-size: var(--text-xl);
  }

  .hero-subject--soft {
    font-size: var(--text-lg);
  }

  .hero-meta {
    font-size: var(--font-secondary);
  }
}
</style>
