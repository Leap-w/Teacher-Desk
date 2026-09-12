<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

import {
  handleFocusTrap,
  isTopLayer,
  lockScroll,
  popLayer,
  pushLayer,
  unlockScroll,
} from './layers'

interface Props {
  modelValue: boolean
  title?: string
  /** 面板宽度，数字按 px 处理 */
  width?: number | string
  closeOnOverlay?: boolean
  closeOnEsc?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  width: 480,
  closeOnOverlay: true,
  closeOnEsc: true,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  close: []
}>()

const panelRef = ref<HTMLElement>()

/**
 * 弹层栈身份与滚动锁持有标记（与 AppDrawer 共用 layers.ts）：
 * 只有最上层响应 ESC，只有真正加过锁的实例才解锁。
 */
const layerToken = Symbol('modal')
let locked = false

/** 打开前的活动元素，关闭后还原焦点 */
let restoreFocus: HTMLElement | null = null

function requestClose() {
  emit('update:modelValue', false)
  emit('close')
}

function onOverlayClick() {
  if (props.closeOnOverlay) requestClose()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    if (props.closeOnEsc && isTopLayer(layerToken)) requestClose()
    return
  }
  if (event.key !== 'Tab' || !panelRef.value) return
  // 不是最上层时不接管 Tab：其上的抽屉 / 对话框负责自己的焦点循环
  if (!isTopLayer(layerToken)) return
  handleFocusTrap(panelRef.value, event)
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      restoreFocus = (document.activeElement as HTMLElement | null) ?? null
      document.addEventListener('keydown', onKeydown)
      if (!locked) {
        locked = true
        pushLayer(layerToken)
        lockScroll()
      }
      nextTick(() => panelRef.value?.focus())
    } else {
      document.removeEventListener('keydown', onKeydown)
      if (locked) {
        locked = false
        popLayer(layerToken)
        unlockScroll()
      }
      const target = restoreFocus
      restoreFocus = null
      if (target?.isConnected) nextTick(() => target.focus())
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  if (locked) {
    locked = false
    popLayer(layerToken)
    unlockScroll()
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="modal-overlay" @click.self="onOverlayClick">
        <div
          ref="panelRef"
          class="modal-panel"
          role="dialog"
          aria-modal="true"
          :aria-label="title || undefined"
          tabindex="-1"
          :style="{ width: typeof width === 'number' ? `${width}px` : width }"
        >
          <header v-if="title || $slots.header" class="modal-header">
            <slot name="header">
              <h2 class="modal-title">{{ title }}</h2>
            </slot>
            <button class="modal-close" type="button" aria-label="关闭对话框" @click="requestClose">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </header>
          <div class="modal-body">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="modal-footer">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  /* 安全区算进遮罩内边距：弹窗不贴刘海，底部也不会被 home 指示条压住 */
  padding: calc(var(--space-5) + env(safe-area-inset-top, 0px))
    calc(var(--space-5) + env(safe-area-inset-right, 0px))
    calc(var(--space-5) + env(safe-area-inset-bottom, 0px))
    calc(var(--space-5) + env(safe-area-inset-left, 0px));
  background: var(--overlay-scrim);
  backdrop-filter: var(--glass-blur-overlay);
  -webkit-backdrop-filter: var(--glass-blur-overlay);
}

.modal-panel {
  max-width: 100%;
  /* 64px = 遮罩上下内边距（各 20px）外再留一点余量；安全区也要减掉，否则高屏机上会顶出屏幕 */
  max-height: calc(100vh - 64px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
  overflow-y: auto;
  padding: var(--spacing-page);
  background: var(--color-bg-white);
  border: none;
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-xl);
  outline: none;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.modal-title {
  font-size: var(--font-card-title, 18px);
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.2px;
  color: var(--color-text-primary);
}

.modal-close {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background var(--transition-fast),
    color var(--transition-fast);
}

.modal-close:hover {
  background: var(--color-fill-disabled);
  color: var(--color-text);
}

.modal-close svg {
  width: 14px;
  height: 14px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
  margin-top: var(--space-5);
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity var(--duration-fast) ease;
}

.modal-enter-active .modal-panel,
.modal-leave-active .modal-panel {
  /* CDL 弹窗入场：spring 曲线 + 40px 上滑（与 Changdu Memory modal-sheet 一致） */
  transition: transform var(--duration-normal) var(--ease-spring);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-panel,
.modal-leave-to .modal-panel {
  transform: translateY(40px);
}
</style>
