import { beforeEach, describe, expect, it, vi } from 'vitest'

import { installFakeBrowser } from './helpers/env'

/**
 * 主题偏好（v3.0.1-rc）：三档选择 / 落盘 / 应用到 <html data-theme>。
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

describe('theme（浅色 / 深色 / 跟随系统）', () => {
  beforeEach(() => {
    installFakeBrowser()
    window.localStorage.clear()
    vi.resetModules()
  })

  it('normalizeThemePreference：三档合法，其余一律拒绝', async () => {
    const { normalizeThemePreference } = await import('@/repositories/theme/themeRepository')
    expect(normalizeThemePreference('light')).toBe('light')
    expect(normalizeThemePreference('dark')).toBe('dark')
    expect(normalizeThemePreference('system')).toBe('system')
    expect(normalizeThemePreference('blue')).toBeNull()
    expect(normalizeThemePreference(42)).toBeNull()
    expect(normalizeThemePreference(null)).toBeNull()
  })

  it('默认 system：没设过偏好时不写盘，解析结果落到 <html data-theme>', async () => {
    const { useTheme } = await freshTheme()
    const { theme, effective } = useTheme()
    expect(theme.value).toBe('system')
    // 测试环境没有 matchMedia → system 解析为浅色
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

  it('盘上损坏值按未设置处理（回 system，不炸）', async () => {
    window.localStorage.setItem(THEME_KEY, '{broken json')
    const { themeRepository } = await freshTheme()
    expect(themeRepository.load()).toBeNull()
    const { useTheme } = await freshTheme()
    expect(useTheme().theme.value).toBe('system')
  })

  it('刷新页面：从盘上恢复上一次的选择', async () => {
    window.localStorage.setItem(THEME_KEY, JSON.stringify('dark'))
    const { useTheme } = await freshTheme()
    const { theme, effective } = useTheme()
    expect(theme.value).toBe('dark')
    expect(effective.value).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
