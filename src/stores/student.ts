import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { appConfig } from '@/config'
import { createSeedStudents } from '@/services/mock'
import { readList, writeSeedJSON } from '@/services/storage'
import type { StudentImportPlan } from '@/services/studentImport'
import { syncPersisted } from '@/services/sync'
import { createId } from '@/utils/id'
import { buildBatchPatch } from '@/utils/studentBatch'
import type { StudentBatchChanges } from '@/utils/studentBatch'
import { queryStudents } from '@/utils/studentQuery'
import type { StudentQueryOptions } from '@/utils/studentQuery'
import { normalizeStudent } from '@/utils/student'
import type { Student, StudentInput } from '@/types'

const STORAGE_KEY = `${appConfig.storageKeyPrefix}:students`

/**
 * 把盘上的原始列表规范成内存里的学生表：丢弃非对象条目，逐条 normalize 补齐
 * 旧数据缺的家庭信息等字段。**首屏加载与跨标签页同步共用这一份**——
 * 两条路径各写一套，规则迟早分叉（§11.1）。
 */
function reviveStudents(raw: unknown[]): Student[] {
  return raw
    .filter((item): item is Student => Boolean(item) && typeof item === 'object')
    .map((item) => normalizeStudent(item))
}

/** 读学生表；首次启动（键不存在）时写入示例数据 */
function loadStudents(): Student[] {
  const stored = readList(STORAGE_KEY)
  if (stored === null) {
    const seed = createSeedStudents()
    // 播种写盘并记下基线（Phase 9C）：首次同步据此认出「本机只有示例数据」，
    // 从而放心采纳云端那份，而不是把示例推上去或反过来把教师的数据问一遍
    writeSeedJSON(STORAGE_KEY, seed)
    return seed
  }
  return reviveStudents(stored)
}

/**
 * 列表检索选项。**与纯函数层的 `StudentQueryOptions` 是同一个形状**（Phase 5B）：
 * 检索与排序的规则只有一份实现（`utils/studentQuery.ts`），这里不再抄一遍字段。
 */
export type StudentSearchOptions = StudentQueryOptions

export const useStudentStore = defineStore('student', () => {
  /** 全部学生（含软删除记录） */
  const students = ref<Student[]>(loadStudents())

  /** 未删除学生 */
  const activeStudents = computed(() => students.value.filter((item) => !item.deletedAt))

  // 写盘 + 跨标签页同步（Phase 9A）：本页改动写盘后广播键名，别的入口改了则重读并规范化。
  // 写盘是幂等的（见 services/storage.ts），所以「收到远端更新 → 替换内存 → 触发写盘」
  // 这条链在第二次写盘处自然终止，不会两个入口互相触发
  syncPersisted(STORAGE_KEY, students, reviveStudents)

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
    searchStudents,
    addStudent,
    updateStudent,
    removeStudent,
    applyStudentImport,
    applyStudentBatch,
  }
})
