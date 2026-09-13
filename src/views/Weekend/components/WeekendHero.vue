<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AppButton } from '@/components/ui'
import { Luggage } from 'lucide-vue-next'

/**
 * WeekendHero — 周末返校 Hero（V2.0.7-alpha · Phase UI-4E，Return First 视觉中心）：
 * 期次 + 返家 / 留校人数；极轻渐变、进入 200ms 渐入。
 * 数据模型只记「是否返家」（留校 = 在读 − 返家，派生口径），不发明返校时刻。
 */
const props = defineProps<{
  /** 期次相对文案（本周末 / 上周末 / N 周后） */
  relativeLabel: string
  /** 期次完整文案（如「9月12日 – 9月13日 周末」） */
  periodLabel: string
  returnedCount: number
  stayCount: number
}>()

const emit = defineEmits<{
  register: []
}>()

const entered = ref(false)
onMounted(() => {
  requestAnimationFrame(() => {
    entered.value = true
  })
})

const returnRate = computed(() => {
  const total = props.returnedCount + props.stayCount
  if (total === 0) return null
  return `${Math.round((props.returnedCount / total) * 100)}%`
})
</script>

<template>
  <div class="weekend-hero" :class="{ 'is-entered': entered }">
    <div class="hero-main">
      <div class="hero-top">
        <span class="hero-badge">{{ relativeLabel }}</span>
        <span class="hero-period">{{ periodLabel }}</span>
      </div>
      <div class="hero-numbers">
        <div class="hero-num">
          <span class="hero-num-value">{{ returnedCount }}</span>
          <span class="hero-num-label">返家</span>
        </div>
        <span class="hero-divider" aria-hidden="true" />
        <div class="hero-num">
          <span class="hero-num-value">{{ stayCount }}</span>
          <span class="hero-num-label">留校</span>
        </div>
        <span v-if="returnRate" class="hero-rate">返家率 {{ returnRate }}</span>
      </div>
      <p class="hero-hint">返家的学生周末人不在校；没登记的即视为留校。</p>
    </div>
    <AppButton class="hero-action" @click="emit('register')">
      <Luggage :size="16" :stroke-width="2" aria-hidden="true" />
      登记返家
    </AppButton>
  </div>
</template>

<style scoped>
.weekend-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  min-height: 160px;
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

.weekend-hero.is-entered {
  opacity: 1;
  transform: translateY(0);
}

.hero-main {
  min-width: 0;
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
  color: var(--color-text-inverse);
  font-size: var(--font-caption);
  font-weight: var(--font-weight-semibold);
}

.hero-period {
  font-size: var(--font-secondary);
  color: var(--color-text-secondary);
}

.hero-numbers {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  margin-top: var(--space-3);
}

.hero-num {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

.hero-num-value {
  font-size: 34px;
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.02em;
  line-height: 1.1;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}

.hero-num-label {
  font-size: var(--font-secondary);
  color: var(--color-text-secondary);
}

.hero-divider {
  width: 1px;
  height: 28px;
  background: var(--color-border);
}

.hero-rate {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.hero-hint {
  margin-top: var(--space-2);
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.hero-action {
  flex-shrink: 0;
}

.hero-empty-strip {
  margin-top: var(--space-3);
  padding: var(--space-2) 0;
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
}

@media (max-width: 640px) {
  .weekend-hero {
    flex-direction: column;
    align-items: stretch;
    min-height: 0;
    padding: var(--spacing-card);
  }

  .hero-num-value {
    font-size: 28px;
  }
}
</style>
