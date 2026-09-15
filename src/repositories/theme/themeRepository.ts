/**
 * 主题偏好仓储（v3.0.1-rc；**v3.1.0 撤下「跟随系统」档**）。
 *
 * 数据源：`teacherdesk:theme`（单字符串键，值 `light` / `dark`）。
 * **设备本地偏好**：不进云同步、不进备份（两台设备一部手机，深浅各自跟随各自的环境），
 * 因此不 bindCollection——只做幂等的 load / save。
 *
 * Repository First：虽然只是一行偏好，仍走 adapter 而不是让 store 直接摸 localStorage——
 * 这一层没有业务逻辑，纯粹的「读写收口」（页面 / composable 不认识存储这个词）。
 */
import { appConfig } from '@/config'

import { localStorageAdapter } from '../adapters/LocalStorageAdapter'

export const THEME_STORAGE_KEY = `${appConfig.storageKeyPrefix}:theme`

export const THEME_PREFERENCES = ['light', 'dark'] as const
export type ThemePreference = (typeof THEME_PREFERENCES)[number]

/** 没设过偏好时的主题——浅色（v3.1.0 前这里跟着系统走，见 `foldLegacySystem`） */
export const DEFAULT_THEME: ThemePreference = 'light'

/** v3.1.0 撤下的第三档。类型里已经没有它，但**已经装在教师手机上的旧值不会自己消失** */
export const LEGACY_SYSTEM_PREFERENCE = 'system'

/** 盘上值合法才采纳；损坏 / 未设置 / 已撤下的旧档一律返回 null（默认由调用方声明） */
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

  /**
   * v3.1.0 一次性迁移：把盘上残留的旧档 `'system'` 折算成明确的一档并写回。
   *
   * **为什么值得单开一个方法**：「跟随系统」已从界面与类型里撤下，可升级上来的设备
   * 盘上还留着 `'system'`。放着不管的话它会被当成「没设过」→ 回落到浅色，
   * 一位深色手机的教师升级后就会莫名其妙变回白底。折算成本机当前系统的深浅，
   * **只做这一次**（写回后 `load()` 只可能读到两档之一），此后与普通偏好无异。
   *
   * 解析用的 `matchMedia` 由调用方注入——本层不认识 `window`，保持可测。
   * 返回 true 表示盘上确实有旧值、已折算。
   */
  foldLegacySystem(resolve: () => ThemePreference): boolean {
    const raw = localStorageAdapter.readRaw(THEME_STORAGE_KEY)
    if (raw === null) return false
    try {
      if (JSON.parse(raw) !== LEGACY_SYSTEM_PREFERENCE) return false
    } catch {
      return false // 损坏值不在这里修，交给 load() 回默认
    }
    themeRepository.save(resolve())
    return true
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
