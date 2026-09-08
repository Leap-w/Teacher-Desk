<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

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

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/** 已打开的弹窗数：多个弹窗叠加时由最后一个关闭者释放滚动锁 */
let openCount = 0

function lockScroll() {
  openCount += 1
  if (openCount === 1) document.body.style.overflow = 'hidden'
}

function unlockScroll() {
  openCount = Math.max(0, openCount - 1)
  if (openCount === 0) document.body.style.overflow = ''
}

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
  if (event.key === 'Escape' && props.closeOnEsc) {
    requestClose()
    return
  }
  if (event.key !== 'Tab' || !panelRef.value) return
  const focusables = Array.from(
    panelRef.value.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => el.offsetParent !== null)
  if (focusables.length === 0) {
    event.preventDefault()
    return
  }
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const active = document.activeElement
  if (event.shiftKey && (active === first || active === panelRef.value)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      restoreFocus = (document.activeElement as HTMLElement | null) ?? null
      document.addEventListener('keydown', onKeydown)
      lockScroll()
      nextTick(() => panelRef.value?.focus())
    } else {
      document.removeEventListener('keydown', onKeydown)
      unlockScroll()
      const target = restoreFocus
      restoreFocus = null
      if (target?.isConnected) nextTick(() => target.focus())
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  if (props.modelValue) unlockScroll()
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
  padding: var(--space-5);
  background: var(--overlay-scrim);
  backdrop-filter: blur(6px) saturate(120%);
  -webkit-backdrop-filter: blur(6px) saturate(120%);
}

.modal-panel {
  max-width: 100%;
  max-height: calc(100vh - 64px);
  overflow-y: auto;
  padding: var(--space-6);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
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
  font-size: var(--text-lg);
  font-weight: 700;
  letter-spacing: -0.2px;
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
  transition: opacity var(--duration-normal) ease;
}

.modal-enter-active .modal-panel,
.modal-leave-active .modal-panel {
  transition: transform var(--duration-normal) var(--ease-standard);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-panel {
  transform: translateY(16px) scale(0.97);
}

.modal-leave-to .modal-panel {
  transform: translateY(10px) scale(0.98);
}
</style>
