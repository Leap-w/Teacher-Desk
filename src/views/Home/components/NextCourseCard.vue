<script setup lang="ts">
import { BookOpen, CheckCircle2, MoonStar } from 'lucide-vue-next'

/**
 * NextCourseCard — 首页「下一节课」大卡（V2.0.2-alpha · Phase UI-3）：
 * 首页信息密度最高的卡片。状态机：
 * ongoing = 正在上课（显示剩余分钟）；next = 即将上课；done = 今天课上完；empty = 今天没课。
 * 无课 / 未排课走 EmptyState 占位，不伪造课程数据。
 */
defineProps<{
  state: 'ongoing' | 'next' | 'done' | 'empty'
  subject?: string
  className?: string
  /** 如「第2节 · 09:20-10:00」 */
  timeLabel?: string
  /** 剩余分钟数（ongoing 用） */
  minutesLeft?: number
  /** 空态说明（empty 用） */
  emptyHint?: string
}>()
</script>

<template>
  <div class="next-course" :class="`is-${state}`">
    <template v-if="state === 'ongoing' || state === 'next'">
      <p class="next-course__eyebrow">
        <span class="next-course__pulse" aria-hidden="true" />
        {{ state === 'ongoing' ? '正在上课' : '下一节课' }}
      </p>
      <p class="next-course__subject">{{ subject }}</p>
      <p class="next-course__meta">
        <span class="next-course__class">{{ className }}</span>
        <span class="next-course__dot" aria-hidden="true">·</span>
        <span>{{ timeLabel }}</span>
      </p>
      <span class="next-course__countdown" aria-live="polite">
        <component
          :is="state === 'ongoing' ? CheckCircle2 : BookOpen"
          :size="16"
          :stroke-width="2"
          aria-hidden="true"
        />
        {{ state === 'ongoing' ? `剩 ${minutesLeft} 分钟` : `${minutesLeft} 分钟后上课` }}
      </span>
    </template>

    <template v-else-if="state === 'done'">
      <span class="next-course__done-icon" aria-hidden="true">
        <CheckCircle2 :size="28" :stroke-width="1.8" />
      </span>
      <p class="next-course__subject next-course__subject--soft">今天课上完啦</p>
      <p class="next-course__meta">全部课程已结束，安心批作业。</p>
    </template>

    <template v-else>
      <span class="next-course__done-icon" aria-hidden="true">
        <MoonStar :size="28" :stroke-width="1.8" />
      </span>
      <p class="next-course__subject next-course__subject--soft">今天没有课</p>
      <p class="next-course__meta">{{ emptyHint ?? '课程表里也没有今天的安排。' }}</p>
    </template>
  </div>
</template>

<style scoped>
.next-course {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 220px;
  padding: var(--spacing-lg) var(--spacing-xl);
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-card);
}

.next-course__eyebrow {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-semibold);
  color: var(--color-primary-dark);
}

.next-course__pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-primary);
}

.is-next .next-course__pulse {
  animation: pulse-soft 2s ease-in-out infinite;
}

@keyframes pulse-soft {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.35;
  }
}

.next-course__subject {
  margin-top: var(--space-2);
  font-size: var(--font-num-2xl);
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.02em;
  line-height: var(--leading-tight);
  color: var(--color-text-primary);
}

.next-course__subject--soft {
  font-size: var(--font-num-sm);
  color: var(--color-text-secondary);
}

.next-course__meta {
  margin-top: var(--space-2);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--font-content);
  color: var(--color-text-secondary);
}

.next-course__class {
  font-weight: var(--font-weight-medium);
}

.next-course__dot {
  opacity: 0.6;
}

.next-course__countdown {
  margin-top: var(--space-4);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  padding: 6px 12px;
  border-radius: var(--radius-full);
  background: var(--color-primary-soft);
  color: var(--color-primary-dark);
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
}

.next-course__done-icon {
  color: var(--color-primary);
  opacity: 0.85;
  margin-bottom: var(--space-2);
}

@media (max-width: 640px) {
  .next-course {
    min-height: 0;
    padding: var(--spacing-card);
  }

  .next-course__subject {
    font-size: var(--text-xl);
  }

  .next-course__subject--soft {
    font-size: var(--text-lg);
  }

  .next-course__meta {
    font-size: var(--font-secondary);
  }
}
</style>
