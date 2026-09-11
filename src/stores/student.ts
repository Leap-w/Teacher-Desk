import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { appConfig } from '@/config'
import { createSeedStudents } from '@/services/mock'
import { readList, writeJSON } from '@/services/storage'
import { syncPersisted } from '@/services/sync'
import { createId } from '@/utils/id'
import { normalizeStudent } from '@/utils/student'
import type { Gender, Student, StudentInput } from '@/types'

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
    writeJSON(STORAGE_KEY, seed)
    return seed
  }
  return reviveStudents(stored)
}

export interface StudentSearchOptions {
  gender?: Gender
  cadreOnly?: boolean
}

export const useStudentStore = defineStore('student', () => {
  /** 全部学生（含软删除记录） */
  const students = ref<Student[]>(loadStudents())

  /** 未删除学生 */
  const activeStudents = computed(() => students.value.filter((item) => !item.deletedAt))

  // 写盘 + 跨标签页同步（Phase 9A）：本页改动写盘后广播键名，别的入口改了则重读并规范化。
  // 写盘是幂等的（见 services/storage.ts），所以「收到远端更新 → 替换内存 → 触发写盘」
  // 这条链在第二次写盘处自然终止，不会两个入口互相触发
  syncPersisted(STORAGE_KEY, students, reviveStudents)

  /** 关键词搜索 + 筛选（仅活跃学生），按学号升序返回 */
  function searchStudents(keyword = '', options: StudentSearchOptions = {}): Student[] {
    const query = keyword.trim().toLowerCase()
    const matched = activeStudents.value
      .filter((item) => (options.gender ? item.gender === options.gender : true))
      .filter((item) => (options.cadreOnly ? Boolean(item.cadreRole) : true))
      .filter((item) => {
        if (!query) return true
        const haystack = [item.name, item.studentNo, item.dormitory ?? '', ...(item.tags ?? [])]
        return haystack.join(' ').toLowerCase().includes(query)
      })
    return [...matched].sort((a, b) => a.studentNo.localeCompare(b.studentNo))
  }

  /** 学号占用检查（数据层兜底；表单已做提示，此处防其他写入入口绕过） */
  function isStudentNoTaken(studentNo: string, excludeId?: string): boolean {
    return students.value.some(
      (item) => !item.deletedAt && item.studentNo === studentNo && item.id !== excludeId,
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

  return { students, activeStudents, searchStudents, addStudent, updateStudent, removeStudent }
})
