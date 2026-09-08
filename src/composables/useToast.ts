import { ref } from 'vue'

import { TOAST_DURATION, TOAST_MAX_STACK } from '@/constants'
import type { ToastItem, ToastVariant } from '@/types'

const toasts = ref<ToastItem[]>([])
/** 自动消失定时器表：手动 dismiss 时同步清除，避免悬挂定时器 */
const timeouts = new Map<number, number>()
let seq = 0

/** 移除指定 Toast（同时取消其自动消失定时器） */
function dismiss(id: number): void {
  const timer = timeouts.get(id)
  if (timer !== undefined) {
    window.clearTimeout(timer)
    timeouts.delete(id)
  }
  toasts.value = toasts.value.filter((toast) => toast.id !== id)
}

/** 弹出一条 Toast，返回其 id */
function show(message: string, variant: ToastVariant = 'info', duration = TOAST_DURATION): number {
  const id = ++seq
  toasts.value = [...toasts.value, { id, message, variant, duration }]
  if (toasts.value.length > TOAST_MAX_STACK) {
    toasts.value = toasts.value.slice(-TOAST_MAX_STACK)
  }
  if (duration > 0) {
    timeouts.set(
      id,
      window.setTimeout(() => {
        timeouts.delete(id)
        toasts.value = toasts.value.filter((toast) => toast.id !== id)
      }, duration),
    )
  }
  return id
}

function createShortcut(variant: ToastVariant) {
  return (message: string, duration = TOAST_DURATION) => show(message, variant, duration)
}

/**
 * 全局通知（需 App.vue 中挂载 AppToast）。
 * 任意组件调用均共享同一个 Toast 队列。
 */
export function useToast() {
  return {
    toasts,
    show,
    dismiss,
    success: createShortcut('success'),
    info: createShortcut('info'),
    warning: createShortcut('warning'),
    danger: createShortcut('danger'),
  }
}
