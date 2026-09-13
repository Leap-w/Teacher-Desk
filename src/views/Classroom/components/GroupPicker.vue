<script setup lang="ts">
import { computed, ref } from 'vue'
import { Shapes } from 'lucide-vue-next'

import { useDutyStore } from '@/stores/duty'
import { pickRandomGroup, type LotteryGroup } from '@/utils/classroom'

import ResultDisplay from './ResultDisplay.vue'
import ToolCard from './ToolCard.vue'

/**
 * GroupPicker — 抽签（V2.3.0-alpha · Phase Classroom-1）。
 *
 * 读 Duty Store 的**现有值日组**（不新增分组模型）：列出各组（点一下抽它 / 或点「随机抽一组」），
 * 结果大号显示「🎲 第2组」这种组名——组名口径完全来自值日管理。
 */
const dutyStore = useDutyStore()

const resultName = ref('')
const rolling = ref(false)

/** 组 → 抽签用投影（含组员数，签到台上一眼看出这组几个人） */
const groups = computed<LotteryGroup[]>(() =>
  dutyStore.groups.map((group) => ({
    id: group.id,
    name: group.name,
    memberCount: group.studentIds.length,
  })),
)

const hasGroups = computed(() => groups.value.length > 0)

function show(group: LotteryGroup | undefined): void {
  if (!group) {
    resultName.value = '还没有值日组'
    return
  }
  resultName.value = group.name
}

/** 抽签：滚动 1 秒（与点名同一节奏）后定格 */
function draw(): void {
  if (!hasGroups.value || rolling.value) {
    show(undefined)
    return
  }
  rolling.value = true
  const startedAt = Date.now()
  const step = (): void => {
    show(pickRandomGroup(groups.value))
    if (Date.now() - startedAt < 1000) {
      setTimeout(step, 90)
      return
    }
    show(pickRandomGroup(groups.value))
    rolling.value = false
  }
  step()
}
</script>

<template>
  <ToolCard title="抽签" description="从值日组里随机抽一组（组名来自值日管理）" :icon="Shapes">
    <ResultDisplay
      label="抽签结果"
      :value="resultName || (hasGroups ? '点「随机抽一组」' : '还没有值日组')"
      size="group"
      :rolling="rolling"
      :empty="!hasGroups"
    />

    <div class="group-row" role="group" aria-label="值日组">
      <button
        v-for="group in groups"
        :key="group.id"
        type="button"
        class="group-btn"
        :class="{ 'is-active': resultName === group.name }"
        @click="show(group)"
      >
        {{ group.name }}
        <span class="group-count">{{ group.memberCount }} 人</span>
      </button>
    </div>

    <button type="button" class="draw-btn" :disabled="!hasGroups || rolling" @click="draw">
      {{ rolling ? '抽签中…' : '随机抽一组' }}
    </button>
  </ToolCard>
</template>

<style scoped>
.group-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.group-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 48px;
  padding: 0 var(--space-4);
  border: var(--border-hairline-width) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  font-family: inherit;
  font-size: var(--font-content);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background var(--duration-base) var(--ease-out),
    color var(--duration-base) var(--ease-out),
    border-color var(--duration-base) var(--ease-out);
}

.group-btn:hover {
  border-color: var(--color-border-medium);
  color: var(--color-text-primary);
}

.group-btn.is-active {
  background: var(--color-primary-bg);
  border-color: var(--color-primary);
  color: var(--color-primary-strong);
}

.group-count {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.draw-btn {
  min-height: 56px;
  border: none;
  border-radius: var(--radius-lg);
  background: var(--color-primary);
  font-family: inherit;
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-inverse);
  cursor: pointer;
  transition: background var(--duration-base) var(--ease-out);
}

.draw-btn:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.draw-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
</style>
