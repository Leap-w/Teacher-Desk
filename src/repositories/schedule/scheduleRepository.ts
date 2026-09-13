/**
 * 课程表仓储（V2.2.0-alpha · Phase Cloud-1）。
 *
 * 数据源（键名全部不变）：
 * - `teacherdesk:timetable`——课程（首次启动播种示例课表）；
 * - `teacherdesk:timetable:exchanges`——换课记录（损坏即空，不播种）；
 * - `teacherdesk:timetable:lessons`——**Phase 4 旧键**，启动时单向迁移到新键。
 *
 * normalize / revive / 迁移 / 播种逻辑自 stores/timetable.ts **原样迁入**，行为零变化。
 */
import { appConfig } from '@/config'
import { createSeedLessons } from '@/services/mock'
import { createId } from '@/utils/id'
import {
  classIdOf,
  isValidLessonType,
  isValidPeriodId,
  periodIdFromLegacyPeriod,
} from '@/utils/timetable'
import type { CourseExchange, CourseSlot, Lesson, LessonSnapshot, Weekday } from '@/types/timetable'

import { localStorageAdapter } from '../adapters/LocalStorageAdapter'
import { createCollectionRepository } from '../base/createCollectionRepository'

const LESSONS_KEY = `${appConfig.storageKeyPrefix}:timetable`
const EXCHANGES_KEY = `${appConfig.storageKeyPrefix}:timetable:exchanges`
const LEGACY_LESSONS_KEY = `${appConfig.storageKeyPrefix}:timetable:lessons`

/** 未指定任课教师时的归属：这是教师本人的课表 */
const DEFAULT_TEACHER = '我'

/**
 * 单条课程数据的健壮化（load 时逐条调用）：星期 / 时段非法、科目或班级为空即丢弃该条
 * ——课表条目的必填字段缺一即失去意义，不做「补默认值」的臆造（§11.3）。
 * 字段一律用 `typeof` 严格判定（不做 `Number()` 强转）：外部篡改写入的 `true` / `"1"`
 * 不是合法的星期与时段，应当丢弃而不是被当成周一第 1 节（同 normalizeSeatPlan 口径）。
 *
 * 三处例外是**迁移而非臆造**（V1.1.3）：
 * - 旧 `period: number`（1~8）按 `LEGACY_PERIOD_MIGRATION` 落到新时段（确定性、可重放）；
 * - 旧 `isTemporary: true` 并入 `type: 'substitute'`（同一件事的旧写法）；
 * - `classId` 由班级名重新派生、`teacher` 缺省「我」——都不引入新信息，且都能在抽屉里改。
 */
function normalizeLesson(raw: Partial<Lesson>): Lesson | null {
  const { weekday } = raw
  if (typeof weekday !== 'number' || !Number.isInteger(weekday)) return null
  if (weekday < 1 || weekday > 7) return null
  const periodId = isValidPeriodId(raw.periodId)
    ? raw.periodId
    : periodIdFromLegacyPeriod((raw as { period?: unknown }).period)
  if (!periodId) return null
  const subject = typeof raw.subject === 'string' ? raw.subject.trim() : ''
  const className = typeof raw.className === 'string' ? raw.className.trim() : ''
  if (!subject || !className) return null

  const originalTeacher =
    typeof raw.originalTeacher === 'string' && raw.originalTeacher.trim()
      ? raw.originalTeacher.trim()
      : undefined
  const type = isValidLessonType(raw.type)
    ? raw.type
    : raw.isTemporary === true
      ? 'substitute'
      : 'normal'
  // 代课必须有原教师：只有原教师而类型未标注时，按代课处理（而不是丢掉原教师这个信息）
  const resolvedType = type === 'substitute' && !originalTeacher ? 'normal' : type

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createId(),
    weekday: weekday as Weekday,
    periodId,
    subject,
    classId: classIdOf(className),
    className,
    teacher:
      typeof raw.teacher === 'string' && raw.teacher.trim() ? raw.teacher.trim() : DEFAULT_TEACHER,
    type: resolvedType,
    originalTeacher,
    exchangeId: typeof raw.exchangeId === 'string' && raw.exchangeId ? raw.exchangeId : undefined,
    courseGroupId:
      typeof raw.courseGroupId === 'string' && raw.courseGroupId ? raw.courseGroupId : undefined,
    isTemporary: undefined,
    // 地点：保留读到的值（不丢数据），但界面与导入一律不再使用
    location:
      typeof raw.location === 'string' && raw.location.trim() ? raw.location.trim() : undefined,
  }
}

/** 单条换课记录的健壮化：两端时段非法 / 缺快照即丢弃（半条记录无法复原，留着只会误导） */
function normalizeExchange(raw: Partial<CourseExchange>): CourseExchange | null {
  const normalizeSlot = (value: unknown): CourseSlot | null => {
    if (!value || typeof value !== 'object') return null
    const slot = value as Partial<CourseSlot>
    if (typeof slot.weekday !== 'number' || !Number.isInteger(slot.weekday)) return null
    if (slot.weekday < 1 || slot.weekday > 7) return null
    if (!isValidPeriodId(slot.periodId)) return null
    const className = typeof slot.className === 'string' ? slot.className.trim() : ''
    const subject = typeof slot.subject === 'string' ? slot.subject.trim() : ''
    if (!className || !subject) return null
    return { weekday: slot.weekday as Weekday, periodId: slot.periodId, className, subject }
  }
  const from = normalizeSlot(raw.from)
  const to = normalizeSlot(raw.to)
  if (!from || !to) return null
  const snapshot = raw.fromLesson
  if (!snapshot || typeof snapshot !== 'object') return null
  const snapshotSubject = typeof snapshot.subject === 'string' ? snapshot.subject.trim() : ''
  const snapshotClass = typeof snapshot.className === 'string' ? snapshot.className.trim() : ''
  if (!snapshotSubject || !snapshotClass) return null
  const fromLesson: LessonSnapshot = {
    subject: snapshotSubject,
    classId: classIdOf(snapshotClass),
    className: snapshotClass,
    teacher:
      typeof snapshot.teacher === 'string' && snapshot.teacher.trim()
        ? snapshot.teacher.trim()
        : DEFAULT_TEACHER,
    type: isValidLessonType(snapshot.type) ? snapshot.type : 'normal',
    originalTeacher:
      typeof snapshot.originalTeacher === 'string' && snapshot.originalTeacher.trim()
        ? snapshot.originalTeacher.trim()
        : undefined,
    courseGroupId:
      typeof snapshot.courseGroupId === 'string' && snapshot.courseGroupId
        ? snapshot.courseGroupId
        : undefined,
  }
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createId(),
    from,
    to,
    fromLesson,
    group: raw.group === true,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
  }
}

interface Parsed<T> {
  items: T[]
  /** 被丢弃的条目数（非对象 / 非法字段 / 重复 id） */
  dropped: number
}

/** 过滤 + 逐条规范化 + 去重（同 id 只保留首条：外部篡改可能造出重复 id，会让 v-for key 冲突） */
function filterItems<T extends { id: string }>(
  parsed: unknown[],
  normalize: (raw: never) => T | null,
): Parsed<T> {
  const seen = new Set<string>()
  const items = parsed
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => normalize(item as never))
    .filter((item): item is T => item !== null)
    .filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
  return { items, dropped: parsed.length - items.length }
}

/** 解析一段 JSON 原文（迁移路径专用：对象是「旧键原文」而非列表键）；坏 JSON / 非数组 → null */
function parseRawList<T extends { id: string }>(
  raw: string,
  normalize: (raw: never) => T | null,
): Parsed<T> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    console.warn('[timetable] 缓存不是合法 JSON：', error)
    return null
  }
  if (!Array.isArray(parsed)) return null
  return filterItems(parsed, normalize)
}

/** 丢弃条目时告警（首屏加载与跨标签页同步共用同一句，两边的口径不会各说各话） */
function warnDropped(dropped: number): void {
  if (dropped > 0) {
    // 不覆盖缓存：盘上原文保留，界面先用过滤后的结果（改坏的数据仍可人工找回）
    console.warn(`[timetable] 丢弃 ${dropped} 条不合法的课表条目（缓存原文保留）`)
  }
}

/** 把盘上的原始列表规范成内存里的课表（**首屏加载与跨标签页同步共用**，§11.1） */
export function reviveLessons(raw: unknown[]): Lesson[] {
  const result = filterItems(raw, normalizeLesson)
  warnDropped(result.dropped)
  return result.items
}

/** 同上，作用于换课记录 */
export function reviveExchanges(raw: unknown[]): CourseExchange[] {
  const result = filterItems(raw, normalizeExchange)
  warnDropped(result.dropped)
  return result.items
}

const lessonsRepository = createCollectionRepository<Lesson[]>({
  key: LESSONS_KEY,
  adapter: localStorageAdapter,
  reviveList: reviveLessons,
})

const exchangesRepository = createCollectionRepository<CourseExchange[]>({
  key: EXCHANGES_KEY,
  adapter: localStorageAdapter,
  reviveList: reviveExchanges,
})

export const scheduleRepository = {
  lessons: lessonsRepository,
  exchanges: exchangesRepository,

  /**
   * 读课程：新键 → 旧键迁移 → 首次启动写示例课表。
   * 数据损坏（非数组 / JSON 解析失败）时**安全降级为空数组**，不重置为示例数据
   * ——避免覆盖用户的真实课表（Phase 5 起课表可编辑，示例数据不再是唯一来源）。
   */
  loadLessons(): Lesson[] {
    try {
      const stored = lessonsRepository.load()
      if (stored !== null) return stored

      // Phase 4 旧键迁移：补 classId / teacher 后写入新键
      const legacy = localStorageAdapter.readRaw(LEGACY_LESSONS_KEY)
      if (legacy !== null) {
        const migrated = parseRawList(legacy, normalizeLesson)
        if (migrated !== null) {
          // 这里要的是「新键最终是不是这份内容」，不是「刚才写没写」——writeJSON 幂等，
          // 内容相同就不写、也不返回 true，所以写完读回来对一次
          const target = JSON.stringify(migrated.items)
          localStorageAdapter.writeJSON(LESSONS_KEY, migrated.items)
          if (localStorageAdapter.readRaw(LESSONS_KEY) !== target) {
            console.warn('[timetable] 旧课表迁移写盘失败，旧键保留')
          } else if (migrated.dropped === 0) {
            // 有条目被丢弃时**不删旧键**：迁移是单向的，删了就再也找不回原文
            try {
              localStorageAdapter.remove(LEGACY_LESSONS_KEY)
            } catch (error) {
              console.warn(
                '[timetable] 旧课表已迁移，但旧键未删除（下次启动会再迁移一次）：',
                error,
              )
            }
          } else {
            console.warn(
              `[timetable] 旧课表有 ${migrated.dropped} 条不合法条目未迁移，旧键保留以便找回`,
            )
          }
          return migrated.items
        }
        console.warn('[timetable] 旧课表数据格式异常，跳过迁移（旧键保留）')
      }

      const seed = createSeedLessons()
      return lessonsRepository.writeSeed(seed)
    } catch (error) {
      console.warn('[timetable] 读取本地存储失败：', error)
      return []
    }
  },

  /** 读换课记录：损坏即空数组（换课记录只是「为什么这节在这」的说明，丢了不该让课表打不开） */
  loadExchanges(): CourseExchange[] {
    try {
      return exchangesRepository.load() ?? []
    } catch (error) {
      console.warn('[timetable] 读取本地存储失败：', error)
      return []
    }
  },
}
