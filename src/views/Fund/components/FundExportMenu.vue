<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ChevronDown, FileSpreadsheet, FileText } from 'lucide-vue-next'

import type { FundExportKind } from '@/utils/fundExport'

/**
 * FundExportMenu — 班费导出菜单（v3.6.0）。
 *
 * 形状照 `SeatExportMenu`：胶囊按钮 + 下拉两项，导出执行在页面（`runExport`），
 * busy 时整体禁用并把文案换成转圈。
 *
 * 两项而不是三项：「收支账目 PDF」与「收支与缴费 Excel」各自都已经把该带的东西带全了
 * （PDF 有批次时自动多一页名单，Excel 有批次时自动多一个工作表）。
 * 再拆出「只导名单」这种单项入口，就会出现「导出的文件里少了点什么」的疑问。
 */
const ITEMS: { kind: FundExportKind; label: string; icon: typeof FileText }[] = [
  { kind: 'pdf-ledger', label: 'PDF · 收支账目', icon: FileText },
  { kind: 'xlsx-ledger', label: 'Excel · 收支与缴费', icon: FileSpreadsheet },
]

const props = defineProps<{
  disabled?: boolean
  /** 正在导出的 kind（null = 空闲）；busy 时菜单整体禁用 */
  busy?: FundExportKind | null
}>()

const emit = defineEmits<{ request: [kind: FundExportKind] }>()

const open = ref(false)
const rootEl = ref<HTMLElement>()

const isBusy = computed(() => props.busy !== null)

function toggle() {
  if (!props.disabled && !isBusy.value) open.value = !open.value
}

function choose(kind: FundExportKind) {
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
        导出
        <ChevronDown :size="14" :stroke-width="2" aria-hidden="true" />
      </template>
    </button>

    <Transition name="export-pop">
      <div v-if="open" class="export-pop" role="menu" aria-label="导出班费账目">
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
  min-width: 190px;
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
