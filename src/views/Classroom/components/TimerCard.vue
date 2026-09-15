<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Pause, Play, RotateCcw, Timer } from 'lucide-vue-next'

import { useToast } from '@/composables/useToast'
import {
  TIMER_MAX_MINUTES,
  TIMER_MIN_MINUTES,
  TIMER_PRESETS_MIN,
  canTriggerControl,
  elapsedSince,
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
/** 上一次按控制按钮的时刻（RC-03：按钮防抖，双击不会读成「开始 → 暂停」） */
let lastControlAt: number | null = null

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

/** 按钮防抖（RC-03）：窗口内的重复点击直接忽略 */
function allowControl(): boolean {
  const now = Date.now()
  if (!canTriggerControl(lastControlAt, now)) return false
  lastControlAt = now
  return true
}

/**
 * 用「现在 − 起跑时刻」重算已计时（RC-04）。
 * 到点则收尾并提示；返回是否已到点。切后台回来调一次它，时间立刻对齐。
 */
function syncElapsed(): boolean {
  elapsed.value = elapsedSince(startedAt, Date.now(), totalMs.value)
  if (elapsed.value < totalMs.value) return false
  stopTicking()
  if (phase.value === 'running') {
    phase.value = 'finished'
    // 结束提示：页面内轻提示（拍板：不用系统通知）
    toast.success(`时间到（${minutes.value} 分钟）`)
  }
  return true
}

function startTicking(): void {
  stopTicking()
  startedAt = Date.now() - elapsed.value
  timer = setInterval(syncElapsed, 250) // 250ms 刷新一次：秒级数字不会跳秒，也不浪费
}

function onStart(): void {
  if (!allowControl()) return
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
  if (!allowControl()) return
  stopTicking()
  phase.value = nextPhase(phase.value, 'reset')
  elapsed.value = 0
}

/**
 * 回到前台立刻对一次账（RC-04）：后台标签页的定时器会被浏览器压慢，
 * 回来的第一件事就是按时间戳重算，而不是等下一个 tick。
 */
function onVisibilityChange(): void {
  if (document.visibilityState !== 'visible') return
  if (phase.value !== 'running') return
  syncElapsed()
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

onMounted(() => {
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
})

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
  stopTicking()
})
</script>

<template>
  <ToolCard title="课堂计时器" description="1 / 3 / 5 / 10 分钟或自定义，秒级刷新" :icon="Timer">
    <!--
      预设两行（v3.3.0）：`1 3 5` / `10 自定义`。
      以前是 flex-wrap 自动折行，四个预设 + 自定义挤成「3 + 2」还是「4 + 1」要看卡片宽度，
      窄一点就变成两行、宽一点又回到一行——同一台电脑上改个窗口大小，这一排就换个排法。
      固定三列两行，谁看都是同一张卡。
    -->
    <div class="preset-grid" role="group" aria-label="预设时间">
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
        :aria-expanded="customOpen ? 'true' : 'false'"
        @click="customOpen = !customOpen"
      >
        自定义
      </button>
    </div>

    <!--
      自定义输入行**常驻占位**（关闭时不可见但保留高度）。
      按需插入的话，一展开就把下面的大数字整体往下推——投影上那行数字跳一下，
      全班都会跟着看那一下跳动，而教师只是刚点开输入框。
    -->
    <div
      class="custom-row"
      :class="{ 'is-muted': !customOpen }"
      :aria-hidden="customOpen ? 'false' : 'true'"
    >
      <input
        v-model="customValue"
        class="custom-input"
        type="number"
        inputmode="numeric"
        :min="TIMER_MIN_MINUTES"
        :max="TIMER_MAX_MINUTES"
        placeholder="分钟数"
        aria-label="自定义分钟数"
        :tabindex="customOpen ? 0 : -1"
        @keydown.enter="applyCustom"
      />
      <button
        type="button"
        class="custom-apply"
        :tabindex="customOpen ? 0 : -1"
        @click="applyCustom"
      >
        确定
      </button>
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

    <template #footer>
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
    </template>

    <p class="timer-hint">
      <template v-if="finished">时间到（{{ minutes }} 分钟），已提示</template>
      <template v-else-if="phase === 'running'">计时中…</template>
      <template v-else-if="phase === 'paused'">已暂停</template>
      <template v-else>当前设定 {{ minutes }} 分钟</template>
    </p>
  </ToolCard>
</template>

<style scoped>
/* 固定三列两行：`1 3 5` / `10 自定义`（自定义横跨两格） */
.preset-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-2);
}

/* 「自定义」横跨第二行剩下的两格：与「10 分钟」拼成 `10 自定义` 那一行 */
.preset-btn.is-custom {
  grid-column: span 2;
}

.preset-btn {
  min-height: 44px;
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

/* 占位行：关闭时仍占高度（见模板注释），只是不可见、不可聚焦 */
.custom-row {
  display: flex;
  gap: var(--space-2);
}

.custom-row.is-muted {
  visibility: hidden;
  pointer-events: none;
}

.custom-input {
  flex: 1;
  min-width: 0;
  min-height: 44px;
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
  min-height: 44px;
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
