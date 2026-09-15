<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { Shapes } from 'lucide-vue-next'

import { useDutyStore } from '@/stores/duty'
import {
  PICK_ROLL_MS,
  PICK_TICK_MS,
  canTrigger,
  pickRandomGroup,
  type LotteryGroup,
} from '@/utils/classroom'

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

let rollTimer: ReturnType<typeof setInterval> | null = null
let stopTimer: ReturnType<typeof setTimeout> | null = null
/** 上一次开抽的时刻（RC-03 防连点：与点名同一档窗口） */
let lastDrawnAt: number | null = null

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

function clearTimers(): void {
  if (rollTimer !== null) {
    clearInterval(rollTimer)
    rollTimer = null
  }
  if (stopTimer !== null) {
    clearTimeout(stopTimer)
    stopTimer = null
  }
}

/** 抽签：滚动 1 秒（与点名同一节奏）后定格；离开页面时把定时器收干净 */
function draw(): void {
  if (!hasGroups.value) {
    show(undefined)
    return
  }
  if (rolling.value) return
  // RC-03 防连点：与随机点名同一档窗口
  const now = Date.now()
  if (!canTrigger(lastDrawnAt, now)) return
  lastDrawnAt = now

  clearTimers()
  rolling.value = true
  rollTimer = setInterval(() => show(pickRandomGroup(groups.value)), PICK_TICK_MS)
  stopTimer = setTimeout(() => {
    clearTimers()
    show(pickRandomGroup(groups.value))
    rolling.value = false
  }, PICK_ROLL_MS)
}

onBeforeUnmount(clearTimers)
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
        :disabled="rolling"
        @click="show(group)"
      >
        {{ group.name }}
        <span class="group-count">{{ group.memberCount }} 人</span>
      </button>
    </div>

    <template #footer>
      <button type="button" class="draw-btn" :disabled="!hasGroups || rolling" @click="draw">
        {{ rolling ? '抽签中…' : '随机抽一组' }}
      </button>
    </template>
  </ToolCard>
</template>

<style scoped>
/*
  值日组按钮：可换行，但**限高内滚**（v3.3.0）。
  组多的时候（十几个组）任它长会把整张卡撑高，三张卡立刻不等高、底部按钮错位——
  这里是「换一个组看结果」的快捷入口，不是主内容，限高滚动是它该有的分量。
*/
.group-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  max-height: 104px;
  overflow-y: auto;
}

.group-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  padding: 0 var(--space-3);
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

/* 滚动期间不许改结果（点了也只是改显示，和「抽签中」打架） */
.group-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
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
