/**
 * 应用设置仓储（v3.0.4-rc）。
 *
 * 数据源：`teacherdesk:settings`（**单元素数组**，对齐备份模块「一个键 = 一个数组」
 * 的硬约束，与个人资料同一处置）。
 *
 * **一次性迁移**：旧键 `teacherdesk:countdown`（V1.3.1 的 Hero 倒计时设置）里的
 * 背景 / 文案 / 起止日期会映射进新结构，教师不必重填；旧键不删（它不再被读取，
 * 留着是对「原来的值是什么」的一份退路）。
 *
 * 设置是**本机偏好**，不进备份模块与云端同步（与 `teacherdesk:theme` 同一口径）——
 * 备份覆盖的是教师录入的业务数据，不是这台设备的外观与学期口径。
 */
import { appConfig } from '@/config'
import { HERO_BACKGROUNDS } from '@/types/appSettings'
import type { AppSettings } from '@/types/appSettings'

import { localStorageAdapter } from '../adapters/LocalStorageAdapter'
import { createCollectionRepository } from '../base/createCollectionRepository'

const SETTINGS_KEY = `${appConfig.storageKeyPrefix}:settings`
/** 旧键：V1.3.1 的 Hero 倒计时设置（只读一次用于迁移） */
const LEGACY_COUNTDOWN_KEY = `${appConfig.storageKeyPrefix}:countdown`

/**
 * 默认设置：本学期 2026-09-01 开学 → 2027-01-24 期末，支教同起点。
 * 与 V1.3.1 的倒计时默认值一致，教师改过之后以盘上的值为准。
 */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  heroBackground: HERO_BACKGROUNDS[0]!.url,
  heroTitle: '距离期末考试',
  semesterStart: '2026-09-01',
  semesterEnd: '2027-01-24',
  serviceStart: '2026-09-01',
  defaultHomeView: '/',
  showProgress: true,
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 日期字段：形状不对一律回默认值（不臆造日期） */
function dateOf(value: unknown, fallback: string): string {
  return typeof value === 'string' && DATE_RE.test(value) ? value : fallback
}

function textOf(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

/**
 * 单份设置的健壮化（load / 跨标签页同步共用）：
 * 字段认不出回默认值，**绝不写盘**（只影响内存展示）。
 */
function normalizeSettings(raw: unknown): AppSettings {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<AppSettings>
  return {
    heroBackground: textOf(source.heroBackground, DEFAULT_APP_SETTINGS.heroBackground),
    heroTitle: textOf(source.heroTitle, DEFAULT_APP_SETTINGS.heroTitle),
    semesterStart: dateOf(source.semesterStart, DEFAULT_APP_SETTINGS.semesterStart),
    semesterEnd: dateOf(source.semesterEnd, DEFAULT_APP_SETTINGS.semesterEnd),
    serviceStart: dateOf(source.serviceStart, DEFAULT_APP_SETTINGS.serviceStart),
    defaultHomeView: textOf(source.defaultHomeView, DEFAULT_APP_SETTINGS.defaultHomeView),
    showProgress:
      typeof source.showProgress === 'boolean'
        ? source.showProgress
        : DEFAULT_APP_SETTINGS.showProgress,
  }
}

/** 同步通道需要的数组形状：单对象包成单元素数组（键里始终只有一份设置） */
export function reviveSettingsList(raw: unknown[]): AppSettings[] {
  return [normalizeSettings(raw[0])]
}

const repository = createCollectionRepository<AppSettings[]>({
  key: SETTINGS_KEY,
  adapter: localStorageAdapter,
  reviveList: reviveSettingsList,
})

/** 把旧 `teacherdesk:countdown` 的值映射进新结构（缺什么回默认值） */
function migrateFromLegacy(): AppSettings | null {
  try {
    const raw = localStorageAdapter.readRaw(LEGACY_COUNTDOWN_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    const source = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
    const migrated = normalizeSettings({
      heroBackground: source.background,
      heroTitle: source.title,
      semesterStart: source.startDate,
      semesterEnd: source.targetDate,
      // 旧结构没有单独的「支教开始日期」：用学期起点兜底（两者在旧版本里就是同一个值）
      serviceStart: source.startDate,
      showProgress: source.showProgress,
    })
    console.info('[settings] 已从旧 teacherdesk:countdown 迁移 Hero 与学期设置')
    return migrated
  } catch (error) {
    console.warn('[settings] 旧倒计时设置读不出来，按默认值处理：', error)
    return null
  }
}

export const appSettingsRepository = {
  ...repository,

  /** 单份设置的健壮化（store 写入前兜一遍，非法日期不落盘） */
  normalize: normalizeSettings,

  /**
   * 读单份设置：键里存的是「单元素数组」（对齐同步层），也容忍直接存对象的历史写法；
   * 键不存在时先试旧键迁移，再退默认值（**不写盘**，教师改过才落盘）。
   */
  readSettings(): AppSettings {
    try {
      const raw = localStorageAdapter.readRaw(SETTINGS_KEY)
      if (raw === null) return migrateFromLegacy() ?? { ...DEFAULT_APP_SETTINGS }
      const parsed: unknown = JSON.parse(raw)
      const source = Array.isArray(parsed) ? parsed[0] : parsed
      return normalizeSettings(source)
    } catch (error) {
      console.warn('[settings] 读不出来，按默认设置处理：', error)
      return { ...DEFAULT_APP_SETTINGS }
    }
  },
}
