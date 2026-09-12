<script setup lang="ts">
import { AppModal } from '@/components/ui'
import type { SeatExportKind } from '@/utils/seatExport'

/**
 * 导出座位图面板：四种导出（PNG / PDF × 老师 / 学生视角）。
 * 只发「请求」，画布生成 / 文件下载由页面编排层（index.vue）执行。
 */

interface Props {
  modelValue: boolean
  /** 当前导出方案名（文案提示用） */
  planName: string
  /** 进行中的导出；非空时全部按钮禁用，进行中的选项显示「导出中…」 */
  busy: SeatExportKind | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [open: boolean]
  /** 用户点选某一种导出 */
  request: [kind: SeatExportKind]
}>()

interface ExportOption {
  kind: SeatExportKind
  title: string
  desc: string
}

const OPTIONS: ExportOption[] = [
  {
    kind: 'png-teacher',
    title: 'PNG 图片 · 老师视角',
    // V1.1.2 Phase 1：两个视角是 180° 旋转关系，老师视角讲台在上、学生视角讲台在下
    desc: '讲台在上方、第 1 排最靠前 · 适合打印张贴',
  },
  {
    kind: 'png-student',
    title: 'PNG 图片 · 学生视角',
    desc: '整间教室旋转 180°（前后 + 左右翻转）· 讲台在下方',
  },
  {
    kind: 'pdf-teacher',
    title: 'PDF · 老师视角',
    desc: 'A4 单页 · 竖版，可直接打印',
  },
  {
    kind: 'pdf-dual',
    title: 'PDF · 双视角',
    desc: 'A4 单页 · 上半学生视角、下半老师视角',
  },
]

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <AppModal :model-value="modelValue" title="导出座位图" :width="420" @update:model-value="close">
    <p class="export-note">导出「{{ props.planName }}」座位图，自动附导出日期与方案名。</p>

    <div class="export-grid">
      <button
        v-for="option in OPTIONS"
        :key="option.kind"
        type="button"
        class="export-option"
        :disabled="busy !== null"
        @click="emit('request', option.kind)"
      >
        <span class="export-option-title">
          {{ option.title }}
          <em v-if="busy === option.kind" class="export-running">导出中…</em>
        </span>
        <span class="export-option-desc">{{ option.desc }}</span>
      </button>
    </div>

    <p class="export-tip">打印用 A4 尺寸；教室示意图固定 3-3-3 布局，与屏幕一致。</p>

    <template #footer>
      <AppButton variant="ghost" :disabled="busy !== null" @click="close">关闭</AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.export-note {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.export-grid {
  display: grid;
  gap: var(--space-2);
  margin-top: var(--space-4);
}

.export-option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  padding: 10px 14px;
  font: inherit;
  color: var(--color-text);
  cursor: pointer;
  text-align: left;
  transition:
    border-color var(--transition-fast),
    background var(--transition-fast),
    box-shadow var(--transition-fast);
}

.export-option:hover:not(:disabled) {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
}

.export-option:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.export-option:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.export-option-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-sm);
  font-weight: 600;
}

.export-running {
  font-style: normal;
  font-size: var(--text-xs);
  color: var(--color-primary-strong);
  background: var(--color-primary-soft);
  border-radius: 999px;
  padding: 1px 8px;
}

.export-option-desc {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.export-tip {
  margin-top: var(--space-3);
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
</style>
