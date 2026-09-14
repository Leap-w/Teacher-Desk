import { ref } from 'vue'

/**
 * 登录弹窗的全局开关（v3.0.2-rc）。
 *
 * 登录是**全局一个入口**：Header 头像、「我的」页空状态都唤起同一个弹窗，
 * 模块级 ref 让两处共享同一个开合状态（与 `useCloudSync` 的 busy 同理）。
 * 登录不要做成页面——从哪里点开就回到哪里（弹窗语义，不跳路由）。
 */
const open = ref(false)

export function useLoginModal() {
  return {
    open,
    show: (): void => {
      open.value = true
    },
    hide: (): void => {
      open.value = false
    },
  }
}
