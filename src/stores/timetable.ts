import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { useNow } from '@/composables/useToday'
import { scheduleRepository } from '@/repositories/schedule/scheduleRepository'
import { useSemesterStore } from '@/stores/semester'
import { formatDateKey } from '@/utils/date'
import {
  formatExchangeConflict,
  isWeeklyExchange,
  normalizeExchangeWeeks,
  resolveWeekLessons,
  slotTextOf,
} from '@/utils/exchange'
import { createId } from '@/utils/id'
import {
  WEEKDAY_LABELS,
  classIdOf,
  findSlotConflict,
  isValidPeriodId,
  isValidLessonType,
  periodLabelOf,
  sameEveningGroupSiblings,
  sortLessons,
  weekdayOf,
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
import type { WeekResolution } from '@/utils/exchange'

/** 换课记录单独一个键：课程表键仍是「课程数组」，旧数据不需要改形状即可继续读 */
/** Phase 4（v0.6.0）的旧键；首次加载自动迁移到 STORAGE_KEY，见 loadLessons */

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

/** 撤销结果（`restored` = 放回基础课表的课程条数；周次级换课不动基础课表，因此是 0） */
export type UndoExchangeOutcome = { ok: true; restored: number } | { ok: false; reason: string }

/** 课程导入落库结果 */
export type CourseImportOutcome =
  { ok: true; added: number; replaced: number } | { ok: false; reason: string }

/**
 * 课程中心状态（Phase 5 引入，V1.1.3 升级为「工作管理 · 课程表」）：课表与换课记录的读写唯一入口。
 * 数据访问经 `scheduleRepository`（Phase Cloud-1 起，Repository First）：
 * 复活 / 旧键迁移 / 播种口径都在仓储里。「今天」由共享时钟 `useNow()` 解析，跨零点自动切换（单一定时器）。
 */
export const useTimetableStore = defineStore('timetable', () => {
  const lessons = ref<Lesson[]>(scheduleRepository.loadLessons())
  const exchanges = ref<CourseExchange[]>(scheduleRepository.loadExchanges())
  const now = useNow()
  /** 学期设置（v3.7.5）：教学周次的唯一来源——换课选周次、周视图取周次都读它 */
  const semester = useSemesterStore()

  // 写盘 + 跨标签页同步（Phase 9A）：两个键各自注册一次
  scheduleRepository.lessons.bind(lessons)
  scheduleRepository.exchanges.bind(exchanges)

  /** 今天是星期几（按共享时钟解析） */
  const todayWeekday = computed(() => weekdayOf(now.value))

  /** 今天的中文星期标签（如「星期四」），供卡片徽标展示 */
  const todayLabel = computed(() => WEEKDAY_LABELS[todayWeekday.value])

  /**
   * 今天是第几教学周（v3.7.5，由学期设置算出来）。
   * 今天不在学期范围内（学期还没配 / 已经放假）时是 `undefined`——
   * 此时按基础课表看，**不硬算一个「最近的周次」**（那会让换课在放假期间突然生效）。
   */
  const currentWeek = computed(() => semester.weekOf(formatDateKey(now.value)))

  /**
   * 正在查看的教学周（v3.7.6）。
   *
   * 周次选择从课程表页移进「设置 → 教学设置 → 学期设置」后，两个页面必须共用同一份
   * 视图状态——否则在设置页切到第 8 周、回到课程表却还停在第 3 周，等于把选择丢了。
   * `viewWeek === undefined` 表示**跟随今天所在的教学周**；教师手动切到别的周后才固定。
   * 它是纯视图状态，**不落盘**：刷新页面后回到本周，与旧版课程表页的行为一致。
   */
  const viewWeek = ref<number | undefined>(undefined)

  /** 真正用于渲染的周次：手动选择优先，否则跟随今天；始终夹在 1..weekCount 内 */
  const selectedWeek = computed(() => {
    const max = Math.max(1, semester.weekCount)
    const desired = viewWeek.value ?? currentWeek.value ?? 1
    return Math.min(Math.max(1, desired), max)
  })

  /** 正在看的周是不是今天所在的教学周（今天不在学期范围内时为 false） */
  const viewingCurrentWeek = computed(
    () => currentWeek.value !== undefined && currentWeek.value === selectedWeek.value,
  )

  /** 切到某一教学周（越界值夹回范围内；非法数字忽略） */
  function setSelectedWeek(week: number): void {
    if (!Number.isFinite(week)) return
    const max = Math.max(1, semester.weekCount)
    viewWeek.value = Math.min(Math.max(1, Math.trunc(week)), max)
  }

  /** 上一周（-1）/ 下一周（+1），供课程表与设置页的按钮共用 */
  function stepSelectedWeek(delta: number): void {
    setSelectedWeek(selectedWeek.value + delta)
  }

  /** 回到本周：恢复「跟随今天所在的教学周」，不硬记一个会过期的周次 */
  function goToCurrentWeek(): void {
    if (currentWeek.value === undefined) return
    viewWeek.value = undefined
  }

  // 学期总周数改小时，手动选中的周次也夹回范围内（**不删任何换课记录**，
  // 超范围记录由课程的 weekRangeIssues 如实提示）
  watch(
    () => semester.weekCount,
    (total) => {
      if (viewWeek.value !== undefined && viewWeek.value > total) {
        viewWeek.value = Math.max(1, total)
      }
    },
  )

  /* ========== v3.7.5：按教学周看课表（基础课表 + 该周生效的换课） ========== */

  /**
   * 某一教学周实际怎么上：基础课表 + 该周生效的周次级换课（`utils/exchange.ts` 的叠加层）。
   *
   * `week === undefined`（不在学期范围内）→ 直接给基础课表，不做任何叠加。
   * 这个函数**只读不写**：解析出的课表用于渲染，解析过程绝不落盘、绝不改基础课表。
   */
  function weekView(week: number | undefined): WeekResolution {
    if (week === undefined) {
      return {
        lessons: lessons.value,
        appliedIds: [],
        conflictIds: [],
        conflicts: [],
        danglingIds: [],
      }
    }
    return resolveWeekLessons({ lessons: lessons.value, exchanges: exchanges.value, week })
  }

  /** 某周的冲突提示（人话，含日期 / 星期 / 节次 / 涉及课程），直接 toast 或列在页面上 */
  function conflictMessages(week: number | undefined): string[] {
    if (week === undefined) return []
    return weekView(week).conflicts.map((conflict) =>
      formatExchangeConflict(conflict, semester.weeks),
    )
  }

  /**
   * 需要教师处理的换课记录（v3.7.5）：周次为空 / 含超出当前学期范围的周次。
   * **只报告、不删记录**——学期总周数改小后超范围的周次原样保留（§3「不得静默删除」）。
   */
  const weekRangeIssues = computed(() => {
    const total = semester.weekCount
    return exchanges.value
      .filter(isWeeklyExchange)
      .map((exchange) => {
        const weeks = exchange.weeks ?? []
        return {
          exchange,
          empty: weeks.length === 0,
          outOfRange: weeks.filter((week) => week > total),
        }
      })
      .filter((item) => item.empty || item.outOfRange.length > 0)
  })

  /** 某天的课程（时段升序）；周末通常为空数组 → 工作台今日课程卡片显示空态 */
  function lessonsOf(weekday: Weekday): Lesson[] {
    return sortLessons(lessons.value.filter((lesson) => lesson.weekday === weekday))
  }

  /** 某周某天的课程（周视图 / 日视图用）：`week` 为 undefined 时就是基础课表 */
  function lessonsOfWeek(weekday: Weekday, week?: number): Lesson[] {
    const source = week === undefined ? lessons.value : weekView(week).lessons
    return sortLessons(source.filter((lesson) => lesson.weekday === weekday))
  }

  /**
   * 今日课程（工作台与课程页顶部直接读它）。
   * v3.7.5 起按**今天的教学周**解析：某次换课选中了本周，今天看到的就是换过之后的课；
   * 今天不在学期范围内时看基础课表。
   */
  const todayLessons = computed(() => lessonsOfWeek(todayWeekday.value, currentWeek.value))

  /**
   * 本周课时数。本地课表是「按周循环」的固定课表，全部条目即一周的课，
   * 因此直接取条数（换课只改时间、不改节数，因此基础条数就是每周节数）。
   * 晚自习三节各算一节（需求：统计仍按 3 节计算）。
   */
  const weekLessonCount = computed(() => lessons.value.length)

  /** 已出现过的班级名（升序，供编辑抽屉的下拉候选） */
  const classNames = computed(() =>
    [...new Set(lessons.value.map((lesson) => lesson.className))].sort((a, b) =>
      a.localeCompare(b, 'zh-Hans-CN'),
    ),
  )

  /** 某位置的课程（周视图格子的唯一取值入口）；`week` 传入时按那一周的叠加层取 */
  function lessonAt(weekday: Weekday, periodId: CoursePeriodId, week?: number): Lesson | undefined {
    const source = week === undefined ? lessons.value : weekView(week).lessons
    return source.find((lesson) => lesson.weekday === weekday && lesson.periodId === periodId)
  }

  /**
   * 某位置上的「调课」标记：该位置**当前没有课**，但有一次换课从这里搬走了课程
   * （原时间显示换课标记，而不是凭空消失）。
   */
  function exchangeFromAt(
    weekday: Weekday,
    periodId: CoursePeriodId,
    week?: number,
  ): CourseExchange | undefined {
    if (lessonAt(weekday, periodId, week)) return undefined
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
   * 删除全部课程（v3.3.1：教学设置 → 课程 → 删除所有课程）。返回删掉的课程条数。
   *
   * **换课记录一并清空**：只清课程会让原时间一直挂着「已调走」的标记，
   * 教师会以为课还在（与 `removeLesson` 对单节课的口径一致）。
   * **不动课程时间配置**：作息存在 appSettings（`teaching.periodTimes`），
   * 与课表数据是两份东西——需求明确要求清空课程后时间设置原样保留。
   *
   * 课表与换课记录各只赋值一次 → 各一次写盘 + 一次广播，不产生中间态。
   */
  function clearLessons(): number {
    const removed = lessons.value.length
    lessons.value = []
    exchanges.value = []
    return removed
  }

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

  /* ========== V1.1.3：换课（v3.7.5 起按教学周次生效，不再改基础课表） ========== */

  /**
   * 换课 / 调课：把某节课在**选中的教学周里**从原时段搬到目标时段（可同时改班级 / 科目）。
   *
   * v3.7.5 起的行为（规格 §5）：
   * - **基础课表一个字节都不动**——换课只写一条带周次的记录，选中的周打开课表时由
   *   `utils/exchange.ts` 的叠加层把课「搬」过去；未选中的周仍按基础课表上；
   * - 冲突**在写入前逐周检查**：目标时段已被占 / 两次换课抢同一个位置，一律拒绝写入，
   *   并把「哪一周、哪一天、哪一节、涉及什么」讲清楚（不静默覆盖）；
   * - 周次列表来自学期设置，选中的周次必须在当前学期范围内。
   *
   * `withEveningGroup = true` 时把同组的三节晚自习一起搬（**只能搬到「晚自习1」**，
   * 因为三节必须落在连续的三个晚自习时段上）。
   */
  function exchangeLesson(params: {
    lessonId: string
    to: { weekday: Weekday; periodId: CoursePeriodId; className?: string; subject?: string }
    /** 生效的教学周次（1 起，至少一个）；来自学期设置的周次表 */
    weeks: number[]
    withEveningGroup?: boolean
  }): ExchangeOutcome {
    const lesson = lessons.value.find((item) => item.id === params.lessonId)
    if (!lesson) return { ok: false, reason: '课程不存在，请刷新后重试' }

    const weeks = normalizeExchangeWeeks(params.weeks) ?? []
    if (weeks.length === 0) return { ok: false, reason: '请至少选择一个生效周次' }
    const totalWeeks = semester.weekCount
    const overflow = weeks.filter((week) => week > totalWeeks)
    if (overflow.length > 0) {
      return {
        ok: false,
        reason: `第 ${overflow.join('、')} 周超出了本学期 ${totalWeeks} 周的范围`,
      }
    }

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
    const targets: Array<{ weekday: Weekday; periodId: CoursePeriodId }> = sorted.map(
      (_, index) => ({
        weekday: targetWeekday,
        periodId: params.withEveningGroup
          ? (EVENING_PERIOD_IDS[index] as CoursePeriodId)
          : params.to.periodId,
      }),
    )

    // 同一次操作产生的多条记录共用 createdAt，`group` 标记它们是一批（撤销时整批撤）
    const nowIso = new Date().toISOString()
    const created = sorted.map((item, index): CourseExchange => {
      const target = targets[index]!
      return {
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
        weeks: [...weeks],
      }
    })

    // 逐周试算：把候选记录放进课表里解析一遍，任何一周出现冲突就整笔拒绝。
    // 这样「写入后教师才发现某周撞了」不会发生——冲突必须在下笔之前说清楚。
    const candidateIds = new Set(created.map((exchange) => exchange.id))
    const trial = [...exchanges.value, ...created]
    const problems: string[] = []
    for (const week of weeks) {
      const resolution = resolveWeekLessons({ lessons: lessons.value, exchanges: trial, week })
      for (const conflict of resolution.conflicts) {
        if (conflict.exchangeIds.some((id) => candidateIds.has(id))) {
          problems.push(formatExchangeConflict(conflict, semester.weeks))
        }
      }
      for (const id of resolution.danglingIds) {
        if (candidateIds.has(id)) {
          const exchange = created.find((item) => item.id === id)!
          problems.push(
            `第 ${week} 周 ${slotTextOf(exchange.from.weekday, exchange.from.periodId)}：原时段这一周没有课程`,
          )
        }
      }
    }
    if (problems.length > 0) {
      const unique = [...new Set(problems)]
      return {
        ok: false,
        reason:
          unique.length === 1
            ? unique[0]!
            : `有 ${unique.length} 处冲突，本条没有写入：${unique.slice(0, 3).join('；')}${
                unique.length > 3 ? ' 等' : ''
              }`,
      }
    }

    // 只写换课记录：**基础课表一行都不改**（这就是 v3.7.5 与旧换课的根本区别）
    exchanges.value = [...exchanges.value, ...created]
    return { ok: true, exchanges: created }
  }

  /**
   * 撤销换课。
   *
   * - **周次级换课（v3.7.5 新记录）**：只删记录——基础课表本来就没动过，
   *   撤销后那些周自动回到基础课表（`restored: 0`）；
   * - **旧记录（没有 `weeks`）**：按老口径复原——删掉目标位置的课程、把原课程按快照
   *   放回原时段、删除记录。原时间在这期间被别的课占用时拒绝撤销（不覆盖后来的安排）。
   *
   * 整组换课（`group: true`）一次撤销**整批**（同一时间戳 + 同一晚自习组）。
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

    const batchIds = new Set(batch.map((exchange) => exchange.id))

    // 周次级换课：删记录即可，基础课表与其它记录都不受影响
    if (batch.every(isWeeklyExchange)) {
      exchanges.value = exchanges.value.filter((exchange) => !batchIds.has(exchange.id))
      return { ok: true, restored: 0 }
    }

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

  /**
   * 删除一条换课记录（周次级专用入口，页面上「这条换课不要了」）。
   * **只删这一条记录，不碰基础课表、不碰别的记录**；传入旧记录 id 时返回 false
   * （旧记录请走 `undoExchange`，它还要把搬走的课放回去）。
   */
  function removeExchange(exchangeId: string): boolean {
    const target = exchanges.value.find((exchange) => exchange.id === exchangeId)
    if (!target || !isWeeklyExchange(target)) return false
    exchanges.value = exchanges.value.filter((exchange) => exchange.id !== exchangeId)
    return true
  }

  /** 改一条周次级换课的生效周次（改完同样逐周查冲突，有冲突就整笔拒绝、原记录不变） */
  function updateExchangeWeeks(exchangeId: string, weeks: number[]): ExchangeOutcome {
    const index = exchanges.value.findIndex((exchange) => exchange.id === exchangeId)
    if (index === -1) return { ok: false, reason: '换课记录不存在' }
    const current = exchanges.value[index]!
    if (!isWeeklyExchange(current)) {
      return { ok: false, reason: '旧版换课记录不支持改周次（请撤销后重新换课）' }
    }
    const next = normalizeExchangeWeeks(weeks) ?? []
    if (next.length === 0) return { ok: false, reason: '请至少选择一个生效周次' }
    const overflow = next.filter((week) => week > semester.weekCount)
    if (overflow.length > 0) {
      return {
        ok: false,
        reason: `第 ${overflow.join('、')} 周超出了本学期 ${semester.weekCount} 周的范围`,
      }
    }

    const updated: CourseExchange = { ...current, weeks: next }
    const trial = [...exchanges.value.slice(0, index), updated, ...exchanges.value.slice(index + 1)]
    const problems: string[] = []
    for (const week of next) {
      const resolution = resolveWeekLessons({ lessons: lessons.value, exchanges: trial, week })
      for (const conflict of resolution.conflicts) {
        if (conflict.exchangeIds.includes(exchangeId)) {
          problems.push(formatExchangeConflict(conflict, semester.weeks))
        }
      }
      if (resolution.danglingIds.includes(exchangeId)) {
        problems.push(
          `第 ${week} 周 ${slotTextOf(current.from.weekday, current.from.periodId)}：原时段这一周没有课程`,
        )
      }
    }
    if (problems.length > 0) {
      const unique = [...new Set(problems)]
      return {
        ok: false,
        reason:
          unique.length === 1
            ? unique[0]!
            : `有 ${unique.length} 处冲突，周次没有改动：${unique.slice(0, 3).join('；')}${
                unique.length > 3 ? ' 等' : ''
              }`,
      }
    }

    exchanges.value = trial
    return { ok: true, exchanges: [updated] }
  }

  return {
    lessons,
    exchanges,
    todayWeekday,
    todayLabel,
    todayLessons,
    currentWeek,
    selectedWeek,
    viewingCurrentWeek,
    setSelectedWeek,
    stepSelectedWeek,
    goToCurrentWeek,
    weekLessonCount,
    classNames,
    weekView,
    conflictMessages,
    weekRangeIssues,
    lessonsOf,
    lessonsOfWeek,
    lessonAt,
    exchangeFromAt,
    exchangeOfLesson,
    eveningSiblingsOf,
    isSlotTaken,
    slotConflict,
    addLesson,
    updateLesson,
    removeLesson,
    clearLessons,
    applyCourseImport,
    exchangeLesson,
    undoExchange,
    removeExchange,
    updateExchangeWeeks,
  }
})
