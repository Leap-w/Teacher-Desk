import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { studentRepository } from '@/repositories'
import type { StudentImportPlan } from '@/services/studentImport'
import { createId } from '@/utils/id'
import { buildNameCounts } from '@/utils/student'
import { buildBatchPatch } from '@/utils/studentBatch'
import type { StudentBatchChanges } from '@/utils/studentBatch'
import { queryStudents } from '@/utils/studentQuery'
import type { StudentQueryOptions } from '@/utils/studentQuery'
import type { Student, StudentInput } from '@/types'

/**
 * 学生档案状态（读写唯一入口）。
 * 数据访问全部经 `studentRepository`（Phase Cloud-1 起，Repository First）：
 * 本文件不再出现任何 localStorage 字样；复活 / 播种规则在仓储里，Store 只管业务。
 */

/**
 * 列表检索选项。**与纯函数层的 `StudentQueryOptions` 是同一个形状**（Phase 5B）：
 * 检索与排序的规则只有一份实现（`utils/studentQuery.ts`），这里不再抄一遍字段。
 */
export type StudentSearchOptions = StudentQueryOptions

export const useStudentStore = defineStore('student', () => {
  /** 全部学生（含软删除记录） */
  const students = ref<Student[]>(studentRepository.load())

  /** 未删除学生 */
  const activeStudents = computed(() => students.value.filter((item) => !item.deletedAt))

  /**
   * 姓名 → 同名人数（重名消歧的唯一来源，v3.3.1）。
   * 放进 store 而不是让每个页面各算一遍：`formatStudentShortName` 的必填参数就是它，
   * 「谁算重名」因此只有一个答案——**在读学生**。软删除的学生不再参与计数，
   * 否则删掉一个同名学生之后，剩下那个还会一直挂着括号显示尾号。
   */
  const nameCounts = computed(() => buildNameCounts(activeStudents.value))

  // 写盘 + 跨标签页同步（Phase 9A）：本页改动写盘后广播键名，别的入口改了则重读并规范化。
  // 写盘是幂等的（见 services/storage.ts），所以「收到远端更新 → 替换内存 → 触发写盘」
  // 这条链在第二次写盘处自然终止，不会两个入口互相触发
  studentRepository.bind(students)

  /**
   * 关键词搜索 + 筛选 + 排序（仅活跃学生）。
   *
   * **规则全在纯函数 `queryStudents()` 里**（Phase 5B）：这里只负责喂数据源。
   * 这样列表页的「students → filter → sort → render」管道只有一个出口，
   * 而规则本身能脱离浏览器单测（不碰 DOM、不碰 localStorage）。
   * 缺省排序是学号升序、**空学号排最后**（Phase 5A 允许空学号后，它们曾顶在名单最前）。
   */
  function searchStudents(keyword = '', options: StudentSearchOptions = {}): Student[] {
    return queryStudents(activeStudents.value, { ...options, keyword })
  }

  /**
   * 学号占用检查（数据层兜底；表单已做提示，此处防其他写入入口绕过）。
   * **空学号一律不算占用**（Phase 5A）：学号改为选填后，若拿空串互相判重，
   * 第二个「还没填学号」的学生就会被拒绝写入——空串不是一个可用的身份键。
   */
  function isStudentNoTaken(studentNo: string, excludeId?: string): boolean {
    const key = studentNo.trim()
    if (!key) return false
    return students.value.some(
      (item) => !item.deletedAt && item.studentNo === key && item.id !== excludeId,
    )
  }

  /** 新增；学号已被占用时拒绝写入并返回 undefined */
  function addStudent(data: StudentInput): Student | undefined {
    if (isStudentNoTaken(data.studentNo)) return undefined
    const student: Student = { ...data, id: createId() }
    students.value = [...students.value, student]
    return student
  }

  /** 更新；学号被其他学生占用时拒绝更新并返回 undefined（允许保留自身学号） */
  function updateStudent(id: string, patch: Partial<StudentInput>): Student | undefined {
    const index = students.value.findIndex((item) => item.id === id)
    if (index === -1) return undefined
    if (patch.studentNo !== undefined && isStudentNoTaken(patch.studentNo, id)) return undefined
    const updated: Student = { ...students.value[index], ...patch }
    students.value = [
      ...students.value.slice(0, index),
      updated,
      ...students.value.slice(index + 1),
    ]
    return updated
  }

  /**
   * 批量导入落库：把一份预先算好的增改计划一次性写入（§11.3：组件不得直接写 `students.value`）。
   *
   * **刻意一次替换整个数组，而不是循环调用 addStudent/updateStudent**——那样每行都会触发
   * 一次写盘 + 一次跨标签页广播，63 行就是 126 次。导入只该写一次。
   *
   * 计划由 `services/studentImport.ts` 的纯函数算出（按学号分流、字段覆盖口径都在那边，
   * 因此可脱离浏览器单测）；这里只负责「应用」，不做任何判断。
   */
  function applyStudentImport(plan: StudentImportPlan): { added: number; updated: number } {
    const patchById = new Map(plan.updates.map((item) => [item.id, item.patch]))
    const next: Student[] = []
    let updated = 0
    for (const student of students.value) {
      const patch = patchById.get(student.id)
      if (!patch) {
        next.push(student)
        continue
      }
      updated += 1
      // 展开合并：计划里没提到的字段（含 deletedAt、seatNumber）原样保留
      next.push({ ...student, ...patch })
    }
    const adds = plan.adds.map((data) => ({ ...data, id: createId() }) as Student)
    students.value = [...next, ...adds]
    return { added: adds.length, updated }
  }

  /**
   * 批量修改落库（Phase 5B）：把同一份修改一次性应用到选中的学生上。
   *
   * **一次整体替换 = 一次写盘 + 一次广播**，理由与 `applyStudentImport` 完全相同：
   * 循环调 `updateStudent()` 的话，选 30 个人就是 30 次写盘 + 30 次广播。
   * （组件层不得绕过这里直接写 `students.value`，§11.3。）
   *
   * 补丁由纯函数 `buildBatchPatch()` 构造——性别与宿舍是否匹配、标签如何去重、
   * 「没变化」与「不适用」怎么区分，规则都在那边，因此可以脱离浏览器单测。
   * 这里只负责分账：`skipped` 是**不适用**的人数（如所选宿舍与该生性别不符），
   * 「适用但改完没变化」既不算更新也不算跳过。
   */
  function applyStudentBatch(
    ids: readonly string[],
    changes: StudentBatchChanges,
  ): { updated: number; skipped: number } {
    const targets = new Set(ids)
    let updated = 0
    let skipped = 0
    const next: Student[] = []
    for (const student of students.value) {
      // 没被选中 / 已被软删除的：原样带过去，且不参与任何计数
      if (!targets.has(student.id) || student.deletedAt) {
        next.push(student)
        continue
      }
      const patch = buildBatchPatch(student, changes)
      if (!patch) {
        skipped += 1
        next.push(student)
        continue
      }
      if (Object.keys(patch).length === 0) {
        next.push(student)
        continue
      }
      updated += 1
      next.push({ ...student, ...patch })
    }
    // 一个人都没变就不赋值：不赋值 = 不写盘、不广播
    // （`writeJSON` 的幂等只是第二道保险，不该当成主要手段）
    if (updated === 0) return { updated, skipped }
    students.value = next
    return { updated, skipped }
  }

  /**
   * 批量软删除（v3.3.1）：把选中的学生一次性标记 deletedAt。
   *
   * **一次整体替换 = 一次写盘 + 一次广播**，理由与 `applyStudentBatch` 完全相同：
   * 循环调 `removeStudent()` 的话，选 30 个人就是 30 次写盘 + 30 次广播。
   *
   * 与单个删除同口径——只标记 `deletedAt`，不做物理删除，**也不动座位 / 请假 / 值日**：
   * 那些记录各自认学生 id，学生被软删后不再参与显示与统计，行为与逐个删完全一致。
   * 一个人都没删（id 不存在 / 已经删过）时**不赋值**——不赋值 = 不写盘、不广播。
   *
   * @returns 本次实际移除的人数
   */
  function removeStudents(ids: readonly string[]): number {
    const targets = new Set(ids)
    if (targets.size === 0) return 0
    // 同一批用同一个时间戳：将来若要按「哪次操作」回溯，一条时间戳就是一个批次
    const deletedAt = new Date().toISOString()
    let removed = 0
    const next: Student[] = []
    for (const student of students.value) {
      if (!targets.has(student.id) || student.deletedAt) {
        next.push(student)
        continue
      }
      removed += 1
      next.push({ ...student, deletedAt })
    }
    if (removed === 0) return 0
    students.value = next
    return removed
  }

  /** 软删除：标记 deletedAt 并从活跃列表移除（当前无回收站入口，仅本地留档） */
  function removeStudent(id: string): boolean {
    const index = students.value.findIndex((item) => item.id === id && !item.deletedAt)
    if (index === -1) return false
    const updated: Student = { ...students.value[index], deletedAt: new Date().toISOString() }
    students.value = [
      ...students.value.slice(0, index),
      updated,
      ...students.value.slice(index + 1),
    ]
    return true
  }

  return {
    students,
    activeStudents,
    nameCounts,
    searchStudents,
    addStudent,
    updateStudent,
    removeStudent,
    removeStudents,
    applyStudentImport,
    applyStudentBatch,
  }
})
