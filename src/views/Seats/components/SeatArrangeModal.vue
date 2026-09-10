<script setup lang="ts">
import { computed } from 'vue'

import { AppButton, AppModal } from '@/components/ui'
import { summarizeArrangeInput } from '@/utils/seatArrange'
import type { ClassroomConfig } from '@/types/classroom'
import type { SeatConstraint } from '@/types/constraint'
import type { Student } from '@/types'

/**
 * 自动排座弹窗（Phase 3D）：展示输入摘要（参与学生 / 硬约束 / 软规则 / 「高个」标签）与
 * 上一次求解的冲突结论，确认后由页面执行求解并落成新方案。
 * 弹窗自身不读写 store——求解与落库都在页面编排层，便于成功 / 失败统一提示。
 */

interface Props {
  modelValue: boolean
  /** 全部活跃学生（与求解器入参同源） */
  students: Student[]
  /** 全部座位约束（含停用；计数与求解同源，停用不计入） */
  constraints: SeatConstraint[]
  config: ClassroomConfig
  /** 上一次求解的硬约束冲突（成功时为空数组） */
  conflicts: string[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [open: boolean]
  generate: []
}>()

const summary = computed(() =>
  summarizeArrangeInput({
    students: props.students,
    constraints: props.constraints,
    config: props.config,
  }),
)

/** 无任何约束与规则：仍可排座，但结果不含任何偏好 */
const noInput = computed(() => summary.value.hardCount === 0 && summary.value.softCount === 0)

/** 超出教室可排座位数的学生数（按学号升序截断，其余不排座） */
const overflow = computed(() => Math.max(0, summary.value.studentCount - summary.value.capacity))

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <AppModal :model-value="modelValue" title="自动排座" width="460" @update:model-value="close">
    <p class="arrange-intro">
      按下方约束与规则自动生成一份<strong>新方案</strong>——当前方案原样保留，可对比或随时切回。
    </p>

    <ul class="arrange-summary">
      <li>
        <span>参与学生</span>
        <strong>{{ summary.studentCount }} 人</strong>
      </li>
      <li>
        <span>可排座位</span>
        <strong>{{ summary.capacity }} 个</strong>
      </li>
      <li>
        <span>硬约束（不能同桌 / 不能相邻）</span>
        <strong>{{ summary.hardCount }} 条</strong>
      </li>
      <li>
        <span>软规则（坐后排 / 坐前排 / 同区块）</span>
        <strong>{{ summary.softCount }} 条</strong>
      </li>
      <li>
        <span>「高个」标签（尽量靠后）</span>
        <strong>{{ summary.tallCount }} 人</strong>
      </li>
    </ul>

    <p v-if="noInput" class="arrange-note">
      当前没有约束与规则：生成结果只保证一人一座，不体现任何偏好。
    </p>
    <p v-else class="arrange-note">
      硬约束必须满足，无法满足则不生成方案；软规则尽量满足，未满足的部分会在右侧「约束检查」逐条提示。
    </p>

    <p v-if="overflow > 0" class="arrange-warn">
      {{ summary.studentCount }} 名学生超出可排座位数：按学号升序安排前
      {{ summary.capacity }} 人，其余 {{ overflow }} 人不排座。
    </p>

    <div v-if="conflicts.length > 0" class="arrange-conflicts" role="alert">
      <p class="arrange-conflicts-title">无法同时满足以下硬约束，未生成方案：</p>
      <p v-for="conflict in conflicts" :key="conflict" class="arrange-conflict">{{ conflict }}</p>
      <p class="arrange-conflict-tip">可停用或删除其中一条后重试。</p>
    </div>

    <p class="arrange-footnote">
      工具栏「＋ 新建方案」仍按学生档案的座位号生成；只有「自动排座」使用上述约束与规则。
    </p>

    <template #footer>
      <AppButton variant="ghost" @click="close">取消</AppButton>
      <AppButton :disabled="summary.studentCount === 0" @click="emit('generate')">
        生成方案
      </AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.arrange-intro {
  font-size: var(--text-sm);
  line-height: 1.7;
  color: var(--color-text-secondary);
}

.arrange-intro strong {
  color: var(--color-text);
}

.arrange-summary {
  display: grid;
  gap: var(--space-1);
  list-style: none;
  margin: var(--space-4) 0;
}

.arrange-summary li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  background: var(--color-fill-disabled);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.arrange-summary strong {
  flex-shrink: 0;
  color: var(--color-text);
}

.arrange-note {
  font-size: var(--text-xs);
  line-height: 1.7;
  color: var(--color-text-faint);
}

.arrange-warn {
  margin-top: var(--space-3);
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  background: var(--color-warning-soft);
  font-size: var(--text-xs);
  line-height: 1.7;
  color: var(--color-warning-strong);
}

.arrange-conflicts {
  margin-top: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--color-danger-soft);
}

.arrange-conflicts-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-danger-strong);
}

.arrange-conflict {
  margin-top: var(--space-2);
  font-size: var(--text-xs);
  line-height: 1.7;
  color: var(--color-danger-strong);
}

.arrange-conflict-tip {
  margin-top: var(--space-2);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.arrange-footnote {
  margin-top: var(--space-4);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
  font-size: var(--text-xs);
  line-height: 1.7;
  color: var(--color-text-faint);
}
</style>
