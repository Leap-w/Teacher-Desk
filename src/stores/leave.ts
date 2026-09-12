import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { appConfig } from '@/config'
import { useNow } from '@/composables/useToday'
import { createSeedLeaves } from '@/services/mock'
import { readList, writeSeedJSON } from '@/services/storage'
import { syncPersisted } from '@/services/sync'
import { useStudentStore } from '@/stores/student'
import { formatDateKey } from '@/utils/date'
import { createId } from '@/utils/id'
import { formatStudentShortName, refreshStudentNames } from '@/utils/student'
import { halfDayKey, isDayPoint } from '@/utils/point'
import {
  KNOWN_LEAVE_TYPES,
  isPeriodOverlapping,
  normalizeLeaveRecord,
  sortLeaveRecords,
} from '@/utils/leave'
import type { Student } from '@/types'
import type { DayPoint } from '@/types/point'
import type { LeaveInput, LeaveRecord, LeaveType } from '@/types/leave'

const STORAGE_KEY = `${appConfig.storageKeyPrefix}:leaves`

/**
 * 把盘上的原始列表规范成内存里的请假记录（**首屏加载与跨标签页同步共用**，§11.1）。
 * 同一 id 只保留首条（重复 id 会让列表的 v-for key 冲突），丢弃条目时告警但保留缓存原文。
 */
function reviveLeaves(raw: unknown[]): LeaveRecord[] {
  const seen = new Set<string>()
  const records = raw
    .map((item) => normalizeLeaveRecord(item))
    .filter((item): item is LeaveRecord => item !== null)
    .filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
  if (records.length < raw.length) {
    console.warn(`[leave] 丢弃 ${raw.length - records.length} 条不合法的请假记录（缓存原文保留）`)
  }
  return records
}

/**
 * 从 localStorage 读取请假记录；首次启动（无缓存）时写入示例数据。
 *
 * 与课表同口径：**缓存损坏（非 JSON / 非数组）时降级为空列表，不重播示例数据**
 * ——记录可编辑后示例数据不再是唯一来源，重播会盖掉教师的真实记录（§3.2）。
 * 非法条目逐条丢弃，并保留缓存原文（不覆盖，便于人工找回）。
 *
 * 播种条件比学生 / 课表严一档：`teacherdesk:leaves` 是 Phase 5 新增的键，
 * **每个存量用户第一次打开都算「首次启动」**，而无条件播种会让从 v0.7.0 升级上来
 * 的教师凭空多出 3 条别人家学生的请假（1 条待处理、1 条已批准）。请假记录引用学生
 * 主键，只在示例学生**都还在读**时（即学生档案同为示例数据）才播种（§11.3）。
 */
function loadLeaves(students: Student[]): LeaveRecord[] {
  const stored = readList(STORAGE_KEY)
  if (stored === null) {
    const seed = createSeedLeaves()
    // 「档案里还在」= **在读**：软删除的学生仍留在 `students` 数组里（同 §9.17 周末管理的修复）
    const inSchoolIds = new Set(students.filter((item) => !item.deletedAt).map((item) => item.id))
    if (!seed.every((item) => inSchoolIds.has(item.studentId))) return []
    // 播种写盘并记下基线（Phase 9C），理由见 services/storage.ts 的 writeSeedJSON
    writeSeedJSON(STORAGE_KEY, seed)
    return seed
  }
  return reviveLeaves(stored)
}

/**
 * 姓名快照维护已抽到公共件（Phase 7B：与周末返家记录共用同一份口径，
 * 见 `utils/student.ts` 的 `refreshStudentNames`）——本模块只做一次类型收窄。
 */
function withStudentNames(records: LeaveRecord[], students: Student[]): LeaveRecord[] {
  return refreshStudentNames(records, students)
}

/**
 * 必填字段与取值范围的兜底校验（表单已提示，此处防其他写入入口绕过）。
 * 与 `normalizeLeaveRecord` 同款 `typeof` 严格判定——上游若传 `undefined` / 非字符串，
 * 这里**拒绝写入**，不让 `input.reason.trim()` 抛异常冒泡到点击回调（§8 审查口径）。
 */
function isLeaveInputValid(input: LeaveInput): boolean {
  if (!input || typeof input !== 'object') return false
  if (typeof input.studentId !== 'string' || !input.studentId) return false
  if (typeof input.type !== 'string' || !KNOWN_LEAVE_TYPES.includes(input.type as LeaveType)) {
    return false
  }
  if (!isDayPoint(input.start) || !isDayPoint(input.end)) return false
  if (halfDayKey(input.end) < halfDayKey(input.start)) return false
  if (typeof input.reason !== 'string' || !input.reason.trim()) return false
  return true
}

/**
 * 请假 / 离校状态（Phase 5）：请假记录的唯一读写入口。
 * 数据源：`teacherdesk:leaves`（Pinia → localStorage，§3.2）。
 *
 * 与 constraint store 的一处关键差异：**学生被删除时记录不清理**——
 * 请假是发生过的事实，随学生删除而消失会让历史统计与「这孩子当时请过假」失去依据
 * （Phase 5 拍板口径；seat 释放座位、constraint 删约束是「引用清理」，语义不同）。
 */
export const useLeaveStore = defineStore('leave', () => {
  /** 学生 store 同步实例化：供姓名快照刷新与新增时取学生用 */
  const studentStore = useStudentStore()
  const now = useNow()

  const leaves = ref<LeaveRecord[]>(
    withStudentNames(loadLeaves(studentStore.students), studentStore.students),
  )

  // 写盘 + 跨标签页同步（Phase 9A）：本页改动写盘后广播键名，别的入口改了则重读并规范化。
  // 归一化里带上姓名快照刷新，与首屏加载那条路径**给出一致的结果**——
  // 只跑 reviveLeaves 的话，别人改了学生姓名后再广播请假记录，本页会把旧快照吃进内存，
  // 而列表中显示的正是这份快照（§11.1 同一份规则，两条路径不许分叉）
  syncPersisted(STORAGE_KEY, leaves, (raw) =>
    withStudentNames(reviveLeaves(raw), studentStore.students),
  )

  /** 在档案中的学生（新增 / 编辑只能选在读学生） */
  function findStudent(id: string): Student | undefined {
    return studentStore.activeStudents.find((item) => item.id === id)
  }

  /**
   * 未返校的记录（已登记离校、还没登记返校），按开始时段倒序。
   * 工作台「请假管理」卡片与请假页「未返校」筛选共用同一口径。
   */
  const outLeaves = computed(() =>
    sortLeaveRecords(
      leaves.value.filter(
        (item) => item.status !== 'rejected' && item.leftSchool && !item.backToSchool,
      ),
    ),
  )

  /**
   * 本月请假人次：开始日期落在本月、且不是「已作废」（旧审批流驳回的历史遗留）的记录数。
   * 「人次」= 记录数，同一学生本月请两次记两人次。
   */
  const monthLeaveCount = computed(() => {
    const monthPrefix = formatDateKey(now.value).slice(0, 7)
    return leaves.value.filter(
      (item) => item.status !== 'rejected' && item.start.date.startsWith(monthPrefix),
    ).length
  })

  // 学生改名 / 补学号后同步快照（只监听姓名与学号，换座位之类的改动不触发）
  watch(
    () => studentStore.students.map((item) => `${item.id}|${item.name}|${item.studentNo}`),
    () => {
      leaves.value = withStudentNames(leaves.value, studentStore.students)
    },
  )

  /**
   * 列表查询：按关键词过滤后排序（关键词匹配姓名快照，
   * 即「姓名」或「学号后四位」都能命中，与列表展示的信息一致）。
   * 状态维度的筛选（今日 / 本周 / 未返校 / 已返校）在页面用 utils/leave 的
   * filterLeaveRecords 完成——那是纯函数，测试可以直接喂数组跑。
   */
  function listRecords(options: { keyword?: string } = {}): LeaveRecord[] {
    const query = (options.keyword ?? '').trim().toLowerCase()
    return sortLeaveRecords(
      leaves.value.filter((item) =>
        query ? item.studentName.toLowerCase().includes(query) : true,
      ),
    )
  }

  /**
   * 该学生在此时段是否已有请假记录（**已驳回的不算**——驳回意味着这次请假不成立）。
   * 只供表单提示，**不拦截**：是否允许同一时段再次请假由教师判断（§11.5 不替班主任做决策）。
   */
  function overlappingLeaves(
    studentId: string,
    start: DayPoint,
    end: DayPoint,
    excludeId?: string,
  ): LeaveRecord[] {
    return leaves.value.filter(
      (item) =>
        item.studentId === studentId &&
        item.id !== excludeId &&
        item.status !== 'rejected' &&
        isPeriodOverlapping(item, { start, end }),
    )
  }

  /**
   * 新增请假：内容不合法或学生不在档案中时拒绝写入并返回 undefined。
   * V1.1.5 起状态恒为 'approved'（记录语义：记录即生效，可直接登记离校 / 返校）——
   * 应用不再替班主任做「批不批」的决定（§11.5）。
   */
  function addLeave(input: LeaveInput): LeaveRecord | undefined {
    if (!isLeaveInputValid(input)) return undefined
    const student = findStudent(input.studentId)
    if (!student) return undefined
    const record: LeaveRecord = {
      id: createId(),
      studentId: student.id,
      studentName: formatStudentShortName(student),
      type: input.type,
      start: { ...input.start },
      end: { ...input.end },
      reason: input.reason.trim(),
      status: 'approved',
      createdAt: new Date().toISOString(),
    }
    leaves.value = [...leaves.value, record]
    return record
  }

  /**
   * 更新请假（记录口径：任何记录都可改——教师改个错字不该被历史状态卡住；
   * 「已作废」的记录改完仍是已作废，要重新生效请删除后重建）。
   * 内容不合法时返回 undefined。
   */
  function updateLeave(id: string, patch: Partial<LeaveInput>): LeaveRecord | undefined {
    const index = leaves.value.findIndex((item) => item.id === id)
    if (index === -1) return undefined
    const current = leaves.value[index]
    if (!current) return undefined
    const next: LeaveRecord = {
      ...current,
      studentId: patch.studentId ?? current.studentId,
      type: patch.type ?? current.type,
      start: patch.start ? { ...patch.start } : current.start,
      end: patch.end ? { ...patch.end } : current.end,
      reason: typeof patch.reason === 'string' ? patch.reason.trim() : current.reason,
    }
    // 换了学生 → 快照跟着换；学生不在档案中则拒绝写入
    if (next.studentId !== current.studentId) {
      const student = findStudent(next.studentId)
      if (!student) return undefined
      next.studentName = formatStudentShortName(student)
    }
    if (!isLeaveInputValid(next)) return undefined
    leaves.value = [...leaves.value.slice(0, index), next, ...leaves.value.slice(index + 1)]
    return next
  }

  /**
   * 登记离校：非「已作废」的记录都可登记。**重复调用即覆盖修改**——日期写错时不必
   * 「删掉记录重建」（那样会把原因、返校时间一并丢掉）。登记的是既成事实，
   * 因此不限制「不早于请假开始」，只保证不晚于已登记的返校时间、时间线不颠倒。
   */
  function registerLeftSchool(id: string, point: DayPoint): LeaveRecord | undefined {
    if (!isDayPoint(point)) return undefined
    const index = leaves.value.findIndex((item) => item.id === id)
    if (index === -1) return undefined
    const current = leaves.value[index]
    if (!current || current.status === 'rejected') return undefined
    if (current.backToSchool && halfDayKey(point) > halfDayKey(current.backToSchool)) {
      return undefined
    }
    const next: LeaveRecord = { ...current, leftSchool: { ...point } }
    leaves.value = [...leaves.value.slice(0, index), next, ...leaves.value.slice(index + 1)]
    return next
  }

  /** 登记返校：需先登记离校，且返校时间不早于离校时间；同样支持覆盖修改 */
  function registerBackToSchool(id: string, point: DayPoint): LeaveRecord | undefined {
    if (!isDayPoint(point)) return undefined
    const index = leaves.value.findIndex((item) => item.id === id)
    if (index === -1) return undefined
    const current = leaves.value[index]
    if (!current || current.status === 'rejected' || !current.leftSchool) return undefined
    if (halfDayKey(point) < halfDayKey(current.leftSchool)) return undefined
    const next: LeaveRecord = { ...current, backToSchool: { ...point } }
    leaves.value = [...leaves.value.slice(0, index), next, ...leaves.value.slice(index + 1)]
    return next
  }

  /** 删除记录（本地单人数据，无软删 / 回收站，与课程删除同口径）；目标不存在返回 false */
  function removeLeave(id: string): boolean {
    const index = leaves.value.findIndex((item) => item.id === id)
    if (index === -1) return false
    leaves.value = [...leaves.value.slice(0, index), ...leaves.value.slice(index + 1)]
    return true
  }

  return {
    leaves,
    outLeaves,
    monthLeaveCount,
    listRecords,
    overlappingLeaves,
    addLeave,
    updateLeave,
    registerLeftSchool,
    registerBackToSchool,
    removeLeave,
  }
})
