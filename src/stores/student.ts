import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { appConfig } from '@/config'
import { createSeedStudents } from '@/services/mock'
import { createId } from '@/utils/id'
import { normalizeStudent } from '@/utils/student'
import type { Gender, Student, StudentInput } from '@/types'

const STORAGE_KEY = `${appConfig.storageKeyPrefix}:students`

/** 从 localStorage 读取；首次启动（无缓存）时写入示例数据 */
function loadStudents(): Student[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) {
      const seed = createSeedStudents()
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed))
      return seed
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      // 内容被外部改动（如手工编辑）成非数组时兜底为空，避免后续 .filter 崩溃
      console.warn('[student] localStorage 数据格式异常，已重置为空列表')
      return []
    }
    // 旧数据升级：逐条 normalize 补齐家庭信息等新增字段的安全默认值
    return parsed
      .filter((item): item is Student => Boolean(item) && typeof item === 'object')
      .map((item) => normalizeStudent(item))
  } catch (error) {
    console.warn('[student] 读取 localStorage 失败：', error)
    return []
  }
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

  watch(
    students,
    (value) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
      } catch (error) {
        // 存储配额耗尽 / 隐私模式等写入失败时不应中断应用运行
        console.warn('[student] 写入 localStorage 失败：', error)
      }
    },
    { deep: true },
  )

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
