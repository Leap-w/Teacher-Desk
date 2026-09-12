import { appConfig } from '@/config'
import { readRaw, writeJSON } from '@/services/storage'
import type { StudentSortMode } from '@/utils/studentQuery'

/**
 * 学生档案列表的**界面偏好**（Phase 5B）：搜索词 + 排序方式。
 *
 * 它是本仓库第一份「纯界面状态」的持久化，有三条刻意的边界：
 *
 * ① **不注册 `syncPersisted`。** 那个注册表同时是跨标签页同步与**云端同步**的名单
 *    （`syncedKeys()` → `cloudSync` 逐键推 CloudBase，一个键 = 一份远端文档）。
 *    搜索框里敲了什么、按什么排序，是这台设备上的观看方式，不该被推到云端，
 *    更不该参与「最后写入胜出」的冲突判定。本文件因此照 `WRITTEN_AT_KEY` /
 *    `SEED_TEXT_KEY` 的口径处理：**只有读写，没有登记**。
 * ② **不进 `BACKUP_MODULES`**（`utils/backup.ts`）——同一个理由，它不是教师的数据，
 *    导出备份时不该混进去。但「清空本机数据」按前缀扫描，它会被一起清掉，这是对的。
 * ③ **「随机」不落盘。** 随机是一种此刻的观看顺序，记住它只会让教师每次打开都看到
 *    一个陌生排列；`sort` 的类型在写入侧就收窄成 `Exclude<..., 'random'>`。
 */
export interface StudentViewPrefs {
  keyword: string
  sort: Exclude<StudentSortMode, 'random'>
}

const STORAGE_KEY = `${appConfig.storageKeyPrefix}:studentView`

export const DEFAULT_STUDENT_VIEW_PREFS: StudentViewPrefs = { keyword: '', sort: 'default' }

function isStoredSort(value: unknown): value is StudentViewPrefs['sort'] {
  return value === 'default' || value === 'pinyin'
}

/**
 * 读偏好。**任何异常都静默回默认值**——界面偏好坏掉不该让档案页打不开。
 * 这里不能用 `readList`：它只认数组，而偏好是一个对象。
 */
export function loadStudentViewPrefs(): StudentViewPrefs {
  try {
    const raw = readRaw(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_STUDENT_VIEW_PREFS }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_STUDENT_VIEW_PREFS }
    const record = parsed as Record<string, unknown>
    return {
      keyword: typeof record.keyword === 'string' ? record.keyword : '',
      sort: isStoredSort(record.sort) ? record.sort : 'default',
    }
  } catch {
    return { ...DEFAULT_STUDENT_VIEW_PREFS }
  }
}

/** 写偏好（`writeJSON` 幂等：内容没变就一个字节都不写） */
export function saveStudentViewPrefs(prefs: StudentViewPrefs): void {
  writeJSON(STORAGE_KEY, prefs)
}
