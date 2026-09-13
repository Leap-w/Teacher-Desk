<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

/**
 * TasksHero — 今日任务 Hero（V2.0.9-alpha · Phase UI-5B）：
 * Action First 第一层。今天日期 + 今日未完成/已完成 + 逾期警示。
 * 极轻渐变 + 200ms 渐入；未完成 > 0 时未完成数字强调。
 */
const props = defineProps<{
  dateLabel: string
  todayOpen: number
  todayDone: number
  overdue: number
}>()

const entered = ref(false)
onMounted(() => {
  requestAnimationFrame(() => {
    entered.value = true
  })
})

const doneHint = computed(() =>
  props.todayDone > 0 ? `今日已完成 ${props.todayDone} 项` : '今天还没有完成的任务',
)
</script>

<template>
  <section class="tasks-hero" :class="{ 'is-entered': entered }">
    <div class="hero-text">
      <p class="hero-date">{{ dateLabel }}</p>
      <h1 class="hero-title">
        今日<span class="hero-strong">{{ todayOpen }}</span> 项待办
      </h1>
      <p class="hero-hint">
        {{ doneHint }}
        <span v-if="overdue > 0" class="hero-overdue">· 逾期 {{ overdue }} 项</span>
      </p>
    </div>
    <div class="hero-actions">
      <slot name="actions" />
    </div>
  </section>
</template>

<style scoped>
.tasks-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-5) var(--space-6);
  border: var(--border-hairline-width) solid var(--color-border-light);
  border-radius: var(--radius-xl);
  background: linear-gradient(135deg, var(--color-primary-bg) 0%, var(--bg-card) 62%);
  box-shadow: var(--shadow-xs);
  opacity: 0;
  transform: translateY(6px);
  transition:
    opacity var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}

.tasks-hero.is-entered {
  opacity: 1;
  transform: translateY(0);
}

.hero-date {
  margin: 0;
  font-size: var(--font-secondary);
  color: var(--color-text-secondary);
}

.hero-title {
  margin: var(--space-1) 0;
  font-size: var(--font-display);
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.02em;
  color: var(--color-text-primary);
}

.hero-strong {
  margin: 0 4px;
  color: var(--color-primary-strong);
}

.hero-hint {
  margin: 0;
  font-size: var(--font-secondary);
  color: var(--color-text-tertiary);
}

.hero-overdue {
  color: var(--color-danger-strong);
  font-weight: var(--font-weight-medium);
}

.hero-actions {
  display: flex;
  gap: var(--space-2);
  flex-shrink: 0;
}

@media (max-width: 640px) {
  .tasks-hero {
    padding: var(--space-4);
  }

  .hero-actions {
    display: none;
  }
}
</style>
