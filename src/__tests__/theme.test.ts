import { beforeEach, describe, expect, it, vi } from 'vitest'

import { installFakeBrowser } from './helpers/env'

/**
 * 主题偏好（v3.0.1-rc；**v3.1.0 撤下「跟随系统」档**）：两档选择 / 落盘 /
 * 应用到 <html data-theme> / 旧档案的一次性折算。
 * useTheme 是模块级单例（主题是全局一个事实），用例间用 vi.resetModules 重建。
 */
const prefix = 'teacherdesk'
const THEME_KEY = `${prefix}:theme`

async function freshTheme() {
  vi.resetModules()
  const { useTheme } = await import('@/composables/useTheme')
  const { themeRepository } = await import('@/repositories/theme/themeRepository')
  return { useTheme, themeRepository }
}

describe('theme（浅色 / 深色）', () => {
  beforeEach(() => {
    installFakeBrowser()
    window.localStorage.clear()
    vi.resetModules()
  })

  it('normalizeThemePreference：两档合法，其余一律拒绝（含已撤下的 system）', async () => {
    const { normalizeThemePreference } = await import('@/repositories/theme/themeRepository')
    expect(normalizeThemePreference('light')).toBe('light')
    expect(normalizeThemePreference('dark')).toBe('dark')
    // v3.1.0：「跟随系统」已从类型与界面里撤下，盘上残留的旧值不再被当成合法偏好
    expect(normalizeThemePreference('system')).toBeNull()
    expect(normalizeThemePreference('blue')).toBeNull()
    expect(normalizeThemePreference(42)).toBeNull()
    expect(normalizeThemePreference(null)).toBeNull()
  })

  it('默认浅色：没设过偏好时不写盘，结果落到 <html data-theme>', async () => {
    const { useTheme } = await freshTheme()
    const { theme, effective } = useTheme()
    expect(theme.value).toBe('light')
    expect(effective.value).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(window.localStorage.getItem(THEME_KEY)).toBeNull()
  })

  it('手动选深色：立即生效并落盘（无刷新切换）', async () => {
    const { useTheme } = await freshTheme()
    const { theme, effective, setTheme } = useTheme()
    setTheme('dark')
    expect(theme.value).toBe('dark')
    expect(effective.value).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(JSON.parse(window.localStorage.getItem(THEME_KEY) ?? 'null')).toBe('dark')

    setTheme('light')
    expect(effective.value).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(JSON.parse(window.localStorage.getItem(THEME_KEY) ?? 'null')).toBe('light')
  })

  it('盘上损坏值按未设置处理（回浅色，不炸）', async () => {
    window.localStorage.setItem(THEME_KEY, '{broken json')
    const { themeRepository } = await freshTheme()
    expect(themeRepository.load()).toBeNull()
    const { useTheme } = await freshTheme()
    expect(useTheme().theme.value).toBe('light')
  })

  it('刷新页面：从盘上恢复上一次的选择', async () => {
    window.localStorage.setItem(THEME_KEY, JSON.stringify('dark'))
    const { useTheme } = await freshTheme()
    const { theme, effective } = useTheme()
    expect(theme.value).toBe('dark')
    expect(effective.value).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  /* ---- v3.1.0 一次性迁移：盘上残留的「跟随系统」 ---- */

  it('旧档 system：升级后折算成本机当前深浅并写回（测试环境无 matchMedia → 浅色）', async () => {
    window.localStorage.setItem(THEME_KEY, JSON.stringify('system'))
    const { useTheme } = await freshTheme()
    // 折算完成：盘上不再有第三档，theme 读到的是明确的一档
    expect(JSON.parse(window.localStorage.getItem(THEME_KEY) ?? 'null')).toBe('light')
    expect(useTheme().theme.value).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('foldLegacySystem 认得出旧值、也放得下正常值（幂等，不重复折算）', async () => {
    const { themeRepository } = await freshTheme()

    // 盘上没东西：什么都不做
    expect(themeRepository.foldLegacySystem(() => 'dark')).toBe(false)

    // 正常值：原样留着，不被折算掉
    themeRepository.save('dark')
    expect(themeRepository.foldLegacySystem(() => 'light')).toBe(false)
    expect(themeRepository.load()).toBe('dark')

    // 旧值：折算成调用方给的那一档
    window.localStorage.setItem(THEME_KEY, JSON.stringify('system'))
    expect(themeRepository.foldLegacySystem(() => 'dark')).toBe(true)
    expect(themeRepository.load()).toBe('dark')
    // 再跑一次已经没事可做（旧值已经不在了）
    expect(themeRepository.foldLegacySystem(() => 'light')).toBe(false)
    expect(themeRepository.load()).toBe('dark')
  })
})
