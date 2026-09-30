<script setup lang="ts">
import { computed } from 'vue'

import type { HolidayCardFilter } from '@/utils/holidayQuery'

/**
 * HolidayStatCards — 顶部三张统计卡片，**同时是三档快捷筛选的入口**（v3.6.2 规格第 7–9 节）。
 *
 *     离校          = 登记了回家的学生
 *     留校          = 没有登记回家的学生（留校 + 离校 = 全班）
 *     昌都市外离校  = 离校 ∩ familyLocation.scope === 昌都市外
 *
 * 三个数字的关系是**全部学生 = 留校 + 离校**，而「昌都市外离校」是「离校」里的一个维度，
 * 不是第三种状态——所以它没有自己的底色，用与「离校」同一族的主色系，
 * 只靠标题里的「昌都市外」限定语与卡片上的小图标区分。
 *
 * 交互（规格第 9 节）：
 * - 点一张卡片 = 按它筛选当前名单，被选中的卡片有明确的 active 视觉（描边 + 底色 + 字重）；
 * - **再点当前已激活的卡片 = 取消筛选**，回到全部学生——不新增第四张「全部」卡片。
 */
const props = defineProps<{
  /** 离校人数 */
  home: number
  /** 留校人数 */
  stay: number
  /** 昌都市外离校人数 */
  outside: number
  /** 当前生效的卡片筛选；undefined = 全部学生 */
  active?: HolidayCardFilter
}>()

const emit = defineEmits<{ select: [card: HolidayCardFilter] }>()

const cards = computed<
  { key: HolidayCardFilter; label: string; count: number; hint: string; tone: string }[]
>(() => [
  {
    key: 'home',
    label: '离校',
    count: props.home,
    hint: '点了回家的学生',
    tone: 'is-home',
  },
  {
    key: 'stay',
    label: '留校',
    count: props.stay,
    hint: '没有登记回家的学生',
    tone: 'is-stay',
  },
  {
    key: 'outside',
    label: '昌都市外离校',
    count: props.outside,
    hint: '离校且家庭所在地在昌都市外',
    tone: 'is-outside',
  },
])

/** 再点一次已激活的卡片 = 取消筛选（交互说明见组件注释） */
function pick(card: HolidayCardFilter): void {
  emit('select', card)
}
</script>

<template>
  <section class="stat-cards" aria-label="假期去向统计与筛选">
    <button
      v-for="card in cards"
      :key="card.key"
      type="button"
      class="stat-card"
      :class="[card.tone, { 'is-active': active === card.key }]"
      :aria-pressed="active === card.key"
      :title="card.hint"
      @click="pick(card.key)"
    >
      <span class="stat-num">{{ card.count }}</span>
      <span class="stat-label">{{ card.label }}</span>
      <span class="stat-unit">人</span>
    </button>
  </section>
</template>

<style scoped>
.stat-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-2);
}

.stat-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  /* 8pt 体系：卡片内边距取 --space-3 / --space-2 这一档 */
  padding: var(--space-3) var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  background: var(--color-fill-disabled);
  cursor: pointer;
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-fast);
}

.stat-card.is-home {
  background: var(--color-primary-soft);
}

.stat-card.is-stay {
  background: var(--color-success-soft);
}

/* 第三张卡不是第三种状态，用主色系最浅的一档，避免读成「又一个状态」 */
.stat-card.is-outside {
  background: var(--color-primary-bg);
}

.stat-card:hover {
  border-color: var(--color-border);
}

.stat-card:active {
  transform: scale(0.985);
}

.stat-card:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

/* 选中态：描边 + 更实的底色 + 数字加重——与另外两张一眼可辨 */
.stat-card.is-active {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 1px var(--color-primary) inset;
}

.stat-card.is-active::after {
  content: '';
  position: absolute;
  top: 6px;
  right: 8px;
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--color-primary);
}

.stat-num {
  font-size: var(--text-xl);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-primary);
  line-height: 1.15;
}

.stat-label {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  text-align: center;
}

.stat-unit {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  font-size: var(--font-caption);
  color: var(--color-text-faint);
}

.stat-card.is-active .stat-label {
  color: var(--color-primary-dark);
  font-weight: var(--font-weight-medium);
}

@media (max-width: 420px) {
  .stat-label {
    font-size: 11px;
  }

  .stat-num {
    font-size: var(--text-lg);
  }
}
</style>
