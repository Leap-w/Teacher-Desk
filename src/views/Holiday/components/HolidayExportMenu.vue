<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ChevronDown, FileSpreadsheet, ListChecks, Users } from 'lucide-vue-next'

import type { HolidayExportScope } from '@/utils/holidayExport'

/**
 * HolidayExportMenu — 假期名单导出菜单。
 *
 * 形状照 `FundExportMenu`（胶囊 + 下拉），**只有两项**，且两项的**人数写在按钮上**：
 * 「当前」与「全部」是两个不同的口径，差在筛选条件上，而筛选条件在抽屉里、不在眼前——
 * 不写人数就得让教师记得自己筛过什么；写上人数，两个数字不一样本身就说明了有一层筛选在生效。
 */
const props = defineProps<{
  /** 当前筛选结果的人数 */
  currentCount: number
  /** 该假期全部在读学生数 */
  allCount: number
  disabled?: boolean
  busy?: boolean
}>()

const emit = defineEmits<{ request: [scope: HolidayExportScope] }>()

const open = ref(false)
const rootEl = ref<HTMLElement>()

const items = computed<{ scope: HolidayExportScope; label: string; icon: typeof Users }[]>(() => [
  { scope: 'current', label: `导出当前名单（${props.currentCount} 人）`, icon: ListChecks },
  { scope: 'all', label: `导出全部名单（${props.allCount} 人）`, icon: Users },
])

function toggle() {
  if (!props.disabled && !props.busy) open.value = !open.value
}

function choose(scope: HolidayExportScope) {
  open.value = false
  emit('request', scope)
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
      :disabled="disabled || busy"
      :aria-expanded="open ? 'true' : 'false'"
      aria-haspopup="menu"
      @click="toggle"
    >
      <span v-if="busy" class="export-spinner" role="status" aria-label="导出中" />
      <template v-else>
        导出
        <ChevronDown :size="14" :stroke-width="2" aria-hidden="true" />
      </template>
    </button>

    <Transition name="export-pop">
      <div v-if="open" class="export-pop" role="menu" aria-label="导出假期名单">
        <button
          v-for="item in items"
          :key="item.scope"
          type="button"
          class="export-item"
          role="menuitem"
          @click="choose(item.scope)"
        >
          <component :is="item.icon" :size="15" :stroke-width="2" aria-hidden="true" />
          {{ item.label }}
        </button>
        <p class="export-note">
          <FileSpreadsheet :size="13" :stroke-width="2" aria-hidden="true" />
          九列：序号 / 姓名 / 性别 / 学号 / 家庭所在地 / 昌都市内亲属 / 亲戚关系 / 假期去向 / 备注
        </p>
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
  width: 260px;
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

.export-note {
  display: flex;
  gap: 6px;
  margin: var(--space-1) var(--space-3) var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px solid var(--color-border-light);
  font-size: var(--font-caption);
  line-height: 1.5;
  color: var(--color-text-faint);
  white-space: normal;
}

.export-note svg {
  flex-shrink: 0;
  margin-top: 2px;
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
