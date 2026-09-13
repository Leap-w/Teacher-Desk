<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { Pause, Play, RotateCcw, Timer } from 'lucide-vue-next'

import { useToast } from '@/composables/useToast'
import {
  TIMER_MAX_MINUTES,
  TIMER_MIN_MINUTES,
  TIMER_PRESETS_MIN,
  formatDuration,
  isValidMinutes,
  isFinished,
  nextPhase,
  remainingMs,
  timerProgress,
  type TimerPhase,
} from '@/utils/classroom'

import ResultDisplay from './ResultDisplay.vue'
import ToolCard from './ToolCard.vue'

/**
 * TimerCard — 课堂计时器（V2.3.0-alpha · Phase Classroom-1）。
 *
 * 预设 1 / 3 / 5 / 10 分钟 + 自定义分钟数；开始 / 暂停 / 重置三个大按钮；
 * 超大数字居中、秒级刷新；到点时**页面轻提示**（Toast），不依赖系统通知。
 * 计时用「起点时刻 + 已累计」算，不用累加 tick——切后台再回来也不会走偏。
 */
const toast = useToast()

const minutes = ref<number>(TIMER_PRESETS_MIN[0])
const phase = ref<TimerPhase>('idle')
const elapsed = ref(0)
const customOpen = ref(false)
const customValue = ref('')

let timer: ReturnType<typeof setInterval> | null = null
let startedAt = 0

const totalMs = computed(() => minutes.value * 60_000)
const leftMs = computed(() => remainingMs(totalMs.value, elapsed.value))
const display = computed(() => formatDuration(leftMs.value))
const progress = computed(() => timerProgress(totalMs.value, elapsed.value))
const finished = computed(() => isFinished(totalMs.value, elapsed.value))

function stopTicking(): void {
  if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
}

function startTicking(): void {
  stopTicking()
  startedAt = Date.now() - elapsed.value
  timer = setInterval(() => {
    elapsed.value = Date.now() - startedAt
    if (elapsed.value >= totalMs.value) {
      elapsed.value = totalMs.value
      stopTicking()
      phase.value = 'finished'
      // 结束提示：页面内轻提示（拍板：不用系统通知）
      toast.success(`时间到（${minutes.value} 分钟）`)
    }
  }, 250) // 250ms 刷新一次：秒级数字不会跳秒，也不浪费
}

function onStart(): void {
  const next = nextPhase(phase.value, 'start')
  if (next === 'paused') {
    phase.value = 'paused'
    stopTicking()
    return
  }
  // 已结束 / 空闲：从零开始
  if (phase.value === 'finished' || phase.value === 'idle') elapsed.value = 0
  phase.value = 'running'
  startTicking()
}

function onReset(): void {
  stopTicking()
  phase.value = nextPhase(phase.value, 'reset')
  elapsed.value = 0
}

function selectPreset(value: number): void {
  if (phase.value === 'running') return
  minutes.value = value
  phase.value = 'idle'
  elapsed.value = 0
  customOpen.value = false
}

function applyCustom(): void {
  const parsed = Number(customValue.value.trim())
  if (!isValidMinutes(parsed)) {
    toast.danger(`请输入 ${TIMER_MIN_MINUTES}–${TIMER_MAX_MINUTES} 之间的整数分钟`)
    return
  }
  minutes.value = parsed
  phase.value = 'idle'
  elapsed.value = 0
  customOpen.value = false
}

onBeforeUnmount(stopTicking)
</script>

<template>
  <ToolCard title="课堂计时器" description="1 / 3 / 5 / 10 分钟或自定义，秒级刷新" :icon="Timer">
    <div class="preset-row" role="group" aria-label="预设时间">
      <button
        v-for="preset in TIMER_PRESETS_MIN"
        :key="preset"
        type="button"
        class="preset-btn"
        :class="{ 'is-active': minutes === preset && !customOpen }"
        :disabled="phase === 'running'"
        @click="selectPreset(preset)"
      >
        {{ preset }} 分钟
      </button>
      <button
        type="button"
        class="preset-btn is-custom"
        :class="{ 'is-active': customOpen }"
        :disabled="phase === 'running'"
        @click="customOpen = !customOpen"
      >
        自定义
      </button>
    </div>

    <div v-if="customOpen" class="custom-row">
      <input
        v-model="customValue"
        class="custom-input"
        type="number"
        inputmode="numeric"
        :min="TIMER_MIN_MINUTES"
        :max="TIMER_MAX_MINUTES"
        placeholder="分钟数"
        aria-label="自定义分钟数"
        @keydown.enter="applyCustom"
      />
      <button type="button" class="custom-apply" @click="applyCustom">确定</button>
    </div>

    <ResultDisplay
      label="剩余时间"
      :value="display"
      size="timer"
      :rolling="phase === 'running'"
      :empty="false"
    />

    <div class="progress-track" aria-hidden="true">
      <div class="progress-fill" :style="{ width: `${progress * 100}%` }"></div>
    </div>

    <div class="control-row">
      <button type="button" class="ctrl-btn is-primary" @click="onStart">
        <Play v-if="phase !== 'running'" :size="20" stroke-width="2" aria-hidden="true" />
        <Pause v-else :size="20" stroke-width="2" aria-hidden="true" />
        {{ phase === 'running' ? '暂停' : phase === 'paused' ? '继续' : '开始' }}
      </button>
      <button type="button" class="ctrl-btn" @click="onReset">
        <RotateCcw :size="20" stroke-width="2" aria-hidden="true" />
        重置
      </button>
    </div>

    <p class="timer-hint">
      <template v-if="finished">时间到（{{ minutes }} 分钟），已提示</template>
      <template v-else-if="phase === 'running'">计时中…</template>
      <template v-else-if="phase === 'paused'">已暂停</template>
      <template v-else>当前设定 {{ minutes }} 分钟</template>
    </p>
  </ToolCard>
</template>

<style scoped>
.preset-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.preset-btn {
  flex: 1 1 96px;
  min-height: 48px;
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

.preset-btn:hover:not(:disabled) {
  border-color: var(--color-border-medium);
  color: var(--color-text-primary);
}

.preset-btn.is-active {
  background: var(--color-primary-bg);
  border-color: var(--color-primary);
  color: var(--color-primary-strong);
}

.preset-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.custom-row {
  display: flex;
  gap: var(--space-2);
}

.custom-input {
  flex: 1;
  min-height: 48px;
  padding: 0 var(--space-3);
  border: var(--border-hairline-width) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  font-family: inherit;
  font-size: var(--font-content);
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}

.custom-apply {
  min-height: 48px;
  padding: 0 var(--space-5);
  border: none;
  border-radius: var(--radius-md);
  background: var(--color-fill-disabled);
  font-family: inherit;
  font-size: var(--font-content);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  cursor: pointer;
}

.progress-track {
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--color-fill-disabled);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  transition: width 250ms linear;
}

.control-row {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: var(--space-2);
}

.ctrl-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: 56px;
  border: var(--border-hairline-width) solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  font-family: inherit;
  font-size: var(--text-lg);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  cursor: pointer;
  transition:
    background var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}

.ctrl-btn.is-primary {
  border: none;
  background: var(--color-primary);
  color: var(--color-text-inverse);
  font-weight: var(--font-weight-semibold);
}

.ctrl-btn.is-primary:hover {
  background: var(--color-primary-hover);
}

.ctrl-btn:active {
  transform: scale(0.99);
}

.timer-hint {
  margin: 0;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}
</style>
