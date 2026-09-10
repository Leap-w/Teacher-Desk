<script setup lang="ts">
import { AppButton, AppCard } from '@/components/ui'
import { CONSTRAINT_OK_LINES } from '@/utils/constraint'
import type { ConstraintGroup, ConstraintIssue } from '@/utils/constraint'

/**
 * 约束检查面板（右侧栏）：实时显示当前方案的检查结论。
 * 只检查、不自动调整；任何一行都可点击定位到涉及座位（闪烁 + 滚动）。
 */

interface Props {
  issues: ConstraintIssue[]
  /** 手工约束总数（含停用；展示用） */
  totalConstraints: number
}

defineProps<Props>()

const emit = defineEmits<{
  locate: [issue: ConstraintIssue]
  add: []
  manage: []
}>()

/** 分组渲染顺序与各自的无问题文案 */
const GROUPS: Array<{ key: ConstraintGroup; ok: string }> = [
  { key: 'relation', ok: CONSTRAINT_OK_LINES.relation },
  { key: 'rules', ok: CONSTRAINT_OK_LINES.rules },
  { key: 'tall', ok: CONSTRAINT_OK_LINES.tall },
  { key: 'cadre', ok: CONSTRAINT_OK_LINES.cadre },
]

function issuesOf(group: ConstraintGroup, issues: ConstraintIssue[]): ConstraintIssue[] {
  return issues.filter((issue) => issue.group === group)
}
</script>

<template>
  <AppCard
    class="constraint-panel"
    title="约束检查"
    subtitle="实时检查 · 只读不自动调整"
    padding="compact"
  >
    <ul class="constraint-list">
      <template v-for="group in GROUPS" :key="group.key">
        <li v-if="issuesOf(group.key, issues).length === 0" class="constraint-ok">
          <span class="constraint-mark is-ok" aria-hidden="true">✓</span>
          {{ group.ok }}
        </li>
        <li v-else>
          <button
            v-for="issue in issuesOf(group.key, issues)"
            :key="issue.key"
            type="button"
            class="constraint-row"
            :class="`is-${issue.severity}`"
            :title="`定位：${issue.studentIds.length} 名学生`"
            @click="emit('locate', issue)"
          >
            <span class="constraint-mark" aria-hidden="true">⚠</span>
            <span class="constraint-text">{{ issue.message }}</span>
          </button>
        </li>
      </template>
    </ul>

    <p v-if="totalConstraints === 0" class="constraint-tip">
      还没有座位约束。长按已就座座位 →「＋ 座位约束」添加「不能同桌 /
      不能相邻」（自动排座的硬约束）或「坐后排 / 坐前排 / 同区块」（软规则）。
    </p>

    <footer class="constraint-actions">
      <AppButton size="sm" variant="ghost" @click="emit('add')">＋ 添加约束</AppButton>
      <AppButton size="sm" variant="secondary" @click="emit('manage')">
        管理约束（{{ totalConstraints }}）
      </AppButton>
    </footer>
  </AppCard>
</template>

<style scoped>
.constraint-panel {
  width: 100%;
}

.constraint-list {
  display: grid;
  gap: var(--space-1);
  list-style: none;
}

.constraint-ok {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background: var(--color-success-soft);
  font-size: var(--text-xs);
  line-height: 1.5;
  color: var(--color-success-strong);
}

.constraint-mark {
  flex-shrink: 0;
  font-weight: 700;
  line-height: 1.5;
}

.constraint-ok .constraint-mark.is-ok {
  color: var(--color-success);
}

.constraint-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  width: 100%;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  padding: 6px 8px;
  font-size: var(--text-xs);
  line-height: 1.5;
  color: var(--color-text-secondary);
  cursor: pointer;
  text-align: left;
  transition: background var(--transition-fast);
}

.constraint-row:hover {
  background: var(--color-fill-disabled);
}

.constraint-row.is-conflict .constraint-mark {
  color: var(--color-danger);
}

.constraint-row.is-conflict .constraint-text {
  color: var(--color-danger-strong);
}

.constraint-row.is-warn .constraint-mark {
  color: var(--color-warning-strong);
}

.constraint-row.is-warn .constraint-text {
  color: var(--color-warning-strong);
}

.constraint-tip {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
  font-size: var(--text-xs);
  line-height: 1.7;
  color: var(--color-text-faint);
}

.constraint-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
</style>
