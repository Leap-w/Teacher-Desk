import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { Pinia } from 'pinia'

import { violationRepository } from '@/repositories'
import { useStudentStore } from '@/stores/student'
import { createId } from '@/utils/id'
import { formatStudentShortName } from '@/utils/student'
import {
  cleanViolationDraft,
  draftOfViolation,
  isViolationEvent,
  refreshViolationStoredRecords,
  reviveViolationRecords,
  sortViolationEvents,
} from '@/utils/violation'
import {
  buildStudentViolationStats,
  buildViolationBehaviorCounts,
  buildViolationCountByStudent,
  buildViolationOverview,
  buildViolationRanking,
  pickFrequentViolationStudents,
  sortBySeverityThenDate,
} from '@/utils/violationStats'
import type { Student } from '@/types'
import type {
  ViolationBatchDraft,
  ViolationDraft,
  ViolationEvent,
  ViolationQuarantinedRecord,
  ViolationSeverity,
  ViolationStoredRecord,
} from '@/types/violation'

/**
 * 违纪管理状态（v3.8.0 · Phase 1A；v3.8.0 修正：未知严重程度隔离）。
 *
 * ## 数据流（与其余模块一致，一行接入全部能力）
 *
 * ```
 * store.records（ref，混合数组：合法事件 + 隔离的原始记录）   ← 单一数据源
 *   → violationRepository.bind()（写盘幂等 + 跨标签页广播 + 云端同步注册）
 *     → services/sync.syncPersisted → SyncEngine → CloudBase 文档 `teacherdesk:violations`
 * store.events（computed，只筛出合法事件）                    ← UI / 统计 / 编辑只用它
 * ```
 *
 * **为什么数据源是混合数组而不是「只有合法事件」**（v3.8.0 修正的核心）：
 * 写盘是把这份数组整体序列化回存储。如果读盘时把「严重程度未知（更高版本新增）」的记录
 * 丢掉，那么教师**任何一次正常编辑**都会把它从盘上删掉，再顺着跨标签页广播 / 云同步 /
 * 备份传播出去——这是比「等级算错」更严重的数据丢失。所以这类记录**原样留在数据源里**，
 * 只从业务视图（`events`）里排除。
 *
 * 因此本文件**不出现 localStorage / 同步 / 广播字样**，页面也不许绕开它直接写数据
 * （Repository First + §11.3「组件不得直接写 ref 数组」）。
 *
 * ## 四条口径（需求 §十 + 本次修正）
 *
 * 1. **一次批量操作只写一次盘**：`addViolationsForStudents` 先算好 N 条事件、
 *    再**一次整体替换数组**——循环调 `addViolation` 会变成 N 次写盘 + N 次广播。
 * 2. **姓名快照随档案刷新**：学生改名 / 补学号后，这里把每条事件的 `studentName` 刷新；
 *    学生**软删除不清历史**（软删记录仍在 `students` 数组里，快照冻结在删除那一刻的姓名）。
 * 3. **统计全部实时派生**：没有累计次数字段，`overview` / `ranking` / `behaviorCounts`
 *    都是 computed——数据一变界面就跟着变，永远不可能对不上。
 * 4. **隔离记录只保数据、不参与业务**：未知严重程度记录不在 `events` 里，
 *    因此不可能被统计、编辑、删除或重新写入等级；但每次写盘都原样带出。
 *    只通过 `quarantinedCount` / `quarantinedRecords` 暴露给诊断（本阶段无 UI）。
 *
 * ## 写入失败一律返回 `undefined` / `[]` 并告警
 *
 * 与 `leaveStore.addLeave` 同口径：表单已做提示，这里防的是**其他写入入口**（导入、
 * 跨端采纳、将来的批量工具）绕过校验。`cleanViolationDraft` 是唯一校验实现。
 */
export const useViolationStore = defineStore('violation', () => {
  /** 学生 store 同步实例化：供姓名快照刷新、新增时取学生用 */
  const studentStore = useStudentStore()

  /**
   * **单一数据源**（混合数组，会整体写盘）：合法事件 + 隔离的原始记录（保持盘上顺序）。
   * 所有写操作都基于它构造新数组；**任何写操作都不得过滤掉隔离记录**。
   */
  const records = ref<ViolationStoredRecord[]>(
    refreshViolationStoredRecords(violationRepository.load(), studentStore.students),
  )

  // 写盘 + 跨标签页广播 + 云端同步（Phase 9A / 9B 的既有机制，一行接入）。
  // 复活规则带上姓名快照刷新，与首屏加载那条路径**给出一致的结果**：
  // 只跑默认 revive 的话，别的入口改了学生姓名后再广播违纪记录，本页会把旧快照吃进内存，
  // 而列表显示的正是这份快照（§11.1 同一份规则，两条路径不许分叉）。
  // `reviveViolationRecords` 返回混合数组，因此广播/云端采纳都不会丢掉隔离记录。
  violationRepository.bind(records, (raw) =>
    refreshViolationStoredRecords(reviveViolationRecords(raw), studentStore.students),
  )

  // 学生改名 / 补学号后同步快照（只监听姓名与学号；换座位之类的改动不触发）。
  // 混合数组版只改合法事件的姓名，隔离记录原样不动。
  watch(
    () => studentStore.students.map((item) => `${item.id}|${item.name}|${item.studentNo}`),
    () => {
      records.value = refreshViolationStoredRecords(records.value, studentStore.students)
    },
  )

  /* ==================== 业务视图（合法事件） ==================== */

  /**
   * 本版本能安全使用的合法事件：UI / 统计 / 编辑 / 删除的**唯一数据源**。
   * 隔离记录不在这里——它们不能进入正常写入流程（尤其是不能带着被改写过的等级）。
   */
  const events = computed(() => records.value.filter(isViolationEvent))

  /**
   * 被隔离的原始记录（当前只有「未知严重程度」一种来源）。
   * 本阶段**不做 UI**；暴露给诊断与后续版本（例如新版本读到后自然恢复正常）。
   */
  const quarantinedRecords = computed<ViolationQuarantinedRecord[]>(() =>
    records.value.filter(
      (record): record is ViolationQuarantinedRecord => !isViolationEvent(record),
    ),
  )
  const quarantinedCount = computed(() => quarantinedRecords.value.length)

  /** 在读学生（概览人数与排行的分母） */
  const activeStudents = computed(() => studentStore.activeStudents)
  const activeStudentIds = computed(() => new Set(activeStudents.value.map((item) => item.id)))

  /** 概览：累计次数 / 涉及在读学生数 / 三级数量 */
  const overview = computed(() => buildViolationOverview(events.value, activeStudentIds.value))

  /** 学生违纪次数排行（次数降序 → 姓名升序 → id 兜底；已软删学生不进排行） */
  const ranking = computed(() =>
    buildViolationRanking(events.value, activeStudents.value, studentStore.nameCounts),
  )

  /** 经常违纪学生（≥3 次、前 10 名） */
  const frequentStudents = computed(() => pickFrequentViolationStudents(ranking.value))

  /** 严重违纪事件（独立展示区；从重到轻、同级按日期倒序） */
  const severeEvents = computed(() =>
    sortBySeverityThenDate(events.value.filter((event) => event.severity === 'severe')),
  )

  /** 按具体事件统计（v3.8.1 取消分类后代替原来的分类统计） */
  const behaviorCounts = computed(() => buildViolationBehaviorCounts(events.value))

  /** 学生 id → 累计违纪次数（选择器显示次数用） */
  const countByStudent = computed(() => buildViolationCountByStudent(events.value))

  /* ==================== 查询 ==================== */

  /** 单条事件（找不到 → undefined） */
  function findEvent(id: string): ViolationEvent | undefined {
    return events.value.find((event) => event.id === id)
  }

  /** 某学生的全部违纪事件（**按时间倒序**；已软删除学生同样可查，历史不丢） */
  function eventsOfStudent(studentId: string): ViolationEvent[] {
    return sortViolationEvents(events.value.filter((event) => event.studentId === studentId))
  }

  /** 某学生的完整统计（个人档案用；已软删除学生同样可算） */
  function statsOfStudent(studentId: string) {
    return buildStudentViolationStats(events.value, studentId)
  }

  /** 列表查询条件（页面筛选器与个人档案共用一套口径） */
  interface ViolationQueryOptions {
    /** 关键词：匹配学生姓名快照或具体行为文本（大小写不敏感） */
    keyword?: string
    /** 只看某名学生 */
    studentId?: string
    /** 严重程度筛选（空数组 = 不筛） */
    severities?: readonly ViolationSeverity[]
    /** 起始日期（含；`YYYY-MM-DD`） */
    from?: string
    /** 截止日期（含；`YYYY-MM-DD`） */
    to?: string
  }

  /**
   * 列表查询：筛选后**按发生日期倒序**返回（返回新数组，不动 store 里的顺序）。
   * 日期区间两端都含当天（教师说「11 月 1 日到 11 月 7 日」时这两天都要在结果里）。
   */
  function listEvents(options: ViolationQueryOptions = {}): ViolationEvent[] {
    const keyword = (options.keyword ?? '').trim().toLowerCase()
    const severities = options.severities?.length ? new Set(options.severities) : null
    return sortViolationEvents(
      events.value.filter((event) => {
        if (options.studentId && event.studentId !== options.studentId) return false
        if (severities && !severities.has(event.severity)) return false
        if (options.from && event.date < options.from) return false
        if (options.to && event.date > options.to) return false
        if (!keyword) return true
        return (
          event.studentName.toLowerCase().includes(keyword) ||
          event.behaviorLabel.toLowerCase().includes(keyword)
        )
      }),
    )
  }

  /* ==================== 写入 ==================== */

  /** 在读学生（新增只允许针对在读学生；历史记录不受此限制） */
  function findActiveStudent(id: string): Student | undefined {
    return activeStudents.value.find((item) => item.id === id)
  }

  /** 任意在档学生（含已软删除：编辑其历史记录时仍按档案刷新姓名快照） */
  function findKnownStudent(id: string): Student | undefined {
    return studentStore.students.find((item) => item.id === id)
  }

  /** 生成一条事件（id / 姓名快照 / 时间戳由 store 维护，草稿里不允许带） */
  function buildEvent(draft: ViolationDraft, student: Student, timestamp: string): ViolationEvent {
    return {
      id: createId(),
      ...draft,
      studentName: formatStudentShortName(student, studentStore.nameCounts),
      createdAt: timestamp,
      updatedAt: timestamp,
    }
  }

  /**
   * 新增单条违纪事件。
   * 输入非法（缺学生 / 日期 / 时间段 / 行为文本、严重程度不在三级内）→ `undefined`；
   * 学生不在在读名册 → `undefined`（不给已退档学生新增违纪）。
   */
  function addViolation(input: unknown): ViolationEvent | undefined {
    const draft = cleanViolationDraft(input)
    if (!draft) {
      console.warn('[violation] 新增请求不合法，已拒绝写入')
      return undefined
    }
    const student = findActiveStudent(draft.studentId)
    if (!student) {
      console.warn('[violation] 新增请求的学生不在在读名册中，已拒绝写入')
      return undefined
    }
    const event = buildEvent(draft, student, new Date().toISOString())
    // 追加到混合数组末尾：隔离记录原样保留（它们不参与任何业务写入）
    records.value = [...records.value, event]
    return event
  }

  /**
   * 批量新增：**一次选择 N 名学生 = N 条独立事件**（各自独立 id）。
   *
   * **只写一次盘、只广播一次**（需求 §十的硬要求）：先把 N 条全算好，再整体替换数组。
   * 因此这里**严禁**内部循环调用 `addViolation` —— 那会变成 N 次写盘 + N 次广播，
   * 一次选 50 个学生就是 50 次整份数组序列化 + 50 条广播。
   *
   * 返回真正创建出来的事件（不在读名册里的学生被跳过并告警，由调用方对比数量给提示）。
   * 空选择 / 草稿不合法 → `[]`，且**不写盘**。
   */
  function addViolationsForStudents(
    studentIds: readonly string[],
    input: ViolationBatchDraft,
  ): ViolationEvent[] {
    const targets: Student[] = []
    const seen = new Set<string>()
    let skipped = 0
    for (const id of studentIds) {
      if (typeof id !== 'string' || !id || seen.has(id)) continue
      seen.add(id)
      const student = findActiveStudent(id)
      if (!student) {
        skipped += 1
        continue
      }
      targets.push(student)
    }
    if (targets.length === 0) {
      if (skipped > 0) console.warn(`[violation] 批量新增：${skipped} 名学生不在在读名册，已跳过`)
      return []
    }
    // 用第一名学生做一次完整校验（学生 id 只是形状检查，其余字段全校共用）
    const probe = cleanViolationDraft({ ...input, studentId: targets[0]!.id })
    if (!probe) {
      console.warn('[violation] 批量新增请求不合法，已拒绝写入')
      return []
    }
    const timestamp = new Date().toISOString()
    // ★ 每条事件必须落到**自己的**学生 id 上：probe 里的 studentId 只是校验用的占位，
    //   直接展开会把全班事件都记到第一名学生头上（这是批量新增最容易写错的一行）
    const created = targets.map((student) =>
      buildEvent({ ...probe, studentId: student.id }, student, timestamp),
    )
    // ★ 一次整体替换 = 一次写盘 + 一次广播；**隔离记录原样带在数组里**
    records.value = [...records.value, ...created]
    if (skipped > 0) console.warn(`[violation] 批量新增：${skipped} 名学生不在在读名册，已跳过`)
    return created
  }

  /**
   * 编辑一条事件：`id` / `createdAt` / 学生 id 之外都可改（含严重程度、家长处理意见）。
   * - 先与当前草稿合并再用**同一份** `cleanViolationDraft` 校验（写路径严格）；
   * - 编辑成已退档学生的记录：仍允许改名快照（按档案刷新），不允许改成不存在的学生；
   * - 清空可选字段（例如删掉家长意见）会真正**删掉该键**，而不是留下空串；
   * - **只认合法事件**：隔离记录（未知严重程度）不在 `events` 里，因此编辑不到它，
   *   也就不可能把它的等级改成任何已知值（这是数据安全的关键一条）。
   * 不合法 / 找不到 → `undefined`（不写盘）。
   */
  function updateViolation(id: string, patch: Partial<ViolationDraft>): ViolationEvent | undefined {
    const index = records.value.findIndex((record) => isViolationEvent(record) && record.id === id)
    if (index === -1) return undefined
    const current = records.value[index]
    if (!current || !isViolationEvent(current)) return undefined

    // `undefined` 的补丁键视为「不修改」；空串则由 clean 折成「删除该可选字段」
    const merged: Record<string, unknown> = { ...draftOfViolation(current) }
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue
      merged[key] = value
    }
    const draft = cleanViolationDraft(merged)
    if (!draft) {
      console.warn('[violation] 编辑请求不合法，已拒绝写入')
      return undefined
    }
    const student = findKnownStudent(draft.studentId)
    if (!student) {
      console.warn('[violation] 编辑请求的学生不在档案中，已拒绝写入')
      return undefined
    }
    const updated: ViolationEvent = {
      id: current.id,
      ...draft,
      studentName: formatStudentShortName(student, studentStore.nameCounts),
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    }
    // 原位替换：隔离记录的相对位置不变，且它们本身一个字节都不动
    records.value = [...records.value.slice(0, index), updated, ...records.value.slice(index + 1)]
    return updated
  }

  /**
   * 删除一条**合法事件**（本地单人数据、无软删/回收站，与请假 / 课程删除同口径）。
   * 隔离记录删不到（它不在 `events` 里）——旧版本无权丢弃更高版本的数据。
   * 不存在 / 是隔离记录 → false。
   */
  function removeViolation(id: string): boolean {
    const index = records.value.findIndex((record) => isViolationEvent(record) && record.id === id)
    if (index === -1) return false
    records.value = [...records.value.slice(0, index), ...records.value.slice(index + 1)]
    return true
  }

  return {
    events,
    quarantinedRecords,
    quarantinedCount,
    overview,
    ranking,
    frequentStudents,
    severeEvents,
    behaviorCounts,
    countByStudent,
    eventsOfStudent,
    statsOfStudent,
    listEvents,
    findEvent,
    addViolation,
    addViolationsForStudents,
    updateViolation,
    removeViolation,
  }
})

/**
 * 启动时预注册违纪事件同步键（v3.8.1 · Phase 4 修复）。
 *
 * 违纪页面是懒加载的：只在页面里实例化 `useViolationStore()`，没打开过违纪页的设备就
 * 不会把 `teacherdesk:violations` 注册进 `syncedKeys()`，云端同步里等于没有违纪记录。
 * 这里在 `main.ts` 的 `startAutoSync()` **之前**只实例化本 Store（= Repository.bind），
 * 与 `startViolationPresetSync()` 成对使用：两个键都必须在首轮对账前完成注册。
 *
 * 不新增同步协议、不改 LWW / Repository 架构；只是把懒加载 Store 的注册时机提前。
 */
export function startViolationSync(pinia?: Pinia): void {
  useViolationStore(pinia)
}
