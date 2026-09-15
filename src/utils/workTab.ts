import { appConfig } from '@/config'
import { readRaw, writeJSON } from '@/services/storage'

/**
 * 工作管理的「上次看的 Tab」记忆（v3.1.0）。
 *
 * 路由 `/work` 的空路径不再写死重定向到某一页，而是**先看这个记忆**：
 * 没记过 → 课程表（v3.1.0 的新默认）；记过 → 回到教师上次停留的那一页。
 *
 * 与 `utils/studentViewPrefs.ts` 同一套边界（那里是本仓库「纯界面状态」的第一份）：
 * ① **不注册 `syncPersisted`**——「刚才在看课程表还是工作清单」是这台设备上的
 *    观看位置，不该推到云端，更不该参与「最后写入胜出」的冲突判定；
 * ② **不进 `BACKUP_MODULES`**——它不是教师录入的数据，导出备份时不该混进去
 *    （「清空本机数据」按前缀扫描，它会被一起清掉，这是对的）；
 * ③ **读失败一律回默认**——记忆坏掉只该让默认落点变回课程表，不该让 `/work` 打不开。
 *    本文件在 vitest 的 node 环境下也会被 routes.ts 加载，故对 `localStorage`
 *    缺失做了兜底（`services/storage` 内部已判过，这里再兜一层是防 readRaw 抛错）。
 */
export const WORK_TABS = ['/work/schedule', '/work/works'] as const

export type WorkTab = (typeof WORK_TABS)[number]

const STORAGE_KEY = `${appConfig.storageKeyPrefix}:workTab`

/** 没记过时的落点：课程表（v3.1.0 起工作管理默认进课程表，此前是工作清单） */
export const DEFAULT_WORK_TAB: WorkTab = '/work/schedule'

function isWorkTab(value: unknown): value is WorkTab {
  return WORK_TABS.some((tab) => tab === value)
}

/** 读上次停留的 Tab；读不到 / 认不出 / 坏值一律回默认 */
export function loadWorkTab(): WorkTab {
  try {
    const raw = readRaw(STORAGE_KEY)
    if (!raw) return DEFAULT_WORK_TAB
    const parsed: unknown = JSON.parse(raw)
    // 兼容裸字符串与 { tab } 两种写法，认不出就回默认
    const value =
      typeof parsed === 'string'
        ? parsed
        : parsed && typeof parsed === 'object'
          ? (parsed as Record<string, unknown>).tab
          : null
    return isWorkTab(value) ? value : DEFAULT_WORK_TAB
  } catch {
    return DEFAULT_WORK_TAB
  }
}

/** 记下当前停留的 Tab（只认 `/work` 下的两个子页，别的路径一律忽略） */
export function rememberWorkTab(path: string): void {
  if (!isWorkTab(path)) return
  try {
    writeJSON(STORAGE_KEY, path)
  } catch {
    /* 写不进去（隐私模式 / 配额满）不影响使用，下次仍按默认落点 */
  }
}
