import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { appConfig } from '@/config'
import { useNow } from '@/composables/useToday'
import { createSeedLessons } from '@/services/mock'
import { localStoragePort, readRaw, writeJSON, writeSeedJSON } from '@/services/storage'
import { syncPersisted } from '@/services/sync'
import { createId } from '@/utils/id'
import {
  WEEKDAY_LABELS,
  classIdOf,
  findSlotConflict,
  isValidPeriodId,
  isValidLessonType,
  periodIdFromLegacyPeriod,
  periodLabelOf,
  sameEveningGroupSiblings,
  sortLessons,
  weekdayOf,
  weekendWeekdaysOf,
} from '@/utils/timetable'
import { EVENING_PERIOD_IDS } from '@/types/timetable'
import type {
  CourseExchange,
  CoursePeriodId,
  CourseSlot,
  Lesson,
  LessonInput,
  LessonSnapshot,
  Weekday,
} from '@/types/timetable'

const STORAGE_KEY = `${appConfig.storageKeyPrefix}:timetable`
/** 换课记录单独一个键：课程表键仍是「课程数组」，旧数据不需要改形状即可继续读 */
const EXCHANGE_KEY = `${appConfig.storageKeyPrefix}:timetable:exchanges`
/** Phase 4（v0.6.0）的旧键；首次加载自动迁移到 STORAGE_KEY，见 loadLessons */
const LEGACY_STORAGE_KEY = `${appConfig.storageKeyPrefix}:timetable:lessons`

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

function readList<T extends { id: string }>(
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
function reviveLessons(raw: unknown[]): Lesson[] {
  const result = filterItems(raw, normalizeLesson)
  warnDropped(result.dropped)
  return result.items
}

/** 同上，作用于换课记录 */
function reviveExchanges(raw: unknown[]): CourseExchange[] {
  const result = filterItems(raw, normalizeExchange)
  warnDropped(result.dropped)
  return result.items
}

/**
 * 读课程：新键 → 旧键迁移 → 首次启动写示例课表。
 * 数据损坏（非数组 / JSON 解析失败）时**安全降级为空数组**，不重置为示例数据
 * ——避免覆盖用户的真实课表（Phase 5 起课表可编辑，示例数据不再是唯一来源）。
 */
function loadLessons(): Lesson[] {
  try {
    const stored = readRaw(STORAGE_KEY)
    if (stored !== null) {
      const parsed = readList(stored, normalizeLesson)
      if (parsed === null) {
        console.warn('[timetable] 本地数据不是列表，已按空课表处理（原文保留）')
        return []
      }
      warnDropped(parsed.dropped)
      return parsed.items
    }

    // Phase 4 旧键迁移：补 classId / teacher 后写入新键
    const legacy = readRaw(LEGACY_STORAGE_KEY)
    if (legacy !== null) {
      const migrated = readList(legacy, normalizeLesson)
      if (migrated !== null) {
        // 这里要的是「新键最终是不是这份内容」，不是「刚才写没写」——writeJSON 幂等，
        // 内容相同就不写、也不返回 true，所以写完读回来对一次
        const target = JSON.stringify(migrated.items)
        writeJSON(STORAGE_KEY, migrated.items)
        if (readRaw(STORAGE_KEY) !== target) {
          console.warn('[timetable] 旧课表迁移写盘失败，旧键保留')
        } else if (migrated.dropped === 0) {
          // 有条目被丢弃时**不删旧键**：迁移是单向的，删了就再也找不回原文
          try {
            localStoragePort.remove(LEGACY_STORAGE_KEY)
          } catch (error) {
            console.warn('[timetable] 旧课表已迁移，但旧键未删除（下次启动会再迁移一次）：', error)
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
    writeSeedJSON(STORAGE_KEY, seed)
    return seed
  } catch (error) {
    console.warn('[timetable] 读取本地存储失败：', error)
    return []
  }
}

/** 读换课记录：损坏即空数组（换课记录只是「为什么这节在这」的说明，丢了不该让课表打不开） */
function loadExchanges(): CourseExchange[] {
  const stored = readRaw(EXCHANGE_KEY)
  if (stored === null) return []
  const parsed = readList(stored, normalizeExchange)
  if (parsed === null) {
    console.warn('[timetable] 换课记录不是列表，已按空处理（原文保留）')
    return []
  }
  warnDropped(parsed.dropped)
  return parsed.items
}

/**
 * 必填字段与取值范围的兜底校验（表单已提示，此处防其他写入入口绕过）。
 * 与 `normalizeLesson` 同款 `typeof` 严格判定——上游若传 `undefined` / 非字符串，
 * 这里**拒绝写入**，不让 `input.subject.trim()` 抛异常冒泡到点击回调。
 * `classId` 必须与班级名派生结果一致：班级名是唯一事实来源（§2.6），两者各说各话即拒绝。
 * 代课必须给原教师（需求：代课要能说清「我为什么出现在这节课」）。
 */
function isLessonInputValid(input: LessonInput): boolean {
  if (typeof input.weekday !== 'number' || !Number.isInteger(input.weekday)) return false
  if (input.weekday < 1 || input.weekday > 7) return false
  if (!isValidPeriodId(input.periodId)) return false
  if (typeof input.subject !== 'string' || !input.subject.trim()) return false
  if (typeof input.className !== 'string' || !input.className.trim()) return false
  if (typeof input.classId !== 'string' || input.classId !== classIdOf(input.className))
    return false
  if (typeof input.teacher !== 'string' || !input.teacher.trim()) return false
  if (!isValidLessonType(input.type)) return false
  if (input.type === 'substitute' && !input.originalTeacher?.trim()) return false
  return true
}

/** 课程 → 该位置的可复原快照 */
function snapshotOf(lesson: Lesson): LessonSnapshot {
  return {
    subject: lesson.subject,
    classId: lesson.classId,
    className: lesson.className,
    teacher: lesson.teacher,
    type: lesson.type,
    originalTeacher: lesson.originalTeacher,
    courseGroupId: lesson.courseGroupId,
  }
}

/** 课程 → 它在换课记录里的位置 */
function slotOf(lesson: Lesson): CourseSlot {
  return {
    weekday: lesson.weekday,
    periodId: lesson.periodId,
    className: lesson.className,
    subject: lesson.subject,
  }
}

/** 换课结果：失败时给出可读原因（页面直接 toast 出来） */
export type ExchangeOutcome =
  { ok: true; exchanges: CourseExchange[] } | { ok: false; reason: string }

/** 撤销结果 */
export type UndoExchangeOutcome = { ok: true; restored: number } | { ok: false; reason: string }

/** 课程导入落库结果 */
export type CourseImportOutcome =
  { ok: true; added: number; replaced: number } | { ok: false; reason: string }

/**
 * 课程中心状态（Phase 5 引入，V1.1.3 升级为「工作管理 · 课程表」）：课表与换课记录的读写唯一入口。
 * 数据源：`teacherdesk:timetable`（课程）+ `teacherdesk:timetable:exchanges`（换课记录）。
 * 「今天」由共享时钟 `useNow()` 解析，跨零点自动切换（单一定时器）。
 */
export const useTimetableStore = defineStore('timetable', () => {
  const lessons = ref<Lesson[]>(loadLessons())
  const exchanges = ref<CourseExchange[]>(loadExchanges())
  const now = useNow()

  // 写盘 + 跨标签页同步（Phase 9A）：两个键各自注册一次
  syncPersisted(STORAGE_KEY, lessons, reviveLessons)
  syncPersisted(EXCHANGE_KEY, exchanges, reviveExchanges)

  /** 今天是星期几（按共享时钟解析） */
  const todayWeekday = computed(() => weekdayOf(now.value))

  /** 今天的中文星期标签（如「星期四」），供卡片徽标展示 */
  const todayLabel = computed(() => WEEKDAY_LABELS[todayWeekday.value])

  /** 某天的课程（时段升序）；周末通常为空数组 → 工作台今日课程卡片显示空态 */
  function lessonsOf(weekday: Weekday): Lesson[] {
    return sortLessons(lessons.value.filter((lesson) => lesson.weekday === weekday))
  }

  /** 今日课程（工作台直接读它） */
  const todayLessons = computed(() => lessonsOf(todayWeekday.value))

  /**
   * 本周课时数。本地课表是「按周循环」的固定课表，全部条目即一周的课，
   * 因此直接取条数；接入真实学期周次后此处改为按周筛选（§9.7）。
   * 晚自习三节各算一节（需求：统计仍按 3 节计算）。
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

  /** 某位置的课程（周视图格子的唯一取值入口） */
  function lessonAt(weekday: Weekday, periodId: CoursePeriodId): Lesson | undefined {
    return lessons.value.find(
      (lesson) => lesson.weekday === weekday && lesson.periodId === periodId,
    )
  }

  /**
   * 某位置上的「调课」标记：该位置**当前没有课**，但有一次换课从这里搬走了课程
   * （原时间显示换课标记，而不是凭空消失）。
   */
  function exchangeFromAt(weekday: Weekday, periodId: CoursePeriodId): CourseExchange | undefined {
    if (lessonAt(weekday, periodId)) return undefined
    return exchanges.value.find(
      (exchange) =>
        exchange.from.weekday === weekday && exchange.from.periodId === periodId && !exchange.group,
    )
  }

  /** 该课程是由哪次换课调过来的（详情页显示「调整自 周一 第5节」） */
  function exchangeOfLesson(lesson: Lesson): CourseExchange | undefined {
    if (!lesson.exchangeId) return undefined
    return exchanges.value.find((exchange) => exchange.id === lesson.exchangeId)
  }

  /** 同一晚自习组的其他节（不含自己，时段升序） */
  function eveningSiblingsOf(lesson: Lesson): Lesson[] {
    return sameEveningGroupSiblings(lessons.value, lesson)
  }

  /** 该时间是否已有课（同一教师同一时段只能在一个班）；编辑自身时传 excludeId 排除 */
  function isSlotTaken(weekday: Weekday, periodId: CoursePeriodId, excludeId?: string): boolean {
    return findSlotConflict(lessons.value, weekday, periodId, excludeId) !== undefined
  }

  /** 返回占用该时间的课程（供表单提示「与 XXX 冲突」），无冲突返回 undefined */
  function slotConflict(
    weekday: Weekday,
    periodId: CoursePeriodId,
    excludeId?: string,
  ): Lesson | undefined {
    return findSlotConflict(lessons.value, weekday, periodId, excludeId)
  }

  /** 新增课程；内容不合法或该时间已有课时拒绝写入并返回 undefined */
  function addLesson(input: LessonInput): Lesson | undefined {
    if (!isLessonInputValid(input)) return undefined
    if (isSlotTaken(input.weekday, input.periodId)) return undefined
    const lesson: Lesson = { ...input, id: createId() }
    lessons.value = [...lessons.value, lesson]
    return lesson
  }

  /**
   * 更新课程；id 不存在、内容不合法或与他课时间冲突时返回 undefined（可保留自身时段）。
   * **换课不走这里**：换课要留下 from → to 的记录与「原时间」标记，见 `exchangeLesson`。
   */
  function updateLesson(id: string, patch: Partial<LessonInput>): Lesson | undefined {
    const index = lessons.value.findIndex((item) => item.id === id)
    if (index === -1) return undefined
    const next: Lesson = { ...lessons.value[index]!, ...patch, id }
    // 班级名改了却没带 classId 时重新派生，避免两者各说各话
    if (patch.className !== undefined && patch.classId === undefined) {
      next.classId = classIdOf(next.className)
    }
    if (!isLessonInputValid(next)) return undefined
    if (isSlotTaken(next.weekday, next.periodId, id)) return undefined
    lessons.value = [...lessons.value.slice(0, index), next, ...lessons.value.slice(index + 1)]
    return next
  }

  /**
   * 删除课程；目标不存在返回 false。
   * 该课若由换课调过来（有 exchangeId），同时删掉那条换课记录——否则原时间会一直挂着
   * 「已调走」的标记而目标位置已经空了，教师会以为课还在。
   */
  function removeLesson(id: string): boolean {
    const index = lessons.value.findIndex((item) => item.id === id)
    if (index === -1) return false
    const target = lessons.value[index]!
    lessons.value = [...lessons.value.slice(0, index), ...lessons.value.slice(index + 1)]
    if (target.exchangeId) {
      exchanges.value = exchanges.value.filter((exchange) => exchange.id !== target.exchangeId)
    }
    return true
  }

  /* ========== V1.1.3：批量导入（一次性写入） ========== */

  /**
   * 批量导入课程（**Excel 导入的唯一落库入口**）：
   * 语义是**逐条应用**——导入涉及的「星期 + 时段」被替换成表里的安排，未涉及的时段保持原样
   * （与座位导入同一纪律：不整表覆盖，避免一份不完整的表把整周课清空）。
   *
   * 兜底校验：任一条不合法、或批内出现重复时段 → **整批拒绝**，一个字节都不改。
   * 整批只赋值一次 `lessons` → 一次写盘 + 一次广播。
   */
  function applyCourseImport(inputs: readonly LessonInput[]): CourseImportOutcome {
    if (inputs.length === 0) return { ok: false, reason: '没有可写入的课程' }
    const seen = new Set<string>()
    for (const input of inputs) {
      if (!isLessonInputValid(input)) {
        return { ok: false, reason: `课程数据不合法：${input.subject || '（缺科目）'}` }
      }
      const key = `${input.weekday}-${input.periodId}`
      if (seen.has(key)) return { ok: false, reason: `导入表内出现重复时段（${key}）` }
      seen.add(key)
    }

    const kept = lessons.value.filter((lesson) => !seen.has(`${lesson.weekday}-${lesson.periodId}`))
    const replaced = lessons.value.length - kept.length
    const created: Lesson[] = inputs.map((input) => ({ ...input, id: createId() }))
    lessons.value = [...kept, ...created]
    return { ok: true, added: created.length, replaced }
  }

  /* ========== V1.1.3：换课 ========== */

  /**
   * 换课 / 调课：把某节课从原时段搬到目标时段（可同时改班级 / 科目）。
   *
   * 与「编辑」的区别在于**留下痕迹**：原时间由换课记录渲染「调课」标记、目标位置的课程
   * 标为 `adjusted` 并记住是哪次调整（`exchangeId`），记录里还存着原课程快照（可撤销）。
   *
   * `withEveningGroup = true` 时把同组的三节晚自习一起搬（**只能搬到「晚自习1」**，
   * 因为三节必须落在连续的三个晚自习时段上）。
   */
  function exchangeLesson(params: {
    lessonId: string
    to: { weekday: Weekday; periodId: CoursePeriodId; className?: string; subject?: string }
    withEveningGroup?: boolean
  }): ExchangeOutcome {
    const lesson = lessons.value.find((item) => item.id === params.lessonId)
    if (!lesson) return { ok: false, reason: '课程不存在，请刷新后重试' }

    const targetWeekday = params.to.weekday
    const targetClassName = (params.to.className ?? lesson.className).trim()
    const targetSubject = (params.to.subject ?? lesson.subject).trim()
    if (!targetClassName || !targetSubject) {
      return { ok: false, reason: '班级与科目都不能为空' }
    }

    const siblings = params.withEveningGroup ? sameEveningGroupSiblings(lessons.value, lesson) : []
    const moving = [lesson, ...siblings]
    if (params.withEveningGroup) {
      if (moving.length !== EVENING_PERIOD_IDS.length) {
        return { ok: false, reason: '这节不属于完整的三节晚自习组，只能单节调整' }
      }
      if (params.to.periodId !== EVENING_PERIOD_IDS[0]) {
        return { ok: false, reason: '整组晚自习只能调到「晚自习1」（三节需连续排列）' }
      }
    }

    const sorted = sortLessons(moving)
    const movingIds = new Set(moving.map((item) => item.id))
    const targets: Array<{ weekday: Weekday; periodId: CoursePeriodId }> = sorted.map(
      (_, index) => ({
        weekday: targetWeekday,
        periodId: params.withEveningGroup
          ? (EVENING_PERIOD_IDS[index] as CoursePeriodId)
          : params.to.periodId,
      }),
    )

    // 目标位置必须空着（排除正在搬走的这几节）
    for (const target of targets) {
      const occupied = findSlotConflict(lessons.value, target.weekday, target.periodId)
      if (occupied && !movingIds.has(occupied.id)) {
        return {
          ok: false,
          reason: `目标时间已有课程：${occupied.subject}（${occupied.className}）`,
        }
      }
    }

    const nowIso = new Date().toISOString()
    const createdExchanges: CourseExchange[] = []
    const movedLessons: Lesson[] = []
    sorted.forEach((item, index) => {
      const target = targets[index]!
      const exchange: CourseExchange = {
        id: createId(),
        from: slotOf(item),
        to: {
          weekday: target.weekday,
          periodId: target.periodId,
          className: targetClassName,
          subject: targetSubject,
        },
        fromLesson: snapshotOf(item),
        group: Boolean(params.withEveningGroup),
        createdAt: nowIso,
      }
      createdExchanges.push(exchange)
      movedLessons.push({
        id: createId(),
        weekday: target.weekday,
        periodId: target.periodId,
        subject: targetSubject,
        classId: classIdOf(targetClassName),
        className: targetClassName,
        teacher: item.teacher,
        type: 'adjusted',
        originalTeacher: item.originalTeacher,
        exchangeId: exchange.id,
        courseGroupId: item.courseGroupId,
      })
    })

    const kept = lessons.value.filter((item) => !movingIds.has(item.id))
    lessons.value = [...kept, ...movedLessons]
    exchanges.value = [...exchanges.value, ...createdExchanges]
    return { ok: true, exchanges: createdExchanges }
  }

  /**
   * 撤销换课：删掉目标位置的课程、把原课程按快照放回原时段、删除换课记录。
   * 整组换课（`group: true`）一次撤销**整批**（同一时间戳 + 同一晚自习组）。
   * 原时间在这期间被别的课占用时拒绝撤销（不覆盖后来的安排）。
   */
  function undoExchange(exchangeId: string): UndoExchangeOutcome {
    const target = exchanges.value.find((exchange) => exchange.id === exchangeId)
    if (!target) return { ok: false, reason: '换课记录不存在' }
    const batch = target.group
      ? exchanges.value.filter(
          (exchange) =>
            exchange.group &&
            exchange.createdAt === target.createdAt &&
            exchange.fromLesson.courseGroupId === target.fromLesson.courseGroupId,
        )
      : [target]

    const affectedLessonIds = new Set(
      lessons.value
        .filter((lesson) => batch.some((exchange) => exchange.id === lesson.exchangeId))
        .map((lesson) => lesson.id),
    )

    for (const exchange of batch) {
      const occupied = lessons.value.find(
        (lesson) =>
          lesson.weekday === exchange.from.weekday &&
          lesson.periodId === exchange.from.periodId &&
          !affectedLessonIds.has(lesson.id),
      )
      if (occupied) {
        return {
          ok: false,
          reason: `原时间（${periodLabelOf(exchange.from.periodId)}）已被「${occupied.subject}」占用，无法撤销`,
        }
      }
    }

    const batchIds = new Set(batch.map((exchange) => exchange.id))
    const restored: Lesson[] = batch.map((exchange) => ({
      id: createId(),
      weekday: exchange.from.weekday,
      periodId: exchange.from.periodId,
      ...exchange.fromLesson,
    }))
    lessons.value = [
      ...lessons.value.filter((lesson) => !affectedLessonIds.has(lesson.id)),
      ...restored,
    ]
    exchanges.value = exchanges.value.filter((exchange) => !batchIds.has(exchange.id))
    return { ok: true, restored: restored.length }
  }

  return {
    lessons,
    exchanges,
    todayWeekday,
    todayLabel,
    todayLessons,
    weekLessonCount,
    weekendWeekdays,
    classNames,
    lessonsOf,
    lessonAt,
    exchangeFromAt,
    exchangeOfLesson,
    eveningSiblingsOf,
    isSlotTaken,
    slotConflict,
    addLesson,
    updateLesson,
    removeLesson,
    applyCourseImport,
    exchangeLesson,
    undoExchange,
  }
})
