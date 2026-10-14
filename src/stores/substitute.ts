import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { substituteRepository } from '@/repositories/substitute/substituteRepository'
import { isDateKey } from '@/utils/date'
import { createId } from '@/utils/id'
import {
  SUBSTITUTE_TEXT_MAX,
  filterSubstitutes,
  sortSubstitutes,
  summarizeSubstitutes,
} from '@/utils/substitute'
import { isValidPeriodId } from '@/utils/timetable'
import type { SubstituteInput, SubstituteRecord, SubstituteSummary } from '@/types/substitute'

/**
 * 把表单入参收敛成可落库的形状；任何必填项不合法就返回 `null`（拒绝写入）。
 * 五个必填字段（日期 / 节次 / 被代课教师 / 实际代课教师 / 科目）缺一不可；
 * 备注留空则**不写这个字段**（`remark: ''` 与「没有备注」是两种数据）。
 */
function cleanInput(input: SubstituteInput): Omit<SubstituteRecord, 'id' | 'createdAt'> | null {
  if (!input || typeof input !== 'object') return null
  if (!isDateKey(input.date)) return null
  if (!isValidPeriodId(input.periodId)) return null
  const originalTeacher =
    typeof input.originalTeacher === 'string'
      ? input.originalTeacher.trim().slice(0, SUBSTITUTE_TEXT_MAX.teacher)
      : ''
  const substituteTeacher =
    typeof input.substituteTeacher === 'string'
      ? input.substituteTeacher.trim().slice(0, SUBSTITUTE_TEXT_MAX.teacher)
      : ''
  const subject =
    typeof input.subject === 'string'
      ? input.subject.trim().slice(0, SUBSTITUTE_TEXT_MAX.subject)
      : ''
  if (!originalTeacher || !substituteTeacher || !subject) return null
  const remark =
    typeof input.remark === 'string' ? input.remark.trim().slice(0, SUBSTITUTE_TEXT_MAX.remark) : ''
  return {
    date: input.date,
    periodId: input.periodId,
    originalTeacher,
    substituteTeacher,
    subject,
    ...(remark ? { remark } : {}),
  }
}

/**
 * 代课管理（v3.7.5）：代课台账的唯一读写入口。
 *
 * 数据源 `teacherdesk:substitutes`（Pinia → Repository → localStorage，§8）。
 *
 * **强制隔离**（规格 §6）：本 store 只读写自己那个键——
 * - 不 import 课程表 store，不改 `Lesson`、不生成换课记录；
 * - 代课记录不出现在课程表页；
 * - 删除代课记录不影响课表；课程表换课 / 清空课表也不影响这里。
 *
 * 与旧数据的关系：`Lesson.type === 'substitute'` 是 v3.7.5 前表达代课的老写法，
 * 它没有**具体日期**（只有星期），无法可靠还原成一条带日期的代课记录，
 * 因此**不做迁移**（不猜测转换、不重复迁移、不破坏原记录）——它们原样留在课表里。
 */
export const useSubstituteStore = defineStore('substitute', () => {
  const records = ref<SubstituteRecord[]>(substituteRepository.load())

  // 写盘 + 跨标签页同步：本页改动写盘后广播键名，别的入口改了则重读并规范化
  substituteRepository.bind(records)

  /** 全部记录，日期倒序（最近的在最前）——列表展示用 */
  const sorted = computed(() => sortSubstitutes(records.value))

  /** 记录条数（= 累计代课节数） */
  const count = computed(() => records.value.length)

  /** 筛选范围内的记录（按展示顺序），两端都含；留空即该端不限 */
  function listIn(from: string, to: string): SubstituteRecord[] {
    return filterSubstitutes(sorted.value, from, to)
  }

  /** 筛选范围内的统计（实时算，不落库）：总节数 + 按实际代课 / 被代课教师分组 */
  function summaryIn(from: string, to: string): SubstituteSummary {
    return summarizeSubstitutes(filterSubstitutes(records.value, from, to))
  }

  /**
   * 新增一条代课记录。内容不合法时**拒绝写入并返回 undefined**
   * （表单已提示，这里防其他写入入口绕过——§11.4 的数据层兜底）。
   */
  function add(input: SubstituteInput): SubstituteRecord | undefined {
    const clean = cleanInput(input)
    if (!clean) return undefined
    const record: SubstituteRecord = {
      id: createId(),
      ...clean,
      createdAt: new Date().toISOString(),
    }
    records.value = [...records.value, record]
    return record
  }

  /** 更新一条代课记录；内容不合法时返回 undefined（原记录不动） */
  function update(id: string, patch: Partial<SubstituteInput>): SubstituteRecord | undefined {
    const index = records.value.findIndex((item) => item.id === id)
    if (index === -1) return undefined
    const current = records.value[index]
    if (!current) return undefined
    const clean = cleanInput({
      date: patch.date ?? current.date,
      periodId: patch.periodId ?? current.periodId,
      originalTeacher: patch.originalTeacher ?? current.originalTeacher,
      substituteTeacher: patch.substituteTeacher ?? current.substituteTeacher,
      subject: patch.subject ?? current.subject,
      remark: patch.remark ?? current.remark,
    })
    if (!clean) return undefined
    const next: SubstituteRecord = { id: current.id, ...clean, createdAt: current.createdAt }
    records.value = [...records.value.slice(0, index), next, ...records.value.slice(index + 1)]
    return next
  }

  /** 删除一条代课记录（本地单人数据，无软删 / 回收站，与其余模块同口径） */
  function remove(id: string): boolean {
    const index = records.value.findIndex((item) => item.id === id)
    if (index === -1) return false
    records.value = [...records.value.slice(0, index), ...records.value.slice(index + 1)]
    return true
  }

  /* ---------- 表单用的候选项（都从已有记录派生，实时更新、不落库） ---------- */

  /** 用过的教师名（两位教师字段共用一份候选：实际代课的人常常也是被代课的人） */
  const teacherOptions = computed(() => {
    const names = new Set<string>()
    for (const record of records.value) {
      names.add(record.originalTeacher)
      names.add(record.substituteTeacher)
    }
    return [...names].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  })

  /** 用过的科目名 */
  const subjectOptions = computed(() => {
    const names = new Set<string>()
    for (const record of records.value) names.add(record.subject)
    return [...names].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  })

  return {
    records,
    sorted,
    count,
    listIn,
    summaryIn,
    add,
    update,
    remove,
    teacherOptions,
    subjectOptions,
  }
})
