/**
 * 班费管理纯逻辑（v3.6.0）。
 *
 * 全模块的规则都收在这个文件里：预设分类、金额口径、复活（normalize）、
 * 统计与筛选、收费批次的名单与金额派生。**页面与 store 都不许再算一遍**
 * （§11.1「同一口径只有一个来源」）——它们是纯函数，因此也能脱离浏览器单测
 * （§11.4 的四条纪律：测数据安全、不测 UI）。
 *
 * 三处刻意的口径，改之前先读：
 *
 * ① **金额按「分」求和**：`0.1 + 0.2 !== 0.3` 在账目里不是学术问题，
 *    余额差一分钱教师就会怀疑整本账。所有求和先 `toCents` 转成整数再做。
 *
 * ② **余额不落库**：`totalsOf` 是唯一出口，盘上只有流水（见 types/fund.ts）。
 *
 * ③ **分类存名字、不存 id**：删掉一个自定义分类不该让历史流水失去分类。
 */
import type { Student } from '@/types/index'
import type {
  FundCategory,
  FundCategoryPreset,
  FundCollection,
  FundFlowEntry,
  FundRange,
  FundRecord,
  FundRecordType,
  FundRosterRow,
  FundTermRange,
  FundTotals,
} from '@/types/fund'
import { isDateKey } from '@/utils/date'
import { queryStudents } from '@/utils/studentQuery'

/* ========== 预设分类（规格第五节 / 第六节） ========== */

/**
 * 收入分类预设。规格只给了名称，图标是这里补的——流水列表每一行都要一个图标位，
 * 没有图标的行会与有图标的行对不齐（收费批次行也走同一套）。
 */
export const INCOME_CATEGORY_PRESETS: FundCategoryPreset[] = [
  { name: '班费', icon: '💰' },
  { name: '补缴', icon: '💵' },
  { name: '退款', icon: '↩️' },
  { name: '其他收入', icon: '🧾' },
]

/** 支出类型预设（名称与图标逐条照规格第六节的表） */
export const EXPENSE_CATEGORY_PRESETS: FundCategoryPreset[] = [
  { name: '卫生用品', icon: '🧹' },
  { name: '学习用品', icon: '📚' },
  { name: '打印复印', icon: '🖨️' },
  { name: '奖品奖励', icon: '🎁' },
  { name: '班级活动', icon: '🎉' },
  { name: '清洁用品', icon: '🧴' },
  { name: '饮用水', icon: '💧' },
  { name: '办公用品', icon: '📌' },
  { name: '其他支出', icon: '📦' },
]

/** 收费批次在流水里的分类名（恒为收入） */
export const FUND_COLLECTION_CATEGORY = '班费'

/** 该名字是不是某方向的预设分类（`addCategory` 据此拒绝与预设重名的新分类） */
export function isPresetName(name: string, type: FundRecordType): boolean {
  return presetCategories(type).some((item) => item.name === name)
}

/** 兼容旧写法：只在支出方向判重 */
export function isPresetExpenseName(name: string): boolean {
  return isPresetName(name, 'expense')
}

/** 预设分类（按方向取） */
export function presetCategories(type: FundRecordType): FundCategoryPreset[] {
  return type === 'income' ? INCOME_CATEGORY_PRESETS : EXPENSE_CATEGORY_PRESETS
}

/** 分类名的图标；自定义分类没有图标，返回空串（调用方按纯文字渲染，不硬塞一个通用图标） */
export function categoryIcon(category: string, type: FundRecordType = 'expense'): string {
  return presetCategories(type).find((item) => item.name === category)?.icon ?? ''
}

/**
 * 某方向下可选的分类名：预设 + 教师自建（同方向的自建项）。
 * `keep` 是「当前这笔已经在用的分类」——分类被删掉之后，编辑那笔流水时
 * 它仍然要出现在选项里，否则一打开编辑就发现自己的分类变成了「未选择」。
 */
export function categoryOptions(
  type: FundRecordType,
  custom: FundCategory[],
  keep?: string,
): string[] {
  const names = presetCategories(type).map((item) => item.name)
  for (const item of custom) {
    if (item.type !== type) continue
    if (!names.includes(item.name)) names.push(item.name)
  }
  const trimmed = keep?.trim() ?? ''
  if (trimmed && !names.includes(trimmed)) names.push(trimmed)
  return names
}

/* ========== 金额 ========== */

/** 金额上限（元）：一亿。防的是「多按了几个 0」这类手滑，不是防真实业务 */
const MAX_AMOUNT = 100_000_000

/** 元 → 分（整数）。**所有求和都先走这里**，见文件头第 ① 条 */
export function toCents(amount: number): number {
  return Math.round(amount * 100)
}

/** 分 → 元 */
export function fromCents(cents: number): number {
  return Math.round(cents) / 100
}

/** 金额是否可用：有限、> 0、不超过上限、精确到分（多余小数在 normalize 时收敛，这里只判形状） */
export function isFundAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_AMOUNT
}

/**
 * 把输入收敛成一个合法金额（元，两位小数）。
 * 认不出 / 不在范围内返回 `null`——**不替教师四舍五入成 0**：
 * 一笔 0 元流水在账上是个说不清的记录，宁可让表单拦住。
 */
export function parseAmount(raw: string | number): number | null {
  const text = typeof raw === 'number' ? String(raw) : raw.trim()
  if (!text) return null
  const value = Number(text)
  if (!Number.isFinite(value)) return null
  const rounded = Math.round(value * 100) / 100
  return isFundAmount(rounded) ? rounded : null
}

/**
 * 金额 → 显示文案：整数不带小数点，有角分则保留两位（`3100` → `3,100`，`86.5` → `86.50`）。
 * 千分位加上：班费一笔上千很常见，`12300` 与 `12,300` 的读错代价不一样。
 */
export function formatAmount(amount: number): string {
  const fixed = (Math.round(amount * 100) / 100).toFixed(2)
  const [intPart = '0', decPart = '00'] = fixed.split('.')
  const sign = intPart.startsWith('-') ? '-' : ''
  const digits = sign ? intPart.slice(1) : intPart
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const trimmedDec = decPart === '00' ? '' : `.${decPart}`
  return `${sign}${grouped}${trimmedDec}`
}

/**
 * 金额 → 带币种符号：`¥3,100`、`-¥50`。
 *
 * **负号的写法定死为「`-` 在 `¥` 前」**：余额为负（支出超过收入）是真的会出现的，
 * 而 `¥-50` 与规格里的 `+¥3,100` / `-¥86` 摆在一起像两种写法。
 * 正负号一律在币种符号外面，与 `formatFlowAmount` 是同一个口径。
 */
export function formatMoney(amount: number): string {
  const negative = amount < 0
  return `${negative ? '-' : ''}¥${formatAmount(negative ? -amount : amount)}`
}

/** 流水行金额：收入 `+¥3,100`，支出 `-¥86`（规格第七节的展示口径） */
export function formatFlowAmount(entry: { type: FundRecordType; amount: number }): string {
  return `${entry.type === 'income' ? '+' : '-'}${formatMoney(entry.amount)}`
}

/**
 * 完整日期文案 `2026年9月3日`。
 * 列表上用 `formatMonthDay`（省地方，一年内的账目都读得懂），
 * 详情与导出上必须带年——那两处是「这一笔到底哪天的」的最终依据，班费账本会跨年。
 */
export function formatFundDate(dateKey: string): string {
  return `${dateKey.slice(0, 4)}年${Number(dateKey.slice(5, 7))}月${Number(dateKey.slice(8, 10))}日`
}

/* ========== 统计范围 ========== */

/** 统计范围标签（规格第九节三个维度） */
export const FUND_RANGE_LABELS: Record<FundRange, string> = {
  all: '全部',
  month: '本月',
  term: '本学期',
}

/** 日期是否落在统计范围内（`today` 是今天日期键，跨零点由调用方的共享时钟翻篇） */
export function isInFundRange(
  date: string,
  range: FundRange,
  today: string,
  term: FundTermRange,
): boolean {
  if (range === 'all') return true
  if (range === 'month') return date.slice(0, 7) === today.slice(0, 7)
  // 学期起止没设过（时光中心里可能留空）→ 不筛，而不是筛成空列表
  if (!term.start && !term.end) return true
  if (term.start && date < term.start) return false
  if (term.end && date > term.end) return false
  return true
}

/** 按范围筛流水 */
export function filterByRange(
  entries: FundFlowEntry[],
  range: FundRange,
  today: string,
  term: FundTermRange,
): FundFlowEntry[] {
  return entries.filter((item) => isInFundRange(item.date, range, today, term))
}

/**
 * 统计：收入 / 支出 / 余额 / 笔数（规格第九节的四个指标，笔数 = 流水条数）。
 * 全程按分求和，最后一次性还原成元。
 */
export function totalsOf(entries: FundFlowEntry[]): FundTotals {
  let income = 0
  let expense = 0
  let count = 0
  for (const entry of entries) {
    const cents = toCents(entry.amount)
    if (entry.type === 'income') income += cents
    else expense += cents
    count += 1
  }
  return {
    income: fromCents(income),
    expense: fromCents(expense),
    balance: fromCents(income - expense),
    count,
  }
}

/* ========== 流水（记录 + 批次合成一张列表） ========== */

/**
 * 收费批次 → 流水行：金额由已交人数当场算（规格第八节「无需手动修改流水金额」）。
 *
 * `students` 是**全部学生（含软删）**——应缴人数取自名单（在读 + 已退档但当时标过状态的），
 * 与金额取自同一份口径，列表上「已交 61/62」的两个数与那一行的金额永远对得上。
 */
export function collectionToFlowEntry(
  collection: FundCollection,
  students: Student[],
): FundFlowEntry {
  const { paid, total } = collectionProgress(collection, students)
  return {
    id: `collection:${collection.id}`,
    kind: 'collection',
    type: 'income',
    title: collection.title,
    amount: collectionIncome(collection),
    date: collection.date,
    category: FUND_COLLECTION_CATEGORY,
    note: `已交 ${paid}/${total} 人 · 每人 ${formatMoney(collection.amountPerStudent)}`,
    createdAt: collection.createdAt,
    paidCount: paid,
    totalCount: total,
  }
}

function recordToFlowEntry(record: FundRecord): FundFlowEntry {
  return {
    id: `record:${record.id}`,
    kind: 'record',
    type: record.type,
    title: record.title,
    amount: record.amount,
    date: record.date,
    category: record.category,
    note: record.note,
    createdAt: record.createdAt,
  }
}

/**
 * 流水列表：手记流水 + 收费批次合成一张，按**日期倒序**（规格第七节）。
 * 同一天按录入时间倒序，再按 id —— 排序必须是全序，否则两次渲染的行序可能不同
 * （Vue 的 v-for 会因此无谓重建 DOM）。
 */
export function buildFundFlowEntries(
  records: FundRecord[],
  collections: FundCollection[],
  students: Student[],
): FundFlowEntry[] {
  return [
    ...records.map(recordToFlowEntry),
    ...collections.map((item) => collectionToFlowEntry(item, students)),
  ].sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      b.createdAt.localeCompare(a.createdAt) ||
      (a.id < b.id ? 1 : -1),
  )
}

/* ========== 收费批次 ========== */

/**
 * 已交人数（`records` 里标了已交的**学生数**）。
 *
 * 按学生 id 去重而不是数条数：同一个人在 `records` 里出现两次时，条数会算成两个勾，
 * 批次金额跟着多算一个人的钱。这条在正常写入路径上不会发生（`reviveFundCollections`
 * 按 id 去重、`togglePaid` 命中即改不追加），但**钱多算一次是不会报错的那种错**，
 * 所以在这一层再兜一次（§11.4 的数据层兜底）。
 */
export function collectionPaidCount(collection: FundCollection): number {
  return new Set(collection.records.filter((item) => item.paid).map((item) => item.studentId)).size
}

/** 批次收入（元）：已交人数 × 每人金额，按分算再还原 */
export function collectionIncome(collection: FundCollection): number {
  return fromCents(collectionPaidCount(collection) * toCents(collection.amountPerStudent))
}

/**
 * 流水行的 id → 它来源那条数据的 id（去掉 `record:` / `collection:` 前缀）。
 *
 * 点列表里的一行之后要开的那个详情，只能靠这个前缀判断：批次行开名单，
 * 手记行开详情。**前缀只在这一处解析**——页面里到处 `split(':')`
 * 的话，将来改 id 形状（比如换个分隔符）就得满仓库找。
 */
export function flowEntrySourceId(entry: Pick<FundFlowEntry, 'id'>): string {
  const index = entry.id.indexOf(':')
  return index === -1 ? entry.id : entry.id.slice(index + 1)
}

/**
 * 批次名单：**在读学生当场派生**（规格第八节）+ 已经不在读、但当时标过缴费状态的人。
 *
 * 后一半不能省：张三交了 50 元之后转学走了，那 50 元还在班费里躺着——
 * 名单上把他抹掉，批次金额就会跟着少 50，账面当场对不上。
 * 他那一行的姓名从「全部学生」（含软删）里取，彻底找不到时给占位文案，不编名字。
 */
export function collectionRoster(collection: FundCollection, students: Student[]): FundRosterRow[] {
  const paidIds = new Set(
    collection.records.filter((item) => item.paid).map((item) => item.studentId),
  )
  const known = collection.records.map((item) => item.studentId)
  // 花名册顺序**借学生档案的排序**（`queryStudents` 的默认学号升序，含「空学号排最后」）：
  // 那是全应用唯一一份学号排序（`utils/studentQuery.ts` 文件头就这么写着）。
  // 班费再写一个比较函数，就会出现「档案页的顺序与名单里的顺序对不上」这种
  // 谁也说不清谁对的分歧——名单是要拿着纸去核对的，顺序必须与档案一致。
  const active = queryStudents(students.filter((item) => !item.deletedAt))
  const activeIds = new Set(active.map((item) => item.id))

  const rows: FundRosterRow[] = active.map((student) => ({
    studentId: student.id,
    name: student.name,
    paid: paidIds.has(student.id),
    active: true,
    student,
  }))

  const byId = new Map(students.map((item) => [item.id, item]))
  for (const studentId of known) {
    if (activeIds.has(studentId)) continue
    const student = byId.get(studentId)
    rows.push({
      studentId,
      name: student?.name ?? '已退档学生',
      paid: paidIds.has(studentId),
      active: false,
      student,
    })
  }
  return rows
}

/** 名单里已交 / 应缴人数（列表卡片与导出表头共用一份口径） */
export function collectionProgress(
  collection: FundCollection,
  students: Student[],
): {
  paid: number
  total: number
} {
  const rows = collectionRoster(collection, students)
  return { paid: rows.filter((item) => item.paid).length, total: rows.length }
}

/* ========== 复活（normalize） ========== */
/*
 * 规则与其余模块同款：**形状不对就丢弃那一条**（返回 null），
 * 由各 revive* 汇总告警。升级不得覆盖旧数据，也不得让旧数据崩溃（§11.3）。
 */

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** 盘上一条 → 内存里的流水；形状不对返回 null */
export function normalizeFundRecord(raw: unknown): FundRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const id = textOf(source.id)
  const title = textOf(source.title)
  const category = textOf(source.category)
  const type = source.type
  const date = source.date
  const amount = typeof source.amount === 'number' ? Math.round(source.amount * 100) / 100 : NaN
  if (!id || !title || !category) return null
  if (type !== 'income' && type !== 'expense') return null
  if (!isFundAmount(amount)) return null
  if (!isDateKey(date)) return null
  const note = textOf(source.note)
  return {
    id,
    type,
    title,
    amount,
    date,
    category,
    ...(note ? { note } : {}),
    createdAt: textOf(source.createdAt) ?? '',
  }
}

/** 盘上一条 → 内存里的批次；`records` 里形状不对的条目直接丢掉（不因此丢掉整个批次） */
export function normalizeFundCollection(raw: unknown): FundCollection | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const id = textOf(source.id)
  const title = textOf(source.title)
  const date = source.date
  const per = typeof source.amountPerStudent === 'number' ? source.amountPerStudent : NaN
  if (!id || !title) return null
  if (!isFundAmount(per)) return null
  if (!isDateKey(date)) return null

  const seen = new Set<string>()
  const records: FundCollection['records'] = []
  const rawRecords = Array.isArray(source.records) ? source.records : []
  for (const item of rawRecords) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    const studentId = textOf(entry.studentId)
    if (!studentId || seen.has(studentId)) continue
    seen.add(studentId)
    records.push({ studentId, paid: entry.paid === true })
  }

  return {
    id,
    title,
    amountPerStudent: Math.round(per * 100) / 100,
    date,
    records,
    createdAt: textOf(source.createdAt) ?? '',
  }
}

/** 盘上一条 → 内存里的自定义分类；同名去重由 revive 处理 */
export function normalizeFundCategory(raw: unknown): FundCategory | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const id = textOf(source.id)
  const name = textOf(source.name)
  if (!id || !name) return null
  // 没有 type 的旧数据按支出认（键名原本只提支出），不因此丢掉这一条
  const type: FundRecordType = source.type === 'income' ? 'income' : 'expense'
  return { id, name, type, createdAt: textOf(source.createdAt) ?? '' }
}

function reviveList<T>(raw: unknown[], normalize: (item: unknown) => T | null, tag: string): T[] {
  const seen = new Set<string>()
  const list: T[] = []
  for (const item of raw) {
    const value = normalize(item)
    if (value === null) continue
    const id = (value as { id: string }).id
    if (seen.has(id)) continue // 同一 id 只留首条：重复 id 会让 v-for key 冲突
    seen.add(id)
    list.push(value)
  }
  if (list.length < raw.length) {
    console.warn(`[fund] 丢弃 ${raw.length - list.length} 条不合法的${tag}（缓存原文保留）`)
  }
  return list
}

export function reviveFundRecords(raw: unknown[]): FundRecord[] {
  return reviveList(raw, normalizeFundRecord, '班费流水')
}

export function reviveFundCollections(raw: unknown[]): FundCollection[] {
  return reviveList(raw, normalizeFundCollection, '收费批次')
}

/** 自定义分类复活：**同方向同名只留首条**（重名选项在表单里无法区分，删一个另一个还在） */
export function reviveFundCategories(raw: unknown[]): FundCategory[] {
  const list = reviveList(raw, normalizeFundCategory, '自定义分类')
  const seen = new Set<string>()
  return list.filter((item) => {
    const key = `${item.type}|${item.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
