import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { useNow } from '@/composables/useToday'
import { fundCategoryRepository } from '@/repositories/fund/fundCategoryRepository'
import { fundCollectionRepository } from '@/repositories/fund/fundCollectionRepository'
import { fundRepository } from '@/repositories/fund/fundRepository'
import { useAppSettingsStore } from '@/stores/appSettings'
import { useStudentStore } from '@/stores/student'
import { formatDateKey, isDateKey } from '@/utils/date'
import {
  buildFundFlowEntries,
  categoryOptions,
  collectionIncome,
  collectionProgress,
  collectionRoster,
  isFundAmount,
  isPresetName,
  reviveFundCategories,
  reviveFundCollections,
  reviveFundRecords,
  totalsOf,
} from '@/utils/fund'
import { createId } from '@/utils/id'
import { formatStudentShortName } from '@/utils/student'
import type { Student } from '@/types/index'
import type {
  FundCategory,
  FundCollection,
  FundCollectionInput,
  FundRecord,
  FundRecordInput,
  FundRecordType,
  FundRosterRow,
  FundTermRange,
  FundTotals,
} from '@/types/fund'

/**
 * 把表单入参收敛成可落库的形状；任何一项不合法就返回 `null`（拒绝写入）。
 * 金额在这里收敛到两位小数——`0.1 + 0.2` 那类尾数不该落进账本。
 */
function cleanRecordInput(input: FundRecordInput): Omit<FundRecord, 'id' | 'createdAt'> | null {
  if (!input || typeof input !== 'object') return null
  if (input.type !== 'income' && input.type !== 'expense') return null
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (!title) return null
  const amount = typeof input.amount === 'number' ? Math.round(input.amount * 100) / 100 : NaN
  if (!isFundAmount(amount)) return null
  if (!isDateKey(input.date)) return null
  const category = typeof input.category === 'string' ? input.category.trim() : ''
  if (!category) return null
  const note = typeof input.note === 'string' ? input.note.trim() : ''
  return {
    type: input.type,
    title,
    amount,
    date: input.date,
    category,
    // 空备注**不写这个字段**：`note: ''` 与「没有备注」在展示、导出、云端比对里
    // 都是两回事，落库形状保持一种（§11.3 新字段向后兼容）
    ...(note ? { note } : {}),
  }
}

/**
 * 班费管理（v3.6.0）：**流水与收费批次的唯一读写入口**。
 *
 * 三份数据（三个键）都在这里，合成一个 store：
 * - `teacherdesk:fund:records`            收支流水
 * - `teacherdesk:fund:collections`        收费批次
 * - `teacherdesk:fund:expenseCategories`  自定义分类（键名照规格；收入自建项也在这里，用 `type` 区分）
 *
 * 为什么不是规格里写的「FundStore + FundCollectionStore」两个 store：两者是同一页、同一份
 * 账面（批次的收入就是流水里的一行），拆开就要互相 import 对方的 state 才能算余额，
 * 反而把「一个口径一个来源」拆成两处。值日管理同样是把「组」与「轮换设置」放在一个 store 里。
 *
 * **余额与批次金额都不落库**（规格第四、八节）：`totals` 与 `collectionIncome` 是仅有的两个
 * 出口，其余地方一律从这里取，不许页面自己加一遍。
 */
export const useFundStore = defineStore('fund', () => {
  const studentStore = useStudentStore()
  const appSettings = useAppSettingsStore()
  const now = useNow()

  const records = ref<FundRecord[]>(fundRepository.load())
  const collections = ref<FundCollection[]>(fundCollectionRepository.load())
  const customCategories = ref<FundCategory[]>(fundCategoryRepository.load())

  // 写盘 + 跨标签页同步 + 云端同步（三个键各自注册一次，与其余模块同一套纪律）
  fundRepository.bind(records, reviveFundRecords)
  fundCollectionRepository.bind(collections, reviveFundCollections)
  fundCategoryRepository.bind(customCategories, reviveFundCategories)

  /** 今天（共享时钟，跨零点自动翻篇） */
  const todayKey = computed(() => formatDateKey(now.value))

  /**
   * 本学期区间：直接取时光中心的学期日期。
   * 班费不自己定义学期——「本学期」在设置里已经被定义过一次了（§11.1）。
   */
  const termRange = computed<FundTermRange>(() => ({
    start: appSettings.timeCenter.semesterStart,
    end: appSettings.timeCenter.semesterEnd,
  }))

  /** 在读学生（收费批次名单的来源） */
  const activeStudents = computed(() => studentStore.activeStudents)

  /** 全部学生（含软删）——批次名单里已退档学生的姓名要从这里取 */
  const allStudents = computed<Student[]>(() => studentStore.students)

  /** 收支流水：手记流水 + 收费批次虚拟行，按日期倒序 */
  const flowEntries = computed(() =>
    buildFundFlowEntries(records.value, collections.value, allStudents.value),
  )

  /** 全部口径的合计（余额恒取这一份，见下方说明） */
  const totals = computed<FundTotals>(() => totalsOf(flowEntries.value))

  /** 当前余额：**永远是全部收支的净额**，不随统计范围变 */
  const balance = computed(() => totals.value.balance)

  /** 自定义支出类型（按建立顺序） */
  const categories = computed(() => customCategories.value)

  /** 某方向下可选的分类名（预设 + 自定义 + 当前这笔在用的那个，见 utils/fund） */
  function categoryNamesOf(type: FundRecordType, keep?: string): string[] {
    return categoryOptions(type, customCategories.value, keep)
  }

  /**
   * 批次名单（在读在前、已退档在后，各按学号升序）。
   * 姓名在这里就换成**展示用姓名**（重名带消歧后缀）——名单抽屉与导出的 PDF
   * 打印的是同一份名单，消歧规则不该在一处有一处没有（§11.1）。
   */
  function rosterOf(collectionId: string): FundRosterRow[] {
    const target = collections.value.find((item) => item.id === collectionId)
    if (!target) return []
    return collectionRoster(target, allStudents.value).map((row) => ({
      ...row,
      name: row.student ? formatStudentShortName(row.student, studentStore.nameCounts) : row.name,
    }))
  }

  /* ---------- 流水：新增 / 编辑 / 删除 ---------- */

  /**
   * 新增一笔流水。内容不合法时**拒绝写入并返回 undefined**
   * （表单已提示，这里防其他写入入口绕过——§11.4 的数据层兜底）。
   */
  function addRecord(input: FundRecordInput): FundRecord | undefined {
    const clean = cleanRecordInput(input)
    if (!clean) return undefined
    const record: FundRecord = { id: createId(), ...clean, createdAt: new Date().toISOString() }
    records.value = [...records.value, record]
    return record
  }

  /**
   * 更新一笔流水。**允许改方向**（记成支出但其实是收入，改过来就是），
   * 内容不合法时返回 undefined。
   */
  function updateRecord(id: string, patch: Partial<FundRecordInput>): FundRecord | undefined {
    const index = records.value.findIndex((item) => item.id === id)
    if (index === -1) return undefined
    const current = records.value[index]
    if (!current) return undefined
    const clean = cleanRecordInput({
      type: patch.type ?? current.type,
      title: patch.title ?? current.title,
      amount: patch.amount ?? current.amount,
      date: patch.date ?? current.date,
      category: patch.category ?? current.category,
      note: patch.note ?? current.note,
    })
    if (!clean) return undefined
    const next: FundRecord = { id: current.id, ...clean, createdAt: current.createdAt }
    records.value = [...records.value.slice(0, index), next, ...records.value.slice(index + 1)]
    return next
  }

  /** 删除一笔流水（本地单人数据，无软删 / 回收站，与其余模块同口径） */
  function removeRecord(id: string): boolean {
    const index = records.value.findIndex((item) => item.id === id)
    if (index === -1) return false
    records.value = [...records.value.slice(0, index), ...records.value.slice(index + 1)]
    return true
  }

  /* ---------- 收费批次 ---------- */

  /**
   * 新建一个收费批次。名单不写进批次（见 types/fund.ts）：新转来的学生
   * 因此一定会出现在名单里，而不是因为「建档时他还没来」被漏掉。
   */
  function addCollection(input: FundCollectionInput): FundCollection | undefined {
    const title = typeof input?.title === 'string' ? input.title.trim() : ''
    const per = input?.amountPerStudent
    if (!title || !isFundAmount(per) || !isDateKey(input?.date)) return undefined
    const collection: FundCollection = {
      id: createId(),
      title,
      amountPerStudent: Math.round(per * 100) / 100,
      date: input.date,
      records: [],
      createdAt: new Date().toISOString(),
    }
    collections.value = [...collections.value, collection]
    return collection
  }

  function updateCollection(
    id: string,
    patch: Partial<FundCollectionInput>,
  ): FundCollection | undefined {
    const index = collections.value.findIndex((item) => item.id === id)
    if (index === -1) return undefined
    const current = collections.value[index]
    if (!current) return undefined
    const title = patch.title === undefined ? current.title : patch.title.trim()
    const per = patch.amountPerStudent ?? current.amountPerStudent
    const date = patch.date ?? current.date
    if (!title || !isFundAmount(per) || !isDateKey(date)) return undefined
    const next: FundCollection = {
      ...current,
      title,
      amountPerStudent: Math.round(per * 100) / 100,
      date,
    }
    collections.value = [
      ...collections.value.slice(0, index),
      next,
      ...collections.value.slice(index + 1),
    ]
    return next
  }

  /** 删除一个批次：它那一行收入随之从流水里消失（钱已收的事实由教师决定是否补一笔手记收入） */
  function removeCollection(id: string): boolean {
    const index = collections.value.findIndex((item) => item.id === id)
    if (index === -1) return false
    collections.value = [
      ...collections.value.slice(0, index),
      ...collections.value.slice(index + 1),
    ]
    return true
  }

  /** 勾选 / 取消一个学生的缴费状态（规格第八节：点击切换已交 / 未交） */
  function togglePaid(collectionId: string, studentId: string): boolean {
    return writePaid(collectionId, (entries) => {
      const hit = entries.find((item) => item.studentId === studentId)
      if (hit) return entries.map((item) => (item === hit ? { ...item, paid: !item.paid } : item))
      return [...entries, { studentId, paid: true }]
    })
  }

  /**
   * 一键全部已交 / 全部未交：只作用于**在读学生**。
   * 已退档学生的记录原样保留——他们那笔钱确实收过，不该被一次「全部未交」抹掉。
   */
  function setAllPaid(collectionId: string, paid: boolean): boolean {
    const activeIds = new Set(activeStudents.value.map((item) => item.id))
    return writePaid(collectionId, (entries) => {
      const rest = entries.filter((item) => !activeIds.has(item.studentId))
      return [...rest, ...[...activeIds].map((studentId) => ({ studentId, paid }))]
    })
  }

  /** 两个缴费动作共用的写入口：取批次 → 改 entries → 不可变替换 */
  function writePaid(
    collectionId: string,
    transform: (entries: FundCollection['records']) => FundCollection['records'],
  ): boolean {
    const index = collections.value.findIndex((item) => item.id === collectionId)
    if (index === -1) return false
    const current = collections.value[index]
    if (!current) return false
    const next: FundCollection = { ...current, records: transform(current.records) }
    collections.value = [
      ...collections.value.slice(0, index),
      next,
      ...collections.value.slice(index + 1),
    ]
    return true
  }

  /** 某批次当前的「已交 / 应缴」与收入（列表卡片、详情页、导出共用一份口径） */
  function progressOf(collectionId: string): { paid: number; total: number } {
    const target = collections.value.find((item) => item.id === collectionId)
    if (!target) return { paid: 0, total: 0 }
    return collectionProgress(target, allStudents.value)
  }

  function incomeOf(collectionId: string): number {
    const target = collections.value.find((item) => item.id === collectionId)
    return target ? collectionIncome(target) : 0
  }

  /* ---------- 自定义支出类型 ---------- */

  /**
   * 新增一个自定义分类（方向由 `type` 定，收入也可以有——规格第五节）。
   * **与预设同名时拒绝**：表单里会出现两个一模一样的选项，教师与后续维护都分不清点了哪个。
   */
  function addCategory(name: string, type: FundRecordType = 'expense'): FundCategory | undefined {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!trimmed) return undefined
    if (customCategories.value.some((item) => item.type === type && item.name === trimmed)) {
      return undefined
    }
    if (isPresetName(trimmed, type)) return undefined
    const category: FundCategory = {
      id: createId(),
      name: trimmed,
      type,
      createdAt: new Date().toISOString(),
    }
    customCategories.value = [...customCategories.value, category]
    return category
  }

  /**
   * 删除一个自定义支出类型。**已经用过它的流水一字不改**——
   * 分类名是记在那笔流水上的事实（同请假记录里的学生姓名快照），
   * 删分类只是让它从今往后的选项里消失。
   */
  function removeCategory(id: string): boolean {
    const index = customCategories.value.findIndex((item) => item.id === id)
    if (index === -1) return false
    customCategories.value = [
      ...customCategories.value.slice(0, index),
      ...customCategories.value.slice(index + 1),
    ]
    return true
  }

  /** 某个分类被多少笔流水用过（删除确认里如实告诉教师「不影响已有 N 笔记录」） */
  function categoryUsage(name: string): number {
    return records.value.filter((item) => item.category === name).length
  }

  return {
    records,
    collections,
    categories,
    todayKey,
    termRange,
    activeStudents,
    flowEntries,
    totals,
    balance,
    categoryNamesOf,
    rosterOf,
    addRecord,
    updateRecord,
    removeRecord,
    addCollection,
    updateCollection,
    removeCollection,
    togglePaid,
    setAllPaid,
    progressOf,
    incomeOf,
    addCategory,
    removeCategory,
    categoryUsage,
  }
})
