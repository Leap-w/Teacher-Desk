<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { AppButton, AppField, AppInput } from '@/components/ui'
import { describeExchangeWeeks } from '@/utils/exchange'

/**
 * 教学周次选择器（v3.7.5）。
 *
 * 换课记录「在哪些周生效」的唯一入口，支持规格要求的全部选法：
 * 单个 / 多个 / 连续 / 不连续（点周次格），一键全选 / 一键清空（按钮），
 * 快速范围（起止两周次一次落定），并且**始终显示已选**（下方摘要 + 每格高亮）。
 *
 * 周次表**来自学期设置**（`max-week`），不写死 20 周：学期总周数改了，这里跟着变。
 * 组件本身不碰 store——选中值由父组件（换课抽屉）持有并提交。
 */
interface Props {
  modelValue: number[]
  /** 学期总周数（= 可选周次的上限，来自学期设置） */
  maxWeek: number
  /** 今天的教学周次（给「回到本周」用；不在学期范围内时不传） */
  currentWeek?: number
}

const props = withDefaults(defineProps<Props>(), {
  currentWeek: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [value: number[]]
}>()

/** 可选周次（1 起）：**跟着学期设置走**，学期总周数改小时这里同步变少 */
const options = computed(() =>
  Array.from({ length: Math.max(0, props.maxWeek) }, (_, index) => index + 1),
)

const selected = computed(() => new Set(props.modelValue))
const weeks = computed(() => [...props.modelValue].sort((a, b) => a - b))

/** 已选摘要（「已选 3 周：第 3–5 周」）——规格要求「明确显示已选」 */
const summary = computed(() =>
  weeks.value.length === 0
    ? '还没有选择周次'
    : `已选 ${weeks.value.length} 周：${describeExchangeWeeks(weeks.value, props.maxWeek)}`,
)

function toggle(week: number): void {
  const next = new Set(props.modelValue)
  if (next.has(week)) next.delete(week)
  else next.add(week)
  emit(
    'update:modelValue',
    [...next].sort((a, b) => a - b),
  )
}

function selectAll(): void {
  emit('update:modelValue', [...options.value])
}

function clearAll(): void {
  emit('update:modelValue', [])
}

/* ---------- 快速范围：起止两周各选一个，一次落定一段连续周次 ---------- */

const rangeFrom = ref('1')
const rangeTo = ref('1')

// 打开时（或学期范围变化时）把范围输入收进合法区间，避免留着「第 30 周」这种旧值
watch(
  () => props.maxWeek,
  (max) => {
    const clamp = (value: string) =>
      String(Math.min(Math.max(1, Number(value) || 1), Math.max(1, max)))
    rangeFrom.value = clamp(rangeFrom.value)
    rangeTo.value = clamp(rangeTo.value)
  },
  { immediate: true },
)

function applyRange(): void {
  const max = Math.max(1, props.maxWeek)
  const rawFrom = Math.min(Math.max(1, Number(rangeFrom.value) || 1), max)
  const rawTo = Math.min(Math.max(1, Number(rangeTo.value) || 1), max)
  const from = Math.min(rawFrom, rawTo)
  const to = Math.max(rawFrom, rawTo)
  rangeFrom.value = String(from)
  rangeTo.value = String(to)
  const next = new Set(props.modelValue)
  for (let week = from; week <= to; week += 1) next.add(week)
  emit(
    'update:modelValue',
    [...next].sort((a, b) => a - b),
  )
}

function resetToCurrent(): void {
  if (props.currentWeek === undefined) return
  emit('update:modelValue', [props.currentWeek])
}
</script>

<template>
  <div class="week-picker">
    <div class="picker-head">
      <span class="picker-summary">{{ summary }}</span>
      <div class="picker-actions">
        <button v-if="currentWeek !== undefined" type="button" class="link" @click="resetToCurrent">
          回到本周
        </button>
        <button type="button" class="link" @click="selectAll">全选</button>
        <button type="button" class="link" @click="clearAll">清空</button>
      </div>
    </div>

    <div class="week-grid" role="group" aria-label="选择生效的教学周次">
      <button
        v-for="week in options"
        :key="week"
        type="button"
        class="week-chip"
        :class="{ 'is-active': selected.has(week), 'is-current': week === currentWeek }"
        :aria-pressed="selected.has(week)"
        @click="toggle(week)"
      >
        {{ week }}
      </button>
    </div>

    <div class="range-row">
      <AppField label="快速范围" hint="起止都含在内；与已选周次合并">
        <div class="range-inputs">
          <AppInput
            v-model="rangeFrom"
            type="number"
            size="sm"
            aria-label="起始周次"
            :min="1"
            :max="maxWeek"
          />
          <span class="range-sep" aria-hidden="true">—</span>
          <AppInput
            v-model="rangeTo"
            type="number"
            size="sm"
            aria-label="结束周次"
            :min="1"
            :max="maxWeek"
          />
          <AppButton variant="secondary" size="sm" type="button" @click="applyRange">
            应用范围
          </AppButton>
        </div>
      </AppField>
    </div>
  </div>
</template>

<style scoped>
.week-picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.picker-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.picker-summary {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.picker-actions {
  display: flex;
  gap: var(--space-3);
}

.link {
  border: none;
  background: none;
  padding: 0;
  color: var(--color-primary-strong);
  font-size: var(--text-sm);
  font-weight: 600;
  cursor: pointer;
}

.link:hover {
  text-decoration: underline;
}

.link:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
  border-radius: var(--radius-sm);
}

.week-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
  gap: var(--space-1);
  max-height: 168px;
  overflow-y: auto;
  padding: var(--space-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.week-chip {
  min-height: 34px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast),
    color var(--transition-fast);
}

.week-chip:hover {
  border-color: var(--color-border-emphasis);
  color: var(--color-text);
}

.week-chip.is-current {
  border-color: var(--color-primary);
}

.week-chip.is-active {
  background: var(--color-primary);
  border-color: transparent;
  color: var(--color-text-inverse);
  font-weight: 600;
}

.week-chip:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.range-inputs {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.range-inputs :deep(.app-input) {
  max-width: 88px;
}

.range-sep {
  color: var(--color-text-faint);
}
</style>
