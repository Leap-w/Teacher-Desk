import { computed, ref } from 'vue'

import { appConfig } from '@/config'
import { readRaw, writeJSON } from '@/services/storage'

/**
 * Hero 倒计时设置（V1.3.1）——独立的数据块，不碰任何既有业务结构：
 * 键 `teacherdesk:countdown` 是本版新增的 key，读写都走 services/storage
 * （组件不直接碰 localStorage，§3.2 写入纪律）。
 * 默认口径 = 本学期开学（2026-09-01）→ 期末（2027-01-24），与「我的」页工作时光一致。
 */

export interface CountdownSettings {
  /** 倒计时标题，如「距离期末考试」 */
  title: string
  /** 开始日期（YYYY-MM-DD） */
  startDate: string
  /** 目标日期（YYYY-MM-DD） */
  targetDate: string
  /** Hero 背景图 URL */
  background: string
  /** 是否显示进度条与百分比 */
  showProgress: boolean
}

/** 昌都记忆同源背景预设（默认第一张：昌都雪山） */
export const HERO_BACKGROUNDS: { id: string; label: string; url: string }[] = [
  {
    id: 'snow',
    label: '昌都雪山',
    url: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1600&auto=format&fit=crop&q=80',
  },
  {
    id: 'starry',
    label: '高原星夜',
    url: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1600&auto=format&fit=crop&q=80',
  },
  {
    id: 'ridge',
    label: '群山远眺',
    url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1600&auto=format&fit=crop&q=80',
  },
]

const STORAGE_KEY = `${appConfig.storageKeyPrefix}:countdown`

export const DEFAULT_COUNTDOWN_SETTINGS: CountdownSettings = {
  title: '距离期末考试',
  startDate: '2026-09-01',
  targetDate: '2027-01-24',
  background: HERO_BACKGROUNDS[0]!.url,
  showProgress: true,
}

function normalize(raw: unknown): CountdownSettings {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<CountdownSettings>
  const text = (v: unknown, fallback: string): string =>
    typeof v === 'string' && v.trim() ? v.trim() : fallback
  const date = (v: unknown, fallback: string): string =>
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback
  return {
    title: text(source.title, DEFAULT_COUNTDOWN_SETTINGS.title),
    startDate: date(source.startDate, DEFAULT_COUNTDOWN_SETTINGS.startDate),
    targetDate: date(source.targetDate, DEFAULT_COUNTDOWN_SETTINGS.targetDate),
    background: text(source.background, DEFAULT_COUNTDOWN_SETTINGS.background),
    showProgress:
      typeof source.showProgress === 'boolean'
        ? source.showProgress
        : DEFAULT_COUNTDOWN_SETTINGS.showProgress,
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

function dayKey(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function useCountdownSettings() {
  const settings = ref<CountdownSettings>(normalize(readRaw(STORAGE_KEY) ?? undefined))

  function update(patch: Partial<CountdownSettings>): void {
    settings.value = normalize({ ...settings.value, ...patch })
    writeJSON(STORAGE_KEY, settings.value)
  }

  /** 视图层共享时钟的一帧（由调用方驱动，30 秒刷新一次即可） */
  const now = ref(new Date())

  /** 已过去天数（第 X 天，含首日） */
  const daysPassed = computed(() => {
    const start = dayKey(new Date(`${settings.value.startDate}T00:00:00`))
    return Math.max(1, Math.floor((dayKey(now.value) - start) / DAY_MS) + 1)
  })

  /** 剩余天数（今天算还没结束的一天） */
  const daysRemaining = computed(() => {
    const end = dayKey(new Date(`${settings.value.targetDate}T00:00:00`))
    return Math.max(0, Math.ceil((end - dayKey(now.value)) / DAY_MS))
  })

  /** 完成百分比（0–100，越界收敛） */
  const progress = computed(() => {
    const start = dayKey(new Date(`${settings.value.startDate}T00:00:00`))
    const end = dayKey(new Date(`${settings.value.targetDate}T00:00:00`))
    const total = end - start
    if (total <= 0) return 100
    const passed = Math.min(Math.max(dayKey(now.value) - start, 0), total)
    return Math.round((passed / total) * 100)
  })

  return { settings, update, now, daysPassed, daysRemaining, progress }
}
