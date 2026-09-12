<script setup lang="ts">
import { computed } from 'vue'

import { X } from 'lucide-vue-next'

import { AppButton, AppModal } from '@/components/ui'
import { useConstraintStore } from '@/stores/constraint'
import { formatStudentShortName } from '@/utils/student'
import { CONSTRAINT_TYPE_LABELS } from '@/utils/constraint'
import type { Student } from '@/types'
import type { SeatConstraint, SeatConstraintType } from '@/types/constraint'

/**
 * 管理座位约束弹窗：全部约束清单（启用开关 / 删除）。只管理条目本身，
 * 改动立即反映到右侧「约束检查」面板与导出不受影响。
 */

interface Props {
  modelValue: boolean
  /** 全部活跃学生（约束名单解析用） */
  students: Student[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [open: boolean]
}>()

const constraintStore = useConstraintStore()

const nameOf = computed(() => {
  const map = new Map(props.students.map((student) => [student.id, student]))
  return (id: string): string => {
    const student = map.get(id)
    return student ? formatStudentShortName(student) : '已删除学生'
  }
})

/** 双人型约束显示「A 与 B」，单人型（坐后排 / 坐前排）只显示主体 */
function pairText(item: SeatConstraint): string {
  if (item.studentB) return `${nameOf.value(item.studentA)} 与 ${nameOf.value(item.studentB)}`
  return nameOf.value(item.studentA)
}

function typeLabel(type: SeatConstraintType): string {
  return CONSTRAINT_TYPE_LABELS[type]
}

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <AppModal
    :model-value="modelValue"
    title="管理座位约束"
    width="480"
    :close-on-overlay="false"
    @update:model-value="close"
  >
    <p v-if="constraintStore.items.length === 0" class="manage-empty">
      暂无约束。添加「不能同桌 / 不能相邻」（自动排座的硬约束）或「坐后排 / 坐前排 /
      同区块」（软规则）后，右侧「约束检查」会实时提示座位冲突与未满足的规则。
    </p>

    <ul v-else class="manage-list">
      <li v-for="item in constraintStore.items" :key="item.id" class="manage-item">
        <div class="manage-main">
          <div class="manage-line">
            <span class="manage-type">{{ typeLabel(item.type) }}</span>
            <span class="manage-names">{{ pairText(item) }}</span>
          </div>
          <p v-if="item.reason" class="manage-reason">{{ item.reason }}</p>
          <p v-if="!item.enabled" class="manage-disabled-tip">已停用，不参与检查与自动排座</p>
        </div>

        <div class="manage-actions">
          <button
            type="button"
            class="manage-toggle"
            role="switch"
            :aria-checked="item.enabled"
            :aria-label="`${item.enabled ? '停用' : '启用'}约束`"
            :title="item.enabled ? '停用（保留，不参与检查）' : '启用（恢复检查）'"
            @click="constraintStore.setEnabled(item.id, !item.enabled)"
          >
            <span class="manage-toggle-knob" />
          </button>
          <button
            type="button"
            class="manage-remove"
            aria-label="删除约束"
            title="删除约束"
            @click="constraintStore.remove(item.id)"
          >
            <X :size="14" :stroke-width="2" aria-hidden="true" />
          </button>
        </div>
      </li>
    </ul>

    <template #footer>
      <AppButton variant="ghost" @click="close">关闭</AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.manage-empty {
  font-size: var(--text-sm);
  line-height: 1.7;
  color: var(--color-text-secondary);
  background: var(--color-fill-disabled);
  border-radius: var(--radius-md);
  padding: var(--space-4);
}

.manage-list {
  display: grid;
  gap: var(--space-2);
  list-style: none;
  max-height: 52vh;
  overflow-y: auto;
  margin: 0 calc(var(--space-2) * -1);
  padding: 0 var(--space-2);
}

.manage-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-3);
}

.manage-item.is-off {
  opacity: 0.6;
}

.manage-main {
  min-width: 0;
}

.manage-line {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

.manage-type {
  flex-shrink: 0;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-primary-strong);
  background: var(--color-primary-soft);
  border-radius: 999px;
  padding: 2px 8px;
}

.manage-names {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.manage-reason {
  margin-top: 4px;
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}

.manage-disabled-tip {
  margin-top: 4px;
  font-size: var(--text-xs);
  color: var(--color-warning-strong);
}

.manage-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}

/* 开关 */
.manage-toggle {
  position: relative;
  width: 34px;
  height: 20px;
  border: none;
  border-radius: 999px;
  background: var(--color-border-strong);
  cursor: pointer;
  padding: 0;
  transition: background var(--transition-fast);
}

.manage-toggle[aria-checked='true'] {
  background: var(--color-primary);
}

.manage-toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: transform var(--transition-fast);
}

.manage-toggle[aria-checked='true'] .manage-toggle-knob {
  transform: translateX(14px);
}

.manage-toggle:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.manage-remove {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--color-text-faint);
  font-size: 11px;
  cursor: pointer;
  transition:
    background var(--transition-fast),
    color var(--transition-fast);
}

.manage-remove:hover {
  background: var(--color-danger-soft);
  color: var(--color-danger-strong);
}
</style>
