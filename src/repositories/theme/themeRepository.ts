/**
 * 主题偏好仓储（v3.0.1-rc）。
 *
 * 数据源：`teacherdesk:theme`（单字符串键，值 `light` / `dark` / `system`）。
 * **设备本地偏好**：不进云同步、不进备份（两台设备一部手机，深浅各自跟随各自的环境），
 * 因此不 bindCollection——只做幂等的 load / save。
 *
 * Repository First：虽然只是一行偏好，仍走 adapter 而不是让 store 直接摸 localStorage——
 * 这一层没有业务逻辑，纯粹的「读写收口」（页面 / composable 不认识存储这个词）。
 */
import { appConfig } from '@/config'

import { localStorageAdapter } from '../adapters/LocalStorageAdapter'

export const THEME_STORAGE_KEY = `${appConfig.storageKeyPrefix}:theme`

export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const
export type ThemePreference = (typeof THEME_PREFERENCES)[number]

/** 盘上值合法才采纳；损坏 / 未设置返回 null（调用方回 system） */
export function normalizeThemePreference(raw: unknown): ThemePreference | null {
  return typeof raw === 'string' && (THEME_PREFERENCES as readonly string[]).includes(raw)
    ? (raw as ThemePreference)
    : null
}

export const themeRepository = {
  /** 读偏好；键不存在 / 损坏返回 null（不写盘、不回默认——默认由调用方声明） */
  load(): ThemePreference | null {
    const raw = localStorageAdapter.readRaw(THEME_STORAGE_KEY)
    if (raw === null) return null
    try {
      return normalizeThemePreference(JSON.parse(raw))
    } catch {
      return null
    }
  },

  /** 幂等写盘；非法值拒绝（防御未来的调用方笔误） */
  save(preference: ThemePreference): void {
    if (!normalizeThemePreference(preference)) return
    localStorageAdapter.writeJSON(THEME_STORAGE_KEY, preference)
  },

  /** 测试与「恢复默认」用 */
  clear(): void {
    localStorageAdapter.remove(THEME_STORAGE_KEY)
  },
}
