import { computed, ref } from 'vue'

import { themeRepository, type ThemePreference } from '@/repositories/theme/themeRepository'

/**
 * 全站主题（v3.0.1-rc）：浅色 / 深色 / 跟随系统。
 *
 * **生效机制**：这里只负责把「解析后的主题」写到 `<html data-theme>`，
 * 颜色本体在 `styles/theme.css` 的 `[data-theme='dark']` 令牌覆盖——组件里
 * 不允许出现任何 `@media (prefers-color-scheme)` 或深色分支，深浅两套
 * 只有令牌一处定义（同一口径只有一个来源，§11.1）。
 *
 * **system 档**：跟随 `prefers-color-scheme`，`matchMedia` 变化实时重解析、
 * 无刷新切换。手动选择 light / dark 则完全不看系统。
 *
 * 单例（模块级 ref，与 `useCloudSync` 的 busy 同理）：主题是**全局一个事实**，
 * 每次调用各造一份就会各转各的。
 */

const media = window.matchMedia?.('(prefers-color-scheme: dark)') ?? null

/** 教师的选择；首次从盘上读，没设过 = system（跟随系统） */
const preference = ref<ThemePreference>(themeRepository.load() ?? 'system')

/** 解析结果：手动档直接生效，system 档看系统当前深浅 */
const resolved = computed<'light' | 'dark'>(() => {
  if (preference.value !== 'system') return preference.value
  return media?.matches ? 'dark' : 'light'
})

function apply(): void {
  document.documentElement.dataset.theme = resolved.value
}

// 模块加载即对齐一次（main.ts 引到本模块的时机足够早；index.html 里另有防闪内联脚本）
apply()

// 跟随系统：系统深浅变化时实时切换（无刷新）
media?.addEventListener?.('change', apply)

export function useTheme() {
  /** 教师的选择（三档原值，界面 Segmented 直接绑定它） */
  const theme = preference
  /** 实际生效的主题（解析后） */
  const effective = resolved

  /**
   * 设置偏好：**同步**完成落盘与应用——不做 watch 异步分发，一次用户动作
   * 三件事一起做完，界面上不存在「点了但还没生效」的中间态。
   */
  function setTheme(value: ThemePreference): void {
    preference.value = value
    themeRepository.save(value)
    apply()
  }

  return { theme, effective, setTheme }
}
