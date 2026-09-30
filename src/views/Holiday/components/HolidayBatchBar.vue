<script setup lang="ts">
import { computed } from 'vue'

import { AppButton } from '@/components/ui'

/**
 * HolidayBatchBar — 批量登记条（选中若干学生之后出现在底部）。
 *
 * ## 两个动作，正好对应二态
 *
 * v3.6.2 只剩「离校 / 留校」两个去向，所以这里就是两颗按钮：**设为离校 / 设为留校**。
 * v3.6.1 补的第三颗「清空登记」（退回未登记）随「未登记」一起删掉了——
 * 撤销一条离校记录的等价动作就是「设为留校」，不需要第三个按钮。
 *
 * ## 「全选」不在这里
 *
 * 全选是名单顶部那一行（`HolidaySelectAllBar`）的职责：它要带三态（未选 / 部分 / 全选）
 * 与「已选 X 人」，而这一条只在有选中时才浮出来，做不了「从零开始全选」这件事。
 * 这里只留「反选 / 取消」这两个**作用于已有选中**的快捷动作。
 *
 * ## 选中跨筛选保留
 *
 * 切换筛选条件**不清空选中**——教师常是「先按家庭所在地选一批，再筛另一批补上」。
 * 代价是选中集合可能与眼前的名单不一致，所以条上必须写出
 * 「其中 K 人不在当前筛选结果中」：这是「只改选中的学生」这条承诺在界面上的必要可见性，
 * 藏着它就会出现「明明屏幕上是 8 个人，却改了 11 个」。
 */
const props = defineProps<{
  selectedCount: number
  /** 选中但**不在当前筛选结果里**的人数（正常为 0） */
  outsideCount: number
  /** 正在落库：两个动作按钮整体禁用，防连点 */
  busy?: boolean
}>()

const emit = defineEmits<{
  clear: []
  invert: []
  apply: [target: 'home' | 'stay']
}>()

const DISABLED = computed(() => props.busy || props.selectedCount === 0)
</script>

<template>
  <div class="batch-bar" role="region" aria-label="批量登记">
    <div class="batch-inner">
      <div class="batch-head">
        <p class="batch-count">
          已选 <strong>{{ selectedCount }}</strong> 人
          <span v-if="outsideCount > 0" class="batch-outside">
            （其中 {{ outsideCount }} 人不在当前筛选结果中）
          </span>
        </p>
        <div class="batch-picker">
          <button
            type="button"
            class="batch-link"
            :disabled="selectedCount === 0"
            @click="emit('invert')"
          >
            反选
          </button>
          <button
            type="button"
            class="batch-link"
            :disabled="selectedCount === 0"
            @click="emit('clear')"
          >
            取消
          </button>
        </div>
      </div>

      <div class="batch-actions">
        <AppButton variant="primary" size="sm" :disabled="DISABLED" @click="emit('apply', 'home')">
          设为离校
        </AppButton>
        <AppButton variant="primary" size="sm" :disabled="DISABLED" @click="emit('apply', 'stay')">
          设为留校
        </AppButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.batch-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: var(--z-sticky);
  padding: var(--space-3) var(--space-4)
    calc(var(--space-3) + max(0px, env(safe-area-inset-bottom, 0px)));
  background: var(--glass-bg-card);
  backdrop-filter: blur(var(--nav-blur)) saturate(150%);
  -webkit-backdrop-filter: blur(var(--nav-blur)) saturate(150%);
  border-top: 1px solid var(--color-border-light);
  box-shadow: var(--shadow-lg);
}

.batch-inner {
  max-width: var(--page-max-width);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.batch-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.batch-count {
  font-size: var(--font-secondary);
  color: var(--color-text-secondary);
}

.batch-count strong {
  color: var(--color-text-primary);
  font-weight: var(--font-weight-semibold);
}

.batch-outside {
  color: var(--color-warning-strong);
}

.batch-picker {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.batch-link {
  padding: 0;
  border: none;
  background: none;
  font-size: var(--font-secondary);
  color: var(--color-primary-dark);
  cursor: pointer;
}

.batch-link:disabled {
  color: var(--color-text-faint);
  cursor: default;
}

.batch-link:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
  border-radius: var(--radius-xs);
}

.batch-actions {
  display: flex;
  gap: var(--space-2);
}

.batch-actions > * {
  flex: 1;
}
</style>
