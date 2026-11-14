import type { Student, StudentInput } from '@/types'

/**
 * 批量修改的意图（Phase 5B）。**每个字段的 `undefined` 都表示「本次不修改」**——
 * 这是与「清空」区分开的关键：教师点了批量修改却只想改宿舍时，班委与标签必须原样不动。
 */
export interface StudentBatchChanges {
  /** 目标宿舍（自由文本，预设只是快捷选项）；`''` = 清空（未分配）。`undefined` = 不修改 */
  dormitory?: string
  /** 目标班委职务；`''` = 清空。`undefined` = 不修改 */
  cadreRole?: string
  /** 要添加的标签（自动去重、去空白） */
  addTags?: string[]
  /** 要移除的标签 */
  removeTags?: string[]
}

function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((tag, index) => tag === b[index])
}

/**
 * 为一名学生构造本次批量修改的补丁（Phase 5B）。
 *
 * 两种返回值的语义**刻意分开**（调用方据此分账）：
 * - `{}` —— 改完与现状**完全一样**（比如标签本来就已存在）。不计入任何计数，
 *   否则「批量给全班加同一个标签」第二次执行会报告「更新 63 人」。
 * - 非空对象 —— 真的变了。
 *
 * v3.8.1 Phase 2：宿舍与性别解耦后不再有「不适用」的学生——**任意非空字符串都合法**，
 * 包括历史值与非预设的自定义宿舍。因此本函数不再返回 `null`。
 */
export function buildBatchPatch(
  student: Student,
  changes: StudentBatchChanges,
): Partial<StudentInput> {
  const patch: Partial<StudentInput> = {}

  if (changes.dormitory !== undefined) {
    const next = changes.dormitory
    // 不再按性别 / 预设白名单拒绝；只区分「不修改」与「清空」
    if ((student.dormitory ?? '') !== next) patch.dormitory = next || undefined
  }

  if (changes.cadreRole !== undefined) {
    const next = changes.cadreRole.trim()
    if ((student.cadreRole ?? '') !== next) patch.cadreRole = next || undefined
  }

  const add = changes.addTags ?? []
  const remove = changes.removeTags ?? []
  if (add.length || remove.length) {
    const removed = new Set(remove)
    const nextTags: string[] = []
    for (const tag of student.tags ?? []) {
      // 移除时也顺手去重：历史数据里可能留着重复标签，这是它被清掉的机会
      if (!removed.has(tag) && !nextTags.includes(tag)) nextTags.push(tag)
    }
    for (const tag of add) {
      const trimmed = tag.trim()
      if (trimmed && !nextTags.includes(trimmed)) nextTags.push(trimmed)
    }
    if (!sameTags(student.tags ?? [], nextTags)) patch.tags = nextTags
  }

  return patch
}

/**
 * 把「添加标签」输入框里的文本切成标签数组。
 * 分隔符与 Excel 导入（`services/studentImport.ts`）保持同一套：半角/全角逗号、顿号、分号。
 */
export function splitTagInput(text: string): string[] {
  const seen = new Set<string>()
  for (const piece of text.split(/[,，、;；]/)) {
    const tag = piece.trim()
    if (tag) seen.add(tag)
  }
  return [...seen]
}
