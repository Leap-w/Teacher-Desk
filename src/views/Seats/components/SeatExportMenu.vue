<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ChevronDown, FileSpreadsheet, FileText } from 'lucide-vue-next'

import type { SeatExportKind } from '@/utils/seatExport'

/**
 * SeatExportMenu — 导出菜单（V2.0.4-alpha · Phase UI-4B）：
 * 工具栏胶囊按钮 → 下拉列出导出项；busy 时禁用并显示进度。
 * 导出执行由父级 runExport 完成（Loading + Toast 沿用编排层）。
 *
 * v3.4.0：PDF 两项都改成**横向 A4**（双视角 = 一个视角一页，共 2 页），
 * 并新增 Excel 一项（照需求方模板出的 .xlsx，两个视角各一个工作表）。
 *
 * **v3.5.1：菜单只剩这两项**。撤掉的三项是 PNG 老师视角 / PNG 学生视角 /
 * PDF 老师视角——同一个「双视角」文件里两个视角都在，单视角入口是重复的。
 * 文案里的「（2 页横向 A4）」也一并去掉：那两个数字是给实现看的，不是给老师看的。
 */
const ITEMS: { kind: SeatExportKind; label: string; icon: typeof FileText }[] = [
  { kind: 'pdf-dual', label: 'PDF · 双视角', icon: FileText },
  { kind: 'xlsx-dual', label: 'Excel · 两个视角', icon: FileSpreadsheet },
]

const props = defineProps<{
  disabled?: boolean
  /** 正在导出的 kind（null = 空闲）；busy 时菜单整体禁用 */
  busy?: SeatExportKind | null
}>()

const emit = defineEmits<{
  request: [kind: SeatExportKind]
}>()

const open = ref(false)
const rootEl = ref<HTMLElement>()

const isBusy = computed(() => props.busy !== null)

function toggle() {
  if (!props.disabled && !isBusy.value) open.value = !open.value
}

function choose(kind: SeatExportKind) {
  open.value = false
  emit('request', kind)
}

function onDocumentClick(event: MouseEvent) {
  if (open.value && rootEl.value && !rootEl.value.contains(event.target as Node)) {
    open.value = false
  }
}

onMounted(() => document.addEventListener('click', onDocumentClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick))
</script>

<template>
  <div ref="rootEl" class="export-menu">
    <button
      type="button"
      class="export-trigger"
      :disabled="disabled || isBusy"
      :aria-expanded="open ? 'true' : 'false'"
      aria-haspopup="menu"
      @click="toggle"
    >
      <span v-if="isBusy" class="export-spinner" role="status" aria-label="导出中" />
      <template v-else>
        导出座位图
        <ChevronDown :size="14" :stroke-width="2" aria-hidden="true" />
      </template>
    </button>

    <Transition name="export-pop">
      <div v-if="open" class="export-pop" role="menu" aria-label="导出座位图">
        <button
          v-for="item in ITEMS"
          :key="item.kind"
          type="button"
          class="export-item"
          role="menuitem"
          @click="choose(item.kind)"
        >
          <component :is="item.icon" :size="15" :stroke-width="2" aria-hidden="true" />
          {{ item.label }}
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.export-menu {
  position: relative;
}

.export-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 var(--space-4);
  border: none;
  border-radius: var(--radius-button);
  background: var(--color-primary);
  color: var(--color-text-inverse);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  white-space: nowrap;
  transition:
    background var(--transition-fast),
    transform var(--transition-fast);
}

.export-trigger:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.export-trigger:active:not(:disabled) {
  transform: scale(0.97);
}

.export-trigger:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.export-trigger:disabled {
  cursor: default;
  opacity: 0.7;
}

.export-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: var(--color-text-inverse);
  border-radius: 50%;
  animation: export-spin 0.7s linear infinite;
}

@keyframes export-spin {
  to {
    transform: rotate(360deg);
  }
}

.export-pop {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: var(--z-dropdown);
  min-width: 180px;
  padding: 5px;
  background: var(--glass-bg-card);
  backdrop-filter: blur(var(--nav-blur)) saturate(150%);
  -webkit-backdrop-filter: blur(var(--nav-blur)) saturate(150%);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
}

.export-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-primary);
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--transition-fast);
}

.export-item:hover {
  background: var(--bg-hover);
}

.export-item:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.export-pop-enter-active,
.export-pop-leave-active {
  transition:
    opacity var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}

.export-pop-enter-from,
.export-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
