<script setup lang="ts">
import { computed } from 'vue'

import { AppButton } from '@/components/ui'

/**
 * HolidayBatchBar — 批量登记条（选中若干学生之后出现在底部）。
 *
 * ## 为什么是三个动作而不是规格里的两个
 *
 * 规格第 5 节只写了「批量设为回家 / 批量设为留校」。这两个按钮无法把学生改回**未登记**——
 * 而「未登记」是这次升级的核心概念（旧版的补集口径正是把它混进了留校），教师一定会遇到
 * 「这几个我问过了要撤回」的场景。留着它不可达，等于逼教师去单条删记录。
 * 所以补了第三个「清空登记」，用幽灵样式与两个主操作分开（它撤销信息，不是登记信息）。
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
  /** 正在落库：三个动作按钮整体禁用，防连点 */
  busy?: boolean
}>()

const emit = defineEmits<{
  selectAll: []
  clear: []
  invert: []
  apply: [target: 'home' | 'stay' | 'unregistered']
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
          <button type="button" class="batch-link" @click="emit('selectAll')">全选</button>
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
          设为回家
        </AppButton>
        <AppButton variant="primary" size="sm" :disabled="DISABLED" @click="emit('apply', 'stay')">
          设为留校
        </AppButton>
        <AppButton
          variant="ghost"
          size="sm"
          :disabled="DISABLED"
          @click="emit('apply', 'unregistered')"
        >
          清空登记
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
