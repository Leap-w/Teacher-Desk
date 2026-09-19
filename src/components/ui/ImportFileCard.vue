<script setup lang="ts">
import { FileSpreadsheet } from 'lucide-vue-next'

/**
 * ImportFileCard — Excel 导入上传卡（V2.0.4-alpha · Phase UI-4B 起，
 * v3.5.0 从 `views/Seats/components/SeatImportCard.vue` 上移到 UI Kit，
 * 因为五个导入弹窗都要用它，放在座位目录里其余四个就只能各写一份）。
 *
 * 只做「看起来是个能拖能点的上传区」，**不碰 File**：
 * click → emit pick（父级触发 file input）；drop → emit file（父级读取该 File，
 * 走与 input 完全相同的解析路径）。
 */
withDefaults(
  defineProps<{
    /** 已选文件名（有值时显示文件状态而不是提示） */
    filename?: string
    /** 工作表说明（如「工作表Sheet1」） */
    sheetNote?: string
    busy?: boolean
    /** 未选文件时的主文案 */
    title?: string
    /** 未选文件时的次文案 */
    hint?: string
  }>(),
  {
    filename: '',
    sheetNote: '',
    busy: false,
    title: '点击选择或拖入 Excel 文件',
    hint: '支持 .xlsx / .xls · 数据仅在本机解析后预览确认',
  },
)

const emit = defineEmits<{
  pick: []
  file: [file: File]
}>()

/**
 * dragenter / dragleave 会在子元素之间反复触发，用计数而不是布尔量，
 * 否则鼠标从卡片文字移到图标上就会闪一下「拖拽中」状态。
 */
let dragDepth = 0

function onDrop(event: DragEvent) {
  dragDepth = 0
  const file = event.dataTransfer?.files?.[0]
  if (file) emit('file', file)
}
</script>

<template>
  <button
    type="button"
    class="import-card"
    :class="{ 'is-dragover': dragDepth > 0, 'has-file': Boolean(filename) }"
    :disabled="busy"
    @click="emit('pick')"
    @dragenter.prevent="dragDepth += 1"
    @dragover.prevent
    @dragleave.prevent="dragDepth = Math.max(0, dragDepth - 1)"
    @drop.prevent="onDrop"
  >
    <span class="import-icon" aria-hidden="true">
      <FileSpreadsheet :size="28" :stroke-width="1.8" />
    </span>
    <span class="import-main">
      <template v-if="filename">
        <span class="import-filename">{{ filename }}</span>
        <span v-if="sheetNote" class="import-hint">{{ sheetNote }}</span>
        <span v-else-if="busy" class="import-hint">读取中…</span>
      </template>
      <template v-else>
        <span class="import-title">{{ busy ? '读取中…' : title }}</span>
        <span class="import-hint">{{ hint }}</span>
      </template>
    </span>
  </button>
</template>

<style scoped>
.import-card {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1.5px dashed var(--color-border-strong);
  border-radius: var(--radius-lg);
  background: var(--color-bg-subtle);
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--duration-base) var(--ease-out),
    background var(--duration-base) var(--ease-out);
}

.import-card:hover:not(:disabled),
.import-card.is-dragover {
  border-color: var(--color-primary);
  background: var(--color-primary-bg);
}

.import-card:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.import-card:disabled {
  cursor: default;
  opacity: 0.7;
}

.import-card.has-file {
  border-style: solid;
}

.import-icon {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  background: var(--color-primary-soft);
  color: var(--color-primary-dark);
}

.import-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.import-title {
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.import-filename {
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  overflow-wrap: anywhere;
}

.import-hint {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}
</style>
