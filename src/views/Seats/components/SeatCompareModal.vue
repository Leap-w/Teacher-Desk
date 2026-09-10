<script setup lang="ts">
import { computed, watch } from 'vue'

import { AppButton, AppModal, AppSelect } from '@/components/ui'
import { compareSeatPlans, seatChangeMoveLine, seatChangeZoneLine } from '@/utils/seat'
import type { SeatPlan } from '@/types/seat'
import type { Student } from '@/types'

/**
 * 方案对比弹窗：选方案 A（基准）与方案 B（对照）→ 自动比较并列出「共调整 N 人」明细。
 * 比较只读：不修改任何方案；「在座位图查看变化」把高亮模式交给页面编排层。
 */

interface Props {
  modelValue: boolean
  plans: SeatPlan[]
  /** 学生查询表（快照姓名用） */
  students: Map<string, Student>
  /** 重开弹窗时的预选（上次对比对） */
  presetA?: string
  presetB?: string
}

const props = withDefaults(defineProps<Props>(), {
  presetA: '',
  presetB: '',
})

const emit = defineEmits<{
  'update:modelValue': [open: boolean]
  /** 用户确认对比对 → 页面进入「变化高亮」只读查看 */
  apply: [pair: { planAId: string; planBId: string }]
}>()

const planAId = defineModel<string>('planAId', { default: '' })
const planBId = defineModel<string>('planBId', { default: '' })

// 以 preset 初始化一次（父级在开启对比时更新 preset）
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    if (props.presetA) planAId.value = props.presetA
    if (props.presetB) planBId.value = props.presetB
  },
)

const planOptions = computed(() =>
  props.plans.map((plan) => ({ value: plan.id, label: plan.name })),
)

const planA = computed(() => props.plans.find((plan) => plan.id === planAId.value))
const planB = computed(() => props.plans.find((plan) => plan.id === planBId.value))

/** 两方案均已选且不同 → 允许比较 */
const comparable = computed(() =>
  Boolean(planA.value && planB.value && planAId.value !== planBId.value),
)

const result = computed(() => {
  if (!comparable.value || !planA.value || !planB.value) return undefined
  return compareSeatPlans(planA.value, planB.value, props.students)
})

function apply() {
  if (!comparable.value) return
  emit('apply', { planAId: planAId.value, planBId: planBId.value })
}

function closeModal() {
  emit('update:modelValue', false)
}
</script>

<template>
  <AppModal
    :model-value="modelValue"
    title="方案对比"
    :width="440"
    @update:model-value="closeModal"
  >
    <div class="compare-selects">
      <label class="compare-field">
        <span>方案 A（基准）</span>
        <AppSelect v-model="planAId" :options="planOptions" placeholder="选择方案" />
      </label>
      <label class="compare-field">
        <span>方案 B（对照）</span>
        <AppSelect v-model="planBId" :options="planOptions" placeholder="选择方案" />
      </label>
    </div>

    <div v-if="!comparable" class="compare-hint">
      {{
        planAId && planBId && planAId === planBId
          ? '方案 A 与 B 相同，请换一个方案'
          : '选择两个不同方案后自动比较'
      }}
    </div>

    <template v-else>
      <p class="compare-total">共调整 {{ result?.total ?? 0 }} 人</p>
      <ul class="compare-list">
        <li v-for="entry in result?.entries ?? []" :key="entry.studentId" class="compare-entry">
          <span class="compare-name">{{ entry.name }}</span>
          <span class="compare-move">{{ seatChangeMoveLine(entry) }}</span>
          <span v-if="seatChangeZoneLine(entry)" class="compare-zone">{{
            seatChangeZoneLine(entry)
          }}</span>
        </li>
      </ul>
      <p v-if="result?.total === 0" class="compare-none">两份方案座位完全一致。</p>
    </template>

    <template #footer>
      <AppButton variant="ghost" @click="closeModal">取消</AppButton>
      <AppButton :disabled="!comparable" @click="apply">在座位图查看变化</AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.compare-selects {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}

.compare-field {
  display: grid;
  gap: var(--space-2);
}

.compare-field span {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.compare-hint {
  margin-top: var(--space-4);
  font-size: var(--text-sm);
  color: var(--color-text-faint);
}

.compare-total {
  margin-top: var(--space-4);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
}

.compare-list {
  display: grid;
  gap: var(--space-2);
  list-style: none;
  margin-top: var(--space-2);
  max-height: 40vh;
  overflow-y: auto;
}

.compare-entry {
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: var(--space-3);
  row-gap: 2px;
  align-items: baseline;
  border-radius: var(--radius-sm);
  background: var(--color-fill-disabled);
  padding: 7px 12px;
}

.compare-name {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
}

.compare-move {
  grid-column: 2;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.compare-zone {
  grid-column: 2;
  font-size: var(--text-xs);
  color: var(--color-warning-strong);
}

.compare-none {
  margin-top: var(--space-3);
  font-size: var(--text-sm);
  color: var(--color-text-faint);
}
</style>
