import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { appConfig } from '@/config'
import { useNow } from '@/composables/useToday'
import { createSeedLessons } from '@/services/mock'
import { createId } from '@/utils/id'
import {
  MAX_LESSON_PERIOD,
  WEEKDAY_LABELS,
  classIdOf,
  findSlotConflict,
  sortLessons,
  weekdayOf,
  weekendWeekdaysOf,
} from '@/utils/timetable'
import type { Lesson, LessonInput, Weekday } from '@/types/timetable'

const STORAGE_KEY = `${appConfig.storageKeyPrefix}:timetable`
/** Phase 4（v0.6.0）的旧键；首次加载自动迁移到 STORAGE_KEY，见 loadLessons */
const LEGACY_STORAGE_KEY = `${appConfig.storageKeyPrefix}:timetable:lessons`

/** 未指定任课教师时的归属：这是教师本人的课表 */
const DEFAULT_TEACHER = '我'

/**
 * 单条课程数据的健壮化（load 时逐条调用）：星期 / 节次非法、科目或班级为空即丢弃该条
 * ——课表条目的必填字段缺一即失去意义，不做「补默认值」的臆造（§11.3）。
 * 字段一律用 `typeof` 严格判定（不做 `Number()` 强转）：外部篡改写入的 `true` / `"1"`
 * 不是合法的星期与节次，应当丢弃而不是被当成周一第 1 节（同 normalizeSeatPlan 口径）。
 *
 * 两处例外是**派生而非臆造**：`classId` 一律由班级名重新派生（同名必同 id，不采信缓存里
 * 的旧值）、`teacher` 缺省为「我」（本人课表）——两者都不引入新信息，且都能在编辑抽屉里改。
 */
function normalizeLesson(raw: Partial<Lesson>): Lesson | null {
  const { weekday, period } = raw
  if (typeof weekday !== 'number' || !Number.isInteger(weekday)) return null
  if (weekday < 1 || weekday > 7) return null
  if (typeof period !== 'number' || !Number.isInteger(period) || period < 1) return null
  if (period > MAX_LESSON_PERIOD) return null
  const subject = typeof raw.subject === 'string' ? raw.subject.trim() : ''
  const className = typeof raw.className === 'string' ? raw.className.trim() : ''
  if (!subject || !className) return null
  const location = typeof raw.location === 'string' ? raw.location.trim() : ''
  const teacher =
    typeof raw.teacher === 'string' && raw.teacher.trim() ? raw.teacher.trim() : DEFAULT_TEACHER
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createId(),
    weekday: weekday as Weekday,
    period,
    subject,
    classId: classIdOf(className),
    className,
    teacher,
    location: location || undefined,
    isTemporary: raw.isTemporary === true,
  }
}

interface ParsedLessons {
  /** 过滤后的课程 */
  lessons: Lesson[]
  /** 被丢弃的条目数（非对象 / 非法字段 / 重复 id），用于判断「是否保留现场」 */
  dropped: number
}

/**
 * 解析一段缓存文本：`null` 表示损坏（不是 JSON，或不是数组）。
 * 解析失败在此吞掉，让调用方**对两种损坏形态走同一条降级路径** ——
 * 否则「旧键不是 JSON」会冒泡到外层 catch 变成空课表，与「旧键不是数组」的
 * 「跳过迁移、保留现场、先用示例课表」各说各话（开发手册 §9.7 记录项）。
 */
function readLessons(raw: string): ParsedLessons | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    console.warn('[timetable] 课表缓存不是合法 JSON：', error)
    return null
  }
  if (!Array.isArray(parsed)) return null
  // 同一 id 只保留首条：外部篡改可能造出重复 id，会让列表的 v-for key 冲突
  const seen = new Set<string>()
  const lessons = parsed
    .filter((item): item is Partial<Lesson> => Boolean(item) && typeof item === 'object')
    .map((item) => normalizeLesson(item))
    .filter((item): item is Lesson => item !== null)
    .filter((lesson) => {
      if (seen.has(lesson.id)) return false
      seen.add(lesson.id)
      return true
    })
  return { lessons, dropped: parsed.length - lessons.length }
}

/**
 * 从 localStorage 读取课程：新键 → 旧键迁移 → 首次启动写示例课表。
 * 数据损坏（非数组 / JSON 解析失败）时**安全降级为空数组**，不重置为示例数据
 * ——避免覆盖用户的真实课表（Phase 5 起课表可编辑，示例数据不再是唯一来源）。
 */
function loadLessons(): Lesson[] {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored !== null) {
      const parsed = readLessons(stored)
      if (parsed === null) {
        console.warn('[timetable] localStorage 数据格式异常，已重置为空课表')
        return []
      }
      if (parsed.dropped > 0) {
        // 不覆盖缓存：盘上原文保留，界面先用过滤后的结果（改坏的数据仍可人工找回）
        console.warn(`[timetable] 丢弃 ${parsed.dropped} 条不合法的课表条目（缓存原文保留）`)
      }
      return parsed.lessons
    }

    // Phase 4 旧键迁移：补 classId / teacher 后写入新键
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY)
    if (legacy !== null) {
      const migrated = readLessons(legacy)
      if (migrated !== null) {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated.lessons))
          // 有条目被丢弃时**不删旧键**：迁移是单向的，删了就再也找不回原文（同「保留现场」口径）
          if (migrated.dropped === 0) {
            window.localStorage.removeItem(LEGACY_STORAGE_KEY)
          } else {
            console.warn(
              `[timetable] 旧课表有 ${migrated.dropped} 条不合法条目未迁移，旧键保留以便找回`,
            )
          }
        } catch (error) {
          // 写失败就保留旧键，下次启动重试；本次仍返回迁移结果，界面可用
          console.warn('[timetable] 旧课表迁移写盘失败：', error)
        }
        return migrated.lessons
      }
      // 旧键内容损坏：不写新键、不删旧键（保留现场），本次先用示例课表
      console.warn('[timetable] 旧课表数据格式异常，跳过迁移（旧键保留）')
    }

    const seed = createSeedLessons()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed))
    return seed
  } catch (error) {
    console.warn('[timetable] 读取 localStorage 失败：', error)
    return []
  }
}

/**
 * 必填字段与取值范围的兜底校验（表单已提示，此处防其他写入入口绕过）。
 * 与 `normalizeLesson` 同款 `typeof` 严格判定——上游若传 `undefined` / 非字符串，
 * 这里**拒绝写入**，不让 `input.subject.trim()` 抛异常冒泡到点击回调（§8 审查项）。
 * `classId` 必须与班级名派生结果一致：班级名是唯一事实来源（§2.6），两者各说各话即拒绝。
 */
function isLessonInputValid(input: LessonInput): boolean {
  if (typeof input.weekday !== 'number' || !Number.isInteger(input.weekday)) return false
  if (input.weekday < 1 || input.weekday > 7) return false
  if (typeof input.period !== 'number' || !Number.isInteger(input.period)) return false
  if (input.period < 1 || input.period > MAX_LESSON_PERIOD) return false
  if (typeof input.subject !== 'string' || !input.subject.trim()) return false
  if (typeof input.className !== 'string' || !input.className.trim()) return false
  if (typeof input.classId !== 'string' || input.classId !== classIdOf(input.className))
    return false
  if (typeof input.teacher !== 'string' || !input.teacher.trim()) return false
  if (input.location !== undefined && typeof input.location !== 'string') return false
  return true
}

/**
 * 课程中心状态（Phase 5）：课表的读写唯一入口。
 * 数据源：`teacherdesk:timetable`（Phase 4 的 `teacherdesk:timetable:lessons` 自动迁移）。
 * 「今天」由共享时钟 `useNow()` 解析，跨零点自动切换（单一定时器，见 §9.7）。
 */
export const useTimetableStore = defineStore('timetable', () => {
  const lessons = ref<Lesson[]>(loadLessons())
  const now = useNow()

  watch(
    lessons,
    (value) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
      } catch (error) {
        console.warn('[timetable] 写入 localStorage 失败：', error)
      }
    },
    { deep: true },
  )

  /** 今天是星期几（按共享时钟解析） */
  const todayWeekday = computed(() => weekdayOf(now.value))

  /** 今天的中文星期标签（如「星期四」），供卡片徽标展示 */
  const todayLabel = computed(() => WEEKDAY_LABELS[todayWeekday.value])

  /** 某天的课程（节次升序）；周末通常为空数组 → 工作台今日课程卡片显示空态 */
  function lessonsOf(weekday: Weekday): Lesson[] {
    return sortLessons(lessons.value.filter((lesson) => lesson.weekday === weekday))
  }

  /** 今日课程（工作台直接读它） */
  const todayLessons = computed(() => lessonsOf(todayWeekday.value))

  /**
   * 本周课时数。本地课表是「按周循环」的固定课表，全部条目即一周的课，
   * 因此直接取条数；接入真实学期周次后此处改为按周筛选（§9.7）。
   */
  const weekLessonCount = computed(() => lessons.value.length)

  /** 需要追加到周视图的周末列（都没课则为空 → 保持默认五列） */
  const weekendWeekdays = computed(() => weekendWeekdaysOf(lessons.value))

  /** 已出现过的班级名（升序，供编辑抽屉的下拉候选） */
  const classNames = computed(() =>
    [...new Set(lessons.value.map((lesson) => lesson.className))].sort((a, b) =>
      a.localeCompare(b, 'zh-Hans-CN'),
    ),
  )

  /** 该时间是否已有课（同一教师同一节次只能在一个班）；编辑自身时传 excludeId 排除 */
  function isSlotTaken(weekday: Weekday, period: number, excludeId?: string): boolean {
    return findSlotConflict(lessons.value, weekday, period, excludeId) !== undefined
  }

  /** 返回占用该时间的课程（供表单提示「与 XXX 冲突」），无冲突返回 undefined */
  function slotConflict(weekday: Weekday, period: number, excludeId?: string): Lesson | undefined {
    return findSlotConflict(lessons.value, weekday, period, excludeId)
  }

  /** 新增课程；内容不合法或该时间已有课时拒绝写入并返回 undefined */
  function addLesson(input: LessonInput): Lesson | undefined {
    if (!isLessonInputValid(input)) return undefined
    if (isSlotTaken(input.weekday, input.period)) return undefined
    const lesson: Lesson = { ...input, id: createId() }
    lessons.value = [...lessons.value, lesson]
    return lesson
  }

  /** 更新课程；id 不存在、内容不合法或与他课时间冲突时返回 undefined（可保留自身时段） */
  function updateLesson(id: string, patch: Partial<LessonInput>): Lesson | undefined {
    const index = lessons.value.findIndex((item) => item.id === id)
    if (index === -1) return undefined
    const next: Lesson = { ...lessons.value[index], ...patch, id }
    // 班级名改了却没带 classId 时重新派生，避免两者各说各话
    if (patch.className !== undefined && patch.classId === undefined) {
      next.classId = classIdOf(next.className)
    }
    if (!isLessonInputValid(next)) return undefined
    if (isSlotTaken(next.weekday, next.period, id)) return undefined
    lessons.value = [...lessons.value.slice(0, index), next, ...lessons.value.slice(index + 1)]
    return next
  }

  /** 删除课程；目标不存在返回 false */
  function removeLesson(id: string): boolean {
    const index = lessons.value.findIndex((item) => item.id === id)
    if (index === -1) return false
    lessons.value = [...lessons.value.slice(0, index), ...lessons.value.slice(index + 1)]
    return true
  }

  return {
    lessons,
    todayWeekday,
    todayLabel,
    todayLessons,
    weekLessonCount,
    weekendWeekdays,
    classNames,
    lessonsOf,
    isSlotTaken,
    slotConflict,
    addLesson,
    updateLesson,
    removeLesson,
  }
})
