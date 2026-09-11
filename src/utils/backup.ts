import { appConfig } from '@/config'
import { isSampleRecordId } from '@/utils/id'
import { isPlainObject } from '@/utils/object'

/**
 * 数据备份 / 恢复（近期增量「数据管理」，tag v0.9.0）。
 *
 * 为什么存在：localStorage 是当前唯一数据载体，清缓存 / 换设备 / 换浏览器即全部丢失。
 * 本模块只做三件事——读出七个数据块的原始 JSON、校验 / 合并、写回；**条目级校验不在这里
 * 重复实现**：写回后由页面 `location.reload()`，七个 store 用各自既有的 normalize* 重新加载
 * （字段形状、id 去重、悬空引用清理都走已验收的那一套）。这里只管两件事：
 * 结构对不对（是不是本应用的备份、每个数据块是不是列表）、哪些条目能按 id 对上。
 *
 * 两条贯穿全模块的取舍：
 * - **宁可不认，不可丢**：认不出的条目（缺 id）照常导入（追加），读不动的数据块绝不写盘
 *   （见 readModules 的 broken 与 planMerge 的 skipLabels）——备份是教师唯一的退路。
 * - **不做半截事**：写盘一律走 commitAtomically，中途失败就把这一批已经写进去的键还原，
 *   否则界面只能对教师说「数据未改变」，而那是假话（applyWrites / clearAllKeys）。
 */

export const BACKUP_KIND = 'teacherdesk-backup'

/** 备份文件结构版本；结构变更时 +1，parseBackup 拒绝高于本值的文件 */
export const BACKUP_SCHEMA_VERSION = 1

/** 上次导出时间（本机提示用）。它本身不是数据，是这台设备的提示状态，**不在备份范围内** */
export const LAST_BACKUP_KEY = `${appConfig.storageKeyPrefix}:lastBackupAt`

export interface BackupModule {
  /** localStorage 键名 */
  key: string
  /** 界面展示名（同时也是报错文案里的名字） */
  label: string
  /** 量词（6 名学生 / 12 节课 …） */
  unit: string
}

/** 七个数据块的键（与各 store 的 STORAGE_KEY 一一对应，改动 store 键时同步这里） */
const STUDENT_KEY = `${appConfig.storageKeyPrefix}:students`
const SEAT_PLAN_KEY = `${appConfig.storageKeyPrefix}:seatPlans`
const CONSTRAINT_KEY = `${appConfig.storageKeyPrefix}:seatConstraints`
const TIMETABLE_KEY = `${appConfig.storageKeyPrefix}:timetable`
const TODO_KEY = `${appConfig.storageKeyPrefix}:dashboard:todos`
const LEAVE_KEY = `${appConfig.storageKeyPrefix}:leaves`
const DUTY_KEY = `${appConfig.storageKeyPrefix}:duty`
/** Phase 4 的课表键（Phase 4.1 起改用 TIMETABLE_KEY，见下方 LEGACY_CLEAR_MODULES） */
const LEGACY_TIMETABLE_KEY = `${appConfig.storageKeyPrefix}:timetable:lessons`

/** 备份覆盖的七个数据块；顺序即界面展示顺序，新增 store 时在此登记 */
export const BACKUP_MODULES: BackupModule[] = [
  { key: STUDENT_KEY, label: '学生档案', unit: '名' },
  { key: SEAT_PLAN_KEY, label: '座位方案', unit: '个' },
  { key: CONSTRAINT_KEY, label: '座位约束', unit: '条' },
  { key: TIMETABLE_KEY, label: '课程表', unit: '节' },
  { key: TODO_KEY, label: '今日待办', unit: '条' },
  { key: LEAVE_KEY, label: '请假记录', unit: '条' },
  // 值日组与轮换设置同存一个数组（见 types/duty.ts），因此这里只有一行
  { key: DUTY_KEY, label: '值日安排', unit: '条' },
]

/**
 * 只在「清空示例数据」里参与的历史键：**不属于七个数据块**——不进概览、不进备份、不参与合并。
 * `teacherdesk:timetable:lessons` 是 Phase 4 的课表键，Phase 4.1 迁移到 `teacherdesk:timetable`：
 * 迁移没有丢弃条目就顺手删掉，**还留着就说明当时有读不动的条目，原文只能从这里找回**。
 * 它不在 BACKUP_MODULES 里，所以清空示例时要单独捎带一把，否则会残留示例课程原文（技术债 #10）。
 */
export const LEGACY_CLEAR_MODULES: BackupModule[] = [
  { key: LEGACY_TIMETABLE_KEY, label: '旧课表数据', unit: '节' },
]

/** 该待删条目是否来自「旧键」（界面据此多解释一句：它不是现行数据，只是旧存档） */
export function isLegacyClearItem(label: string): boolean {
  return LEGACY_CLEAR_MODULES.some((module) => module.label === label)
}

/** 备份文件（导出即此形状；导入按此形状逐项校验） */
export interface BackupFile {
  app: string
  kind: string
  schemaVersion: number
  /** 导出时的应用版本（诊断用，不参与校验） */
  appVersion: string
  /** 导出时间（ISO） */
  exportedAt: string
  /** 数据块：localStorage 键 → 该键的值（七个数据块都是数组） */
  data: Record<string, unknown>
}

/**
 * 单个数据块的条目数（数据概览用）。
 * `count === null` = 这个键在盘上**不存在**：模块从未打开过（首次打开才播种示例数据）。
 * 界面必须说「还没打开过」而不是 0 —— 显示 0 会让教师以为模块是空的（技术债 #9）。
 */
export interface ModuleCount extends BackupModule {
  count: number | null
}

/** 读取器（即 localStorage.getItem 的形状）；SSR / 自检脚本下可替换 */
export type RawReader = (key: string) => string | null

export interface ModuleReadResult {
  /** 键 → 数组（缺键 = 该块无数据，直接不出现在这里） */
  values: Record<string, unknown[]>
  /** JSON 损坏、无法解析的数据块名（调用方据此提示，绝不静默当成空） */
  broken: string[]
}

/** 取条目 id；不是对象 / 没有非空字符串 id → null（这类条目无法参与「按 id 合并」） */
function idOf(item: unknown): string | null {
  if (!isPlainObject(item)) return null
  const id = item.id
  return typeof id === 'string' && id.length > 0 ? id : null
}

function labelOf(key: string): string {
  return BACKUP_MODULES.find((module) => module.key === key)?.label ?? key
}

/**
 * 读出数据块的原始值：缺键 = 无数据（不进 values），JSON 损坏的块记入 broken 并跳过。
 * 默认读七个备份数据块；传 modules 可读别的键（「清空示例数据」用它捎带旧键，见 LEGACY_CLEAR_MODULES）。
 */
export function readModules(
  read: RawReader,
  modules: BackupModule[] = BACKUP_MODULES,
): ModuleReadResult {
  const values: Record<string, unknown[]> = {}
  const broken: string[] = []
  for (const module of modules) {
    const raw = read(module.key)
    if (raw === null) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      broken.push(module.label)
      continue
    }
    if (Array.isArray(parsed)) values[module.key] = parsed
    else broken.push(module.label)
  }
  return { values, broken }
}

/**
 * 各数据块条目数（含已从列表移除、档案仍留档的学生——备份原样保留，两个数字必须同源）。
 * 取 readModules 的结果而非自己再读一遍：概览与后续操作必须基于**同一次**读取，
 * 否则两个数字可能来自不同的时刻。
 */
export function countModules(values: Record<string, unknown[]>): ModuleCount[] {
  return BACKUP_MODULES.map((module) => {
    const items = values[module.key]
    return { ...module, count: items === undefined ? null : items.length }
  })
}

/**
 * 生成备份：七个数据块 + 元信息。
 * 某个块 JSON 损坏时**跳过该块并回报**（broken），不写 null、不假装它是空的——
 * 宁可少备份一块并当场告诉教师，也不要导出一份看起来正常、实则少了数据的备份。
 */
export function createBackup(read: RawReader, now: Date): { backup: BackupFile; broken: string[] } {
  const { values, broken } = readModules(read)
  return {
    backup: {
      app: appConfig.name,
      kind: BACKUP_KIND,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      appVersion: appConfig.version,
      exportedAt: now.toISOString(),
      data: values,
    },
    broken,
  }
}

/** 校验结果：失败时 error 是直接给教师看的整句文案（不夹带「顶层」「列表」这类开发者词汇） */
export type ParseBackupResult =
  | {
      ok: true
      backup: BackupFile
      /** 备份里有、本应用不认识的数据块键（界面提示后忽略，不写盘） */
      unknownModules: string[]
      /** 备份里缺少 id 的条目（按块计数）：照常导入，但只能追加、无法与已有记录对上 */
      idless: { label: string; count: number }[]
    }
  | { ok: false; error: string }

/**
 * 校验导入的文本：
 * ① 能解析成 JSON ② 是本应用的备份（kind）③ 结构版本不比本应用新
 * ④ 每个数据块必须是列表（**条目内部字段不强求**——写回后由各 store 的 normalize* 逐条把关，
 * 那是唯一事实来源，这里再写一套只会分叉）。
 *
 * 缺 id 的条目**不拒绝**：本机残留的无 id 记录会被导出原样带进备份文件，若这里整份拒绝，
 * 教师唯一的备份就再也导不回来（student 的 normalize 不补 id，这类记录可以长期存在）。
 * 它们由 idless 回报、按追加处理。
 */
export function parseBackup(text: string): ParseBackupResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: '这不是有效的 JSON 文件，请选择由本应用导出的备份。' }
  }
  if (!isPlainObject(parsed) || parsed.kind !== BACKUP_KIND) {
    return { ok: false, error: '这不是 TeacherDesk 的备份文件。' }
  }
  const version = parsed.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: '备份文件不完整（缺少版本信息），无法识别。' }
  }
  if (version > BACKUP_SCHEMA_VERSION) {
    return { ok: false, error: `备份来自更新版本的应用（备份格式 ${version}），请升级后再导入。` }
  }
  if (!isPlainObject(parsed.data)) {
    return { ok: false, error: '备份文件里没有可导入的数据。' }
  }

  const data: Record<string, unknown> = {}
  const unknownModules: string[] = []
  const idless: { label: string; count: number }[] = []
  for (const [key, value] of Object.entries(parsed.data)) {
    if (!BACKUP_MODULES.some((module) => module.key === key)) {
      unknownModules.push(key)
      continue
    }
    if (!Array.isArray(value)) {
      return { ok: false, error: `备份内容读不出来：${labelOf(key)}部分格式不对。` }
    }
    const missing = value.filter((item) => idOf(item) === null).length
    if (missing > 0) idless.push({ label: labelOf(key), count: missing })
    data[key] = value
  }

  const exportedAt = typeof parsed.exportedAt === 'string' ? parsed.exportedAt : ''
  const appVersion = typeof parsed.appVersion === 'string' ? parsed.appVersion : ''
  return {
    ok: true,
    backup: {
      app: typeof parsed.app === 'string' ? parsed.app : appConfig.name,
      kind: BACKUP_KIND,
      schemaVersion: version,
      appVersion,
      exportedAt,
      data,
    },
    unknownModules,
    idless,
  }
}

/** 单块合并结果：added 追加、replaced 覆盖、kept 保持不变 */
interface MergedArray {
  items: unknown[]
  added: number
  replaced: number
}

/**
 * 按 id 合并两份列表（**备份为准**）：
 * - 两边都有同一 id → 用备份里的那条（replaced）；
 * - 只在备份里有 → 追加到末尾（added，保持当前数据的原有顺序在前）；
 * - 只在当前有 → 原样保留（kept）——合并**从不删除**当前数据。
 * 备份文件内部若有重复 id，只保留最后一条（与 Map 语义一致，避免把重复写进本机）；
 * 没有 id 的条目比不上对，一律追加到末尾（计为 added）——宁可重复一条，也不丢。
 */
function mergeById(current: unknown[], incoming: unknown[]): MergedArray {
  const incomingById = new Map<string, unknown>()
  const idless: unknown[] = []
  for (const item of incoming) {
    const id = idOf(item)
    if (id === null) idless.push(item)
    else incomingById.set(id, item)
  }
  const currentIds = new Set<string>()
  let replaced = 0
  const items = current.map((item) => {
    const id = idOf(item)
    if (id === null) return item
    currentIds.add(id)
    const replacement = incomingById.get(id)
    if (replacement === undefined) return item
    replaced += 1
    return replacement
  })
  let added = 0
  for (const [id, item] of incomingById) {
    if (currentIds.has(id)) continue
    items.push(item)
    added += 1
  }
  items.push(...idless)
  added += idless.length
  return { items, added, replaced }
}

/** 单块合并统计（导入预览逐块展示「新增 N 条 / 覆盖 N 条 / 保持不变 N 条」） */
export interface MergeStat {
  label: string
  unit: string
  added: number
  replaced: number
  kept: number
}

export interface MergePlan {
  /** 待写回的键 → 值（只含备份里出现过的块，未出现的块原样不写） */
  writes: Record<string, string>
  stats: MergeStat[]
}

/**
 * 计算合并结果（纯函数，不写盘）：调用方先展示 stats 让教师确认，确认后再 applyWrites。
 * 备份里没有的数据块不参与合并，当前数据保持不变。
 * skipLabels：本机读取异常的数据块（readModules 的 broken）——**这些块绝不写盘**，
 * 免得用备份覆盖掉还能人工找回的原文；它们也不进 stats，由调用方单独向教师说明。
 */
export function planMerge(
  current: Record<string, unknown[]>,
  backup: BackupFile,
  skipLabels: string[] = [],
): MergePlan {
  const writes: Record<string, string> = {}
  const stats: MergeStat[] = []
  for (const module of BACKUP_MODULES) {
    if (skipLabels.includes(module.label)) continue
    const incoming = backup.data[module.key]
    if (incoming === undefined) continue
    const items = current[module.key] ?? []
    const merged = mergeById(items, incoming as unknown[])
    writes[module.key] = JSON.stringify(merged.items)
    stats.push({
      label: module.label,
      unit: module.unit,
      added: merged.added,
      replaced: merged.replaced,
      kept: items.length - merged.replaced,
    })
  }
  return { writes, stats }
}

/** 单条被删记录的展示名上限（确认弹窗给教师核对用；超出部分由界面显示「等 N 条」） */
export const CLEAR_NAME_LIMIT = 8

export interface ClearPlan {
  /** 键 → 要写回的新值；**null = 删除该键**（旧课表键被清空时删键，不留下空数组） */
  writes: Record<string, string | null>
  /** 逐块移除条数（0 的块不展示）；names 为待删记录的展示名（最多 CLEAR_NAME_LIMIT 条，供核对） */
  removed: { label: string; unit: string; count: number; names: string[] }[]
}

/**
 * 单条记录的展示名（确认弹窗列名单用）。
 * 原始数据**没经过 store 校验**，字段可能缺、类型可能不对，所以一律防御式取值，
 * 认不出就给一句占位说明——名单宁可难看，也不能因为一条脏数据让确认弹窗崩掉。
 */
function describeItem(key: string, item: unknown): string {
  if (!isPlainObject(item)) return '（无法识别的一条记录）'
  const textOf = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value : '')
  if (key === STUDENT_KEY) return textOf(item.name) || '（未填写姓名的学生）'
  // 旧课表键沿用同一套描述：旧条目同样有 weekday / period / subject
  if (key === TIMETABLE_KEY || key === LEGACY_TIMETABLE_KEY) {
    const weekday = typeof item.weekday === 'number' ? item.weekday : 0
    const period = typeof item.period === 'number' ? item.period : 0
    return `周${weekday} 第 ${period} 节 ${textOf(item.subject) || '未填写科目'}`
  }
  if (key === TODO_KEY) return textOf(item.text) || '（无内容待办）'
  if (key === LEAVE_KEY) {
    return textOf(item.studentName) || textOf(item.studentId) || '（未记录学生）'
  }
  if (key === DUTY_KEY) {
    if (item.kind === 'settings') return '轮换设置'
    return textOf(item.name) || '（未命名的值日组）'
  }
  return '一条记录'
}

/**
 * 某数据块内「属于示例数据」的判定。
 * 学生 / 课程 / 待办 / 请假看 id 的示例前缀；座位约束的 id 是 UUID，
 * 要看它**引用的学生**是不是示例学生（被删示例学生的约束会变成脏引用）。
 */
function samplePredicate(key: string, sampleStudentIds: Set<string>): (item: unknown) => boolean {
  if (key === DUTY_KEY) {
    // 值日数组里混着「轮换设置」这条非示例记录（id 也以 duty- 开头），只对值日组认前缀
    return (item) => {
      const id = idOf(item)
      return isPlainObject(item) && item.kind === 'group' && id !== null && isSampleRecordId(id)
    }
  }
  if (key === CONSTRAINT_KEY) {
    return (item) => {
      if (!isPlainObject(item)) return false
      const a = item.studentA
      const b = item.studentB
      return (
        (typeof a === 'string' && sampleStudentIds.has(a)) ||
        (typeof b === 'string' && sampleStudentIds.has(b))
      )
    }
  }
  return (item) => {
    const id = idOf(item)
    return id !== null && isSampleRecordId(id)
  }
}

/**
 * 计算「清空示例数据」的结果（纯函数，不写盘）：
 * - 学生 / 课程 / 待办 / 请假 / 值日组：删掉 id 带示例前缀的记录（`utils/id.ts` 的 isSampleRecordId）；
 *   值日的**轮换设置不是示例数据，保留**（它只记「哪天起轮到哪个组」，与示例学生无关）；
 * - 座位约束：删掉引用了被删示例学生的条目——座位由 seat store 的启动清扫释放，但那次清扫
 *   只在打开「座位表」时执行；约束 store 的删除监听**不是** immediate 的，跨会话的清空它
 *   看不到，会留下脏引用，所以必须在这里显式清；
 * - 座位方案：不动。方案里空出来的座位于**下次打开「座位表」时**由 seat store 的启动清扫释放
 *   （Phase 3B 既有能力），换座日志 / 请假记录是历史，保留姓名快照（与「删除学生记录保留」同一口径）。
 * - 旧键（`legacy`，见 LEGACY_CLEAR_MODULES）：同样**只删其中的示例条目**，一条不剩才删键——
 *   旧课表键还在就说明当年有课文没能迁移过去，那些原文是教师唯一的退路，不能整键抹掉。
 *
 * 注意：示例与否**只看 id 前缀**，所以被教师就地改成真实内容的示例记录也会被删——
 * 确认弹窗因此必须列出名单（removed[].names）并写明这一点，不能只说「你自己录入的不受影响」。
 */
export function planClearSamples(
  current: Record<string, unknown[]>,
  legacy: Record<string, unknown[]> = {},
): ClearPlan {
  const writes: Record<string, string | null> = {}
  const removed: ClearPlan['removed'] = []

  // 第一遍：找出被删的示例学生（座位释放与约束清理都要用）
  const sampleStudentIds = new Set<string>()
  for (const item of current[STUDENT_KEY] ?? []) {
    const id = idOf(item)
    if (id !== null && isSampleRecordId(id)) sampleStudentIds.add(id)
  }

  // 第二遍：逐块算出保留项；块内一条都没删就不写回（避免无意义的写盘）
  for (const module of BACKUP_MODULES) {
    const items = current[module.key]
    if (items === undefined) continue
    // 座位方案不动：空出来的座位由下次打开座位表时的启动清扫释放，换座日志是历史
    if (module.key === SEAT_PLAN_KEY) continue
    const isSample = samplePredicate(module.key, sampleStudentIds)
    const kept = items.filter((item) => !isSample(item))
    if (kept.length === items.length) continue
    const removedItems = items.filter((item) => isSample(item))
    writes[module.key] = JSON.stringify(kept)
    removed.push({
      label: module.label,
      unit: module.unit,
      count: removedItems.length,
      names: removedItems.slice(0, CLEAR_NAME_LIMIT).map((item) => describeItem(module.key, item)),
    })
  }

  // 第三遍：旧键只删其中的示例条目，一条不剩时才删键——旧键不是活数据，没有 store 会在重载时
  // 因缺键播种；七个数据块相反（整块清空要写 `[]`，删键会让 seed-on-null 把示例数据又种回来）。
  for (const module of LEGACY_CLEAR_MODULES) {
    const items = legacy[module.key]
    if (items === undefined) continue
    const isSample = samplePredicate(module.key, sampleStudentIds)
    const kept = items.filter((item) => !isSample(item))
    if (kept.length === items.length) continue
    const removedItems = items.filter((item) => isSample(item))
    writes[module.key] = kept.length > 0 ? JSON.stringify(kept) : null
    removed.push({
      label: module.label,
      unit: module.unit,
      count: removedItems.length,
      names: removedItems.slice(0, CLEAR_NAME_LIMIT).map((item) => describeItem(module.key, item)),
    })
  }
  return { writes, removed }
}

/* ---------- 写盘（唯一出口，全部可注入，便于自检脚本替换） ---------- */

/** 本机存储端口（实现即 window.localStorage，自检脚本用内存 Map 顶替） */
export interface StoragePort {
  read(key: string): string | null
  write(key: string, value: string): void
  remove(key: string): void
  /** 列出全部键（清空全部数据用；需覆盖本模块不认识的历史 / 未来键，不能写死键名） */
  list(): string[]
}

export type CommitOutcome =
  | { ok: true; count: number }
  /** rolledBack=false 表示连还原都失败了，本机数据可能停在半截状态——界面必须如实相告 */
  | { ok: false; rolledBack: boolean; error: unknown }

interface CommitOp {
  key: string
  /** null = 删除该键 */
  value: string | null
}

function applyOp(op: CommitOp, storage: StoragePort): void {
  if (op.value === null) storage.remove(op.key)
  else storage.write(op.key, op.value)
}

/**
 * 逐键执行写入 / 删除，任一步失败就**整批还原**到操作前。
 * 没有它，界面只能在失败时对教师说「数据未改变」——而实际上前几个键已经落盘，
 * 那是假话；而本机内存里的 store 还停在旧值，教师下次编辑就会把旧值整份写回，
 * 状态会变得难以预料。
 */
function commitAtomically(ops: CommitOp[], storage: StoragePort): CommitOutcome {
  const snapshots: CommitOp[] = []
  let applied = 0
  try {
    for (const op of ops) {
      snapshots.push({ key: op.key, value: storage.read(op.key) })
      applyOp(op, storage)
      applied += 1
    }
    return { ok: true, count: applied }
  } catch (error) {
    // 失败的那一条也还原（它可能已经写进去了），故多还原一个快照
    const restoreCount = Math.min(applied + 1, snapshots.length)
    let rolledBack = true
    for (let index = 0; index < restoreCount; index += 1) {
      const snapshot = snapshots[index]
      if (snapshot === undefined) continue
      try {
        applyOp(snapshot, storage)
      } catch {
        // 还原也失败（多半是存储彻底写不进去）：如实标记，交给界面提示教师
        rolledBack = false
      }
    }
    return { ok: false, rolledBack, error }
  }
}

/** 写回合并 / 清空示例的结果（值 `null` = 删除该键）；失败时自动还原这一批已写入的键 */
export function applyWrites(
  writes: Record<string, string | null>,
  storage: StoragePort,
): CommitOutcome {
  const ops = Object.entries(writes).map(([key, value]) => ({ key, value }))
  return commitAtomically(ops, storage)
}

/**
 * 清空全部数据：删掉本应用前缀下的所有键（含 lastBackupAt 与未来的新键）。
 * 键名不能写死——用「列出全部键再筛前缀」的方式，才能连本模块不认识的数据一起清干净。
 * 清空后重载，各 store 因键不存在而重新播种，回到首次打开的状态。
 */
export function clearAllKeys(
  storage: StoragePort,
  prefix: string = appConfig.storageKeyPrefix,
): CommitOutcome {
  const targets = storage.list().filter((key) => key.startsWith(`${prefix}:`))
  return commitAtomically(
    targets.map((key) => ({ key, value: null })),
    storage,
  )
}

/* ---------- 备份提醒（稳定性增量，2026-09-11） ---------- */

/** 距上次导出达到这个天数就在工作台提示（导出后自动消失） */
export const BACKUP_REMINDER_DAYS = 14

export type BackupReminder =
  | { level: 'none' }
  | { level: 'never'; text: string }
  | { level: 'due'; days: number; text: string }

/**
 * 两个时间相差几个**自然日**（各取本地年月日 → `Date.UTC` 天序号）。
 * 不拿毫秒数直接除：那样「昨天下午导出、今天早上打开」算出来是 0 天，
 * 夏令时切换那天还会差一小时；转成日历天序号后比较，跨月 / 跨年 / 跨时区都正确
 * （与请假时长 `halfDayKey` 同一手法，见开发手册 §9.11 的教训）。
 */
function daysBetween(from: Date, to: Date): number {
  const start = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const end = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((end - start) / 86_400_000)
}

/**
 * 备份提醒状态（纯函数，不读存储、不看时间以外的任何状态）：
 * - 从未导出（键不存在 / 值不是合法时间）→ `never`：一直提示，导出后自动消失；
 * - 距上次导出达到 BACKUP_REMINDER_DAYS → `due`：文案带上天数；
 * - 其余 → `none`：不打扰。
 *
 * **只提醒、不代劳**：不自动导出、不写任何键（稳定性增量拍板口径）。
 * 判定只看「上次导出时间」，不感知数据有没有改过——那需要给七个 store 的写盘路径插桩，
 * 收益不抵风险（开发计划 §五 #7）。
 */
export function backupReminder(lastBackupAt: string, now: Date): BackupReminder {
  const last = lastBackupAt ? new Date(lastBackupAt) : null
  if (!last || Number.isNaN(last.getTime())) {
    // 说清后果，不说「本机」「缓存」这类词：数据在哪、丢了会怎样，教师一眼要能读懂
    return { level: 'never', text: '还没有导出过备份，数据只保存在这台设备上。' }
  }
  const days = daysBetween(last, now)
  if (days < BACKUP_REMINDER_DAYS) return { level: 'none' }
  // 醒目态也把后果写出来：只说「建议导出」等于只给了个数字，教师不知道不导出会怎样
  return {
    level: 'due',
    days,
    text: `距上次导出已 ${days} 天，数据仍只在这台设备上，建议导出备份。`,
  }
}

/** 触发浏览器下载（与 utils/seatExport.ts 的 downloadPng 同一手法；用 Blob 而非 dataURL，避免大文件撑爆地址栏） */
export function downloadJson(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  // 立刻 revoke 有概率打断下载，放到下一个宏任务再回收（与 seatExport 的 downloadPng 同处理）
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
