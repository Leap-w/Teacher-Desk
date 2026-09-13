<script setup lang="ts">
import { onMounted, ref } from 'vue'

/**
 * DashboardHero — Dashboard 一级 Hero（V2.0.2-alpha · Phase UI-3 沉淀）：
 * 问候 + 日期 + 右侧身份标签；约 200px 高、极轻渐变、无重阴影（Apple 风）。
 * 首次进入轻渐入（200ms）。学生档案等模块页可直接复用。
 */
defineProps<{
  /** 问候语，如「早上好，王老师」 */
  greeting: string
  /** 日期行，如「今天是 2026 年 9 月 13 日 · 星期日」 */
  dateLine: string
  /** 右侧身份标签（当前班级 / 当前身份） */
  badges?: string[]
}>()

const entered = ref(false)
onMounted(() => {
  requestAnimationFrame(() => {
    entered.value = true
  })
})
</script>

<template>
  <div class="dash-hero" :class="{ 'is-entered': entered }">
    <div class="dash-hero__text">
      <h1 class="dash-hero__greeting">{{ greeting }}</h1>
      <p class="dash-hero__date">{{ dateLine }}</p>
    </div>
    <div v-if="badges && badges.length" class="dash-hero__badges">
      <span v-for="badge in badges" :key="badge" class="dash-hero__badge">{{ badge }}</span>
    </div>
  </div>
</template>

<style scoped>
.dash-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4);
  min-height: 200px;
  padding: var(--spacing-lg) var(--spacing-xl);
  border-radius: var(--radius-xl);
  /* 极轻渐变：松石青 → 天空蓝 → 透明，不大面积纯色 */
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

.dash-hero.is-entered {
  opacity: 1;
  transform: translateY(0);
}

.dash-hero__greeting {
  font-size: var(--font-num-xl);
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.02em;
  line-height: var(--leading-tight);
  color: var(--color-text-primary);
}

.dash-hero__date {
  margin-top: var(--space-2);
  font-size: var(--font-content);
  color: var(--color-text-secondary);
}

.dash-hero__badges {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--space-2);
  flex-shrink: 0;
}

.dash-hero__badge {
  padding: 5px 12px;
  border-radius: var(--radius-full);
  background: var(--glass-bg);
  border: 1px solid var(--color-border-light);
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  white-space: nowrap;
}

@media (max-width: 640px) {
  .dash-hero {
    flex-direction: column;
    align-items: flex-start;
    min-height: 0;
    padding: var(--spacing-card) var(--spacing-card);
  }

  .dash-hero__greeting {
    font-size: var(--text-xl);
  }

  .dash-hero__date {
    font-size: var(--font-secondary);
  }

  .dash-hero__badges {
    flex-direction: row;
    align-items: center;
  }
}
</style>
