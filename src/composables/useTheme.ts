import { computed, ref } from 'vue'

import {
  DEFAULT_THEME,
  themeRepository,
  type ThemePreference,
} from '@/repositories/theme/themeRepository'

/**
 * 全站主题（v3.0.1-rc；**v3.1.0 起只剩浅色 / 深色两档**）。
 *
 * **生效机制**：这里只负责把主题写到 `<html data-theme>`，
 * 颜色本体在 `styles/theme.css` 的 `[data-theme='dark']` 令牌覆盖——组件里
 * 不允许出现任何 `@media (prefers-color-scheme)` 或深色分支，深浅两套
 * 只有令牌一处定义（同一口径只有一个来源，§11.1）。
 *
 * **不再跟随系统**：第三档已从界面与类型里撤下，`matchMedia` 也不再监听——
 * 深浅从此只由教师的这一次点击决定，系统换主题不动它。
 * 升级设备上残留的旧值由 `foldLegacySystem` 一次性折算（见仓储的说明）。
 *
 * 单例（模块级 ref，与 `useCloudSync` 的 busy 同理）：主题是**全局一个事实**，
 * 每次调用各造一份就会各转各的。
 */

/** 只在一次性折算旧档时用一次：这台设备当前系统的深浅 */
const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? false

// v3.1.0：先把盘上残留的「跟随系统」折算成本机当前的深浅并写回，再读最终偏好。
// 顺序不能反——load() 认不出旧档，会把它当成「没设过」。
themeRepository.foldLegacySystem(() => (prefersDark ? 'dark' : 'light'))

/** 教师的选择；首次从盘上读，没设过 = 浅色 */
const preference = ref<ThemePreference>(themeRepository.load() ?? DEFAULT_THEME)

/** 实际生效的主题：偏好即结果（不再有解析这一步） */
const resolved = computed<'light' | 'dark'>(() => preference.value)

function apply(): void {
  document.documentElement.dataset.theme = resolved.value
}

// 模块加载即对齐一次（main.ts 引到本模块的时机足够早；index.html 里另有防闪内联脚本）
apply()

export function useTheme() {
  /** 教师的选择（界面 Segmented 直接绑定它） */
  const theme = preference
  /** 实际生效的主题（与偏好同值；保留这个出口，调用方不必知道两者已合流） */
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
