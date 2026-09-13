import { ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { seatConstraintRepository } from '@/repositories'
import { createId } from '@/utils/id'
import { isPairConstraintType } from '@/utils/constraint'
import { useStudentStore } from '@/stores/student'
import type { SeatConstraint, SeatConstraintType } from '@/types/constraint'

export const useConstraintStore = defineStore('constraint', () => {
  /** 学生 store 同步实例化（与 seat store 同模式）：供「学生删除 → 清理其约束」监听使用 */
  const studentStore = useStudentStore()

  const items = ref<SeatConstraint[]>(seatConstraintRepository.load())

  // 写盘 + 跨标签页同步（Phase 9A）：本页改动写盘后广播键名，别的入口改了则重读并规范化
  seatConstraintRepository.bind(items)

  /**
   * 新增一条约束：双人型（不能同桌 / 不能相邻 / 同区块）必须提供互异的第二位学生；
   * 与既有约束（同一对学生 + 同类型，不计方向）重复时返回 null（由调用方提示「已存在」）。
   * 成功返回新建条目（含 id）。
   */
  function add(input: {
    studentA: string
    studentB?: string
    type: SeatConstraintType
    reason?: string
  }): SeatConstraint | null {
    if (!input.studentA) return null
    const isPair = isPairConstraintType(input.type)
    if (isPair && (!input.studentB || input.studentB === input.studentA)) return null
    const studentB = input.studentB
    const duplicate = items.value.some(
      (item) =>
        item.type === input.type &&
        item.studentA !== item.studentB &&
        ((item.studentA === input.studentA && item.studentB === studentB) ||
          (item.studentA === studentB && item.studentB === input.studentA)),
    )
    if (duplicate) return null
    const reason = input.reason?.trim()
    const created: SeatConstraint = {
      id: createId(),
      studentA: input.studentA,
      studentB,
      type: input.type,
      enabled: true,
      reason: reason || undefined,
    }
    items.value = [...items.value, created]
    return created
  }

  /** 启用 / 停用（停用后仍保留，检查与消息不再包含它） */
  function setEnabled(id: string, enabled: boolean): boolean {
    const target = items.value.find((item) => item.id === id)
    if (!target || target.enabled === enabled) return target !== undefined
    items.value = items.value.map((item) => (item.id === id ? { ...item, enabled } : item))
    return true
  }

  /** 删除一条约束 */
  function remove(id: string): boolean {
    const target = items.value.find((item) => item.id === id)
    if (!target) return false
    items.value = items.value.filter((item) => item.id !== id)
    return true
  }

  /** 学生被删除 → 移除以其为主 / 关联的全部约束（与 seat store 座位释放同策略，不留脏引用） */
  function removeByStudent(studentId: string): number {
    const before = items.value.length
    items.value = items.value.filter(
      (item) => item.studentA !== studentId && item.studentB !== studentId,
    )
    return before - items.value.length
  }

  /** 已加载学生 id 快照：与后续活跃列表对比，检测「学生被删除」事件 */
  const activeStudentIds = new Set(studentStore.activeStudents.map((item) => item.id))
  watch(
    () => studentStore.activeStudents.map((item) => item.id),
    (ids) => {
      const next = new Set(ids)
      for (const id of activeStudentIds) {
        if (!next.has(id)) removeByStudent(id)
      }
      activeStudentIds.clear()
      for (const id of next) activeStudentIds.add(id)
    },
  )

  return { items, add, setEnabled, remove, removeByStudent }
})
