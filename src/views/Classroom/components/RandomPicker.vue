<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { Dices, Target } from 'lucide-vue-next'

import { useDutyStore } from '@/stores/duty'
import { useStudentStore } from '@/stores/student'

import {
  PICK_MODES,
  PICK_ROLL_MS,
  PICK_TICK_MS,
  canTrigger,
  drawOnce,
  pickPoolFor,
  rollFrame,
  type PickMode,
} from '@/utils/classroom'

import ResultDisplay from './ResultDisplay.vue'
import ToolCard from './ToolCard.vue'

/**
 * RandomPicker — 随机点名（V2.3.0-alpha · Phase Classroom-1，最高优先级）。
 *
 * 四种模式：全班 / 男生 / 女生 / **今日值日组**（当天没有值日组时给可读空态）。
 * 点「开始点名」后滚动约 1 秒（12 帧换名）再定格，姓名居中放大；再点一次即重新抽。
 * 数据直接读 Student / Duty store（**不复制学生数据**），重名消歧用公共件。
 */
const studentStore = useStudentStore()
const dutyStore = useDutyStore()

const mode = ref<PickMode>('all')
const rolling = ref(false)
const resultText = ref('')
const resultStudentId = ref<string | null>(null)
const emptyReason = ref('')

let rollTimer: ReturnType<typeof setInterval> | null = null
let stopTimer: ReturnType<typeof setTimeout> | null = null
/** 上一次开抽的时刻（RC-03 防连点：动画期间 + 刚定格的一瞬都不重开） */
let lastDrawnAt: number | null = null

/** 在读学生（点名池的唯一来源） */
const roster = computed(() => studentStore.activeStudents)
/** 重名消歧的计数来自 store（v3.3.1 唯一来源），本组件不再自己算一份 */
const nameCounts = computed(() => studentStore.nameCounts)

/** 今日值日组的组员 id（当天没有值日组 → 空数组） */
const todayGroupIds = computed(() => dutyStore.todayGroup?.studentIds ?? [])

const pool = computed(() => {
  const byId = new Map(roster.value.map((student) => [student.id, student]))
  return pickPoolFor(mode.value, roster.value, todayGroupIds.value).filter((student) =>
    byId.has(student.id),
  )
})

const poolCount = computed(() => pool.value.length)

/** 今日值日组模式下，把组名显示在提示里（教师一眼知道抽的是谁那一组） */
const dutyHint = computed(() => {
  if (mode.value !== 'duty') return ''
  return dutyStore.todayGroup ? `今日值日：${dutyStore.todayGroup.name}` : '今天没有值日组'
})

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

/** 换模式就清掉上一次的结果，避免「显示的是上一池的人」 */
function selectMode(next: PickMode): void {
  if (rolling.value) return
  mode.value = next
  resultText.value = ''
  resultStudentId.value = null
  emptyReason.value = ''
}

function start(): void {
  if (rolling.value) return
  // RC-03 防连点：讲台上连点两下不该抽出两个人（窗口 = 一次滚动动画的时长）
  const now = Date.now()
  if (!canTrigger(lastDrawnAt, now)) return
  lastDrawnAt = now
  clearTimers()
  emptyReason.value = ''
  resultStudentId.value = null

  const candidates = pool.value
  if (candidates.length === 0) {
    // 空池：立刻给出可读原因（不做无意义的滚动）
    const outcome = drawOnce(mode.value, roster.value, todayGroupIds.value, nameCounts.value)
    emptyReason.value = outcome.emptyReason ?? '没有可点名的学生'
    resultText.value = ''
    return
  }

  rolling.value = true
  let tick = Math.floor(Math.random() * candidates.length)
  rollTimer = setInterval(() => {
    tick += 1
    resultText.value = rollFrame(candidates, nameCounts.value, tick)
  }, PICK_TICK_MS)

  stopTimer = setTimeout(() => {
    clearTimers()
    const outcome = drawOnce(mode.value, roster.value, todayGroupIds.value, nameCounts.value)
    resultText.value = outcome.displayName ?? ''
    resultStudentId.value = outcome.student?.id ?? null
    rolling.value = false
  }, PICK_ROLL_MS)
}

onBeforeUnmount(clearTimers)

/** 结果区展示：滚动中显示滚动帧；空池显示原因；否则显示姓名 */
const displayValue = computed(() => {
  if (emptyReason.value) return emptyReason.value
  if (rolling.value) return resultText.value || '…'
  return resultText.value || '点「开始点名」'
})
</script>

<template>
  <ToolCard
    title="随机点名"
    description="全班 / 男生 / 女生 / 今日值日组，滚动约 1 秒后定格"
    :icon="Target"
  >
    <div class="mode-row" role="group" aria-label="点名范围">
      <button
        v-for="option in PICK_MODES"
        :key="option.key"
        type="button"
        class="mode-btn"
        :class="{ 'is-active': mode === option.key }"
        :aria-pressed="mode === option.key"
        :disabled="rolling"
        @click="selectMode(option.key)"
      >
        {{ option.label }}
      </button>
    </div>

    <p class="pool-line">
      候选 {{ poolCount }} 人<span v-if="dutyHint"> · {{ dutyHint }}</span>
    </p>

    <ResultDisplay
      label="今天请回答"
      :value="displayValue"
      size="name"
      :rolling="rolling"
      :empty="Boolean(emptyReason)"
    />

    <template #footer>
      <button
        type="button"
        class="start-btn"
        :disabled="rolling"
        :aria-label="resultStudentId ? '再抽一次' : '开始点名'"
        @click="start"
      >
        <Dices :size="20" :stroke-width="2" aria-hidden="true" />
        {{ rolling ? '点名中…' : resultStudentId ? '再抽一次' : '开始点名' }}
      </button>
    </template>
  </ToolCard>
</template>

<style scoped>
.mode-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.mode-btn {
  flex: 1 1 auto;
  min-height: 44px;
  padding: 0 var(--space-4);
  border: var(--border-hairline-width) solid var(--color-border);
  border-radius: var(--radius-full);
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

.mode-btn:hover:not(:disabled) {
  border-color: var(--color-border-medium);
  color: var(--color-text-primary);
}

.mode-btn.is-active {
  background: var(--color-primary-bg);
  border-color: var(--color-primary);
  color: var(--color-primary-strong);
}

.mode-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 候选信息缩小（v3.3.0）：它是「这一池有多少人」的说明，不是主角——
   主角是下面那行大字。压到 12px / 三级色，教师扫一眼有数即可，不跟结果抢注意力。 */
.pool-line {
  margin: 0;
  font-size: var(--font-caption);
  color: var(--color-text-faint, var(--color-text-tertiary));
  text-align: center;
}

.start-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: 56px;
  border: none;
  border-radius: var(--radius-lg);
  background: var(--color-primary);
  color: var(--color-text-inverse);
  font-family: inherit;
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
  cursor: pointer;
  transition:
    background var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}

.start-btn:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.start-btn:active:not(:disabled) {
  transform: scale(0.99);
}

.start-btn:disabled {
  opacity: 0.7;
  cursor: progress;
}
</style>
