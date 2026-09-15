<script lang="ts">
/** 方案选项（从 SeatPlan 收敛，组件不直接依赖 Store） */
export interface SeatSchemeOption {
  id: string
  name: string
  createdAt: string
  isCurrent: boolean
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Check, ChevronDown, Plus, SlidersHorizontal } from 'lucide-vue-next'

/**
 * SeatSchemeSelector — 方案切换器（V2.0.4-alpha · Phase UI-4B）：
 * 胶囊 Dropdown（非传统 Select）：当前方案名 + 创建时间 + 「当前」标记 + 新建入口。
 * 切换 / 新建语义由父级处理（emits），组件不碰 Store。
 *
 * v3.2.0：页面右侧的「座位方案」卡片撤下（座位图要占满主体区域），
 * 但**重命名 / 删除方案不能跟着消失**——入口挪到本下拉的末行「管理方案」，
 * 打开的是原来那张方案卡的内容（`SeatPlanPanel`，组件本身一行未改）。
 * 方案的全部操作因此仍在一处，不需要在两个地方找。
 */
const props = defineProps<{
  options: SeatSchemeOption[]
  modelValue: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [id: string]
  create: []
  manage: []
}>()

const open = ref(false)
const rootEl = ref<HTMLElement>()

const current = computed(() => props.options.find((option) => option.id === props.modelValue))

function createdLabel(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日创建`
}

function toggle() {
  if (!props.disabled) open.value = !open.value
}

function choose(id: string) {
  open.value = false
  if (id !== props.modelValue) emit('update:modelValue', id)
}

function onCreate() {
  open.value = false
  emit('create')
}

function onManage() {
  open.value = false
  emit('manage')
}

function onDocumentClick(event: MouseEvent) {
  if (open.value && rootEl.value && !rootEl.value.contains(event.target as Node)) {
    open.value = false
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) {
    open.value = false
    event.stopPropagation()
  }
}

onMounted(() => document.addEventListener('click', onDocumentClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick))
</script>

<template>
  <div ref="rootEl" class="scheme" :class="{ 'is-disabled': disabled }" @keydown="onKeydown">
    <button
      type="button"
      class="scheme-trigger"
      :disabled="disabled"
      :aria-expanded="open ? 'true' : 'false'"
      aria-haspopup="listbox"
      @click="toggle"
    >
      <span class="scheme-name">{{ current?.name ?? '选择方案' }}</span>
      <ChevronDown class="scheme-chevron" :size="14" :stroke-width="2" aria-hidden="true" />
    </button>

    <Transition name="scheme-pop">
      <div v-if="open" class="scheme-pop" role="listbox" aria-label="座位方案">
        <button
          v-for="option in options"
          :key="option.id"
          type="button"
          class="scheme-item"
          :class="{ 'is-current': option.isCurrent }"
          role="option"
          :aria-selected="option.isCurrent ? 'true' : 'false'"
          @click="choose(option.id)"
        >
          <span class="scheme-item__main">
            <span class="scheme-item__name">{{ option.name }}</span>
            <span class="scheme-item__meta">{{ createdLabel(option.createdAt) }}</span>
          </span>
          <span v-if="option.isCurrent" class="scheme-item__badge">
            <Check :size="12" :stroke-width="2.5" aria-hidden="true" />
            当前
          </span>
        </button>
        <button type="button" class="scheme-item scheme-item--create" @click="onCreate">
          <Plus :size="14" :stroke-width="2" aria-hidden="true" />
          新建方案
        </button>
        <button type="button" class="scheme-item scheme-item--manage" @click="onManage">
          <SlidersHorizontal :size="14" :stroke-width="2" aria-hidden="true" />
          管理方案（重命名 / 删除）
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.scheme {
  position: relative;
}

.scheme.is-disabled {
  opacity: 0.55;
  pointer-events: none;
}

.scheme-trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  max-width: 220px;
  height: 34px;
  padding: 0 var(--space-3) 0 var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-surface);
  color: var(--color-text-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition:
    border-color var(--transition-fast),
    background var(--transition-fast);
}

.scheme-trigger:hover:not(:disabled) {
  border-color: var(--color-primary);
  background: var(--color-primary-bg);
}

.scheme-trigger:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.scheme-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scheme-chevron {
  flex-shrink: 0;
  color: var(--color-text-tertiary);
}

.scheme-pop {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: var(--z-dropdown);
  min-width: 220px;
  padding: 5px;
  background: var(--glass-bg-card);
  backdrop-filter: blur(var(--nav-blur)) saturate(150%);
  -webkit-backdrop-filter: blur(var(--nav-blur)) saturate(150%);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
}

.scheme-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.scheme-item:hover {
  background: var(--bg-hover);
}

.scheme-item:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.scheme-item__main {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.scheme-item__name {
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.scheme-item__meta {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.scheme-item__badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: var(--color-primary-soft);
  color: var(--color-primary-dark);
  font-size: var(--font-caption);
  font-weight: var(--font-weight-medium);
}

.scheme-item--create {
  margin-top: 3px;
  padding-top: var(--space-2);
  border-top: var(--border-hairline-width) solid var(--color-border-divider);
  border-radius: 0;
  color: var(--color-primary-dark);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
}

/* 末行：与「新建方案」同一条分隔线之下，收尾行贴住弹层圆角 */
.scheme-item--manage {
  border-radius: 0 0 var(--radius-sm) var(--radius-sm);
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
}

.scheme-pop-enter-active,
.scheme-pop-leave-active {
  transition:
    opacity var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}

.scheme-pop-enter-from,
.scheme-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
