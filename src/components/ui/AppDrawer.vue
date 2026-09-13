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
  /** 面板宽度，数字按 px 处理（窄屏自动占满） */
  width?: number | string
  closeOnOverlay?: boolean
  closeOnEsc?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  width: 420,
  closeOnOverlay: true,
  closeOnEsc: true,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  close: []
}>()

const panelRef = ref<HTMLElement>()

/** 本实例在弹层栈中的身份（只有最上层响应 ESC） */
const layerToken = Symbol('drawer')
/** 本实例是否持有滚动锁（避免「没锁却解锁」把别人的锁减掉） */
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
  // 不是最上层时不接管 Tab：其上的对话框负责自己的焦点循环
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
    <Transition name="drawer">
      <div v-if="modelValue" class="drawer-overlay" @click.self="onOverlayClick">
        <div
          ref="panelRef"
          class="drawer-panel"
          role="dialog"
          aria-modal="true"
          :aria-label="title || undefined"
          tabindex="-1"
          :style="{ '--drawer-width': typeof width === 'number' ? `${width}px` : width }"
        >
          <header v-if="title || $slots.header" class="drawer-header">
            <slot name="header">
              <h2 class="drawer-title">{{ title }}</h2>
            </slot>
            <button class="drawer-close" type="button" aria-label="关闭抽屉" @click="requestClose">
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

          <div class="drawer-body">
            <slot />
          </div>

          <footer v-if="$slots.footer" class="drawer-footer">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drawer-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  justify-content: flex-end;
  background: var(--overlay-scrim);
  backdrop-filter: blur(6px) saturate(120%);
  -webkit-backdrop-filter: blur(6px) saturate(120%);
}

.drawer-panel {
  display: flex;
  flex-direction: column;
  width: var(--drawer-width, 420px);
  max-width: 100%;
  height: 100%;
  background: var(--color-surface);
  border-left: 1px solid var(--color-border);
  box-shadow: var(--shadow-lg);
  outline: none;
}

.drawer-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  /* 顶部 / 右侧安全区：抽屉贴右上角，横屏时标题不钻进刘海 */
  padding: calc(var(--space-5) + env(safe-area-inset-top, 0px))
    calc(var(--space-5) + env(safe-area-inset-right, 0px)) var(--space-3) var(--space-5);
}

.drawer-title {
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.2px;
}

.drawer-close {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
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

.drawer-close:hover {
  background: var(--color-fill-disabled);
  color: var(--color-text);
}

.drawer-close:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.drawer-close svg {
  width: 15px;
  height: 15px;
}

.drawer-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 calc(var(--space-5) + env(safe-area-inset-right, 0px)) var(--space-5) var(--space-5);
}

/* 操作按钮常驻底部：表单再长也不用滚到底才能保存 */
.drawer-footer {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
  padding: var(--space-3) calc(var(--space-5) + env(safe-area-inset-right, 0px))
    calc(var(--space-3) + env(safe-area-inset-bottom, 0px)) var(--space-5);
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}

/* 手机：抽屉占满整屏，避免只留一条看不到内容的缝 */
@media (max-width: 640px) {
  .drawer-panel {
    width: 100%;
    border-left: none;
  }
}

.drawer-enter-active,
.drawer-leave-active {
  transition: opacity var(--duration-normal) ease;
}

.drawer-enter-active .drawer-panel,
.drawer-leave-active .drawer-panel {
  transition: transform var(--duration-normal) var(--ease-standard);
}

.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}

.drawer-enter-from .drawer-panel,
.drawer-leave-to .drawer-panel {
  transform: translateX(100%);
}
</style>
