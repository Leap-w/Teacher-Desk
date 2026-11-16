/**
 * 学生照片「按文件名批量导入」的纯逻辑（v3.8.2 · Phase 2）。
 *
 * ## 隐私红线（先读这段再改代码）
 *
 * 文件名里带的是**完整身份证号**，而本项目 `Student` **没有**完整身份证号字段，
 * `idCardSuffix` 虽然字段名叫「尾号」，`normalizeStudent` 却按 `slice(0, 4)` 取**前 4 位**存，
 * 历史语义不可靠（见 `utils/student.ts`）。因此这里对身份证号的处理只有一条原则：
 *
 * - 完整身份证号只是 `parsePhotoFileName()` 内部的**瞬时解析产物**；
 * - **不参与学生匹配**（只用姓名 + 在读名册），因此既不声称「已核验」，也不会错挂；
 * - 不写进任何会展示 / 持久化 / 落日志 / 进错误提示的结构；
 * - 预览里的文件名**两条路径都脱敏**：解析成功走 `maskPhotoDisplayName()`（结构化重建），
 *   解析失败走 `maskIdNumberInFileName()`（对原始名按身份证号格式脱敏）——共用掩码 `ID_MASK`。
 *
 * 本文件**没有** `console.*`，也不引用任何日志通道——这是隐私测试会钉死的点。
 *
 * ## 匹配原则
 *
 * 宁可要求教师人工确认，也不能把照片错误关联到别的学生：
 * - 姓名唯一命中在读学生 → 候选（`ready`），但提示「身份证号未核验」；
 * - 重名 / 查无此人 → 拦在预览阶段，必须教师人工指定归属（`need-choice`）；
 * - 已退档（软删）学生不在 `activeStudents` 里，既不会被自动命中，也不会进人工候选；
 * - 班级段必须与 `DEFAULT_CLASSROOM_CONFIG` 的班级号一致，否则 `blocked-class`。
 *
 * ## 本层不做什么
 *
 * 不碰 Store / localStorage / IndexedDB / 云端 / 图片处理；
 * 只产出「计划」与「串行编排」，真正的写入由调用方把 `addOne` 回调接进 Phase 1 的 Store。
 */
import { DEFAULT_CLASSROOM_CONFIG } from '@/types/classroom'
import type { Student } from '@/types'
import type { StudentPhoto, StudentPhotoCategory } from '@/types/studentPhoto'
import { formatStudentShortName } from '@/utils/student'
import {
  runPhotoUploadBatch,
  summarizePhotoUploadBatch,
  type PhotoUploadBatchResult,
  type PhotoUploadItem,
} from '@/utils/photoUi'

/* ==================== 文件名解析 ==================== */

/** 允许的图片扩展名（小写，匹配时不区分大小写） */
export const PHOTO_IMPORT_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'] as const

/** 文件名里能标记的类型词 → 落库分类（未标记时留空，交给 Store 自动分类） */
const CATEGORY_WORDS: Readonly<Record<string, StudentPhotoCategory>> = {
  证件照: 'id-photo',
  生活照: 'life-photo',
}

/** 身份证号格式：15 位老号，或 18 位（17 位数字 + 数字/X 校验位） */
const ID_NUMBER_RE = /^(?:\d{15}|\d{17}[\dXx])$/

/** 分隔符：半角 / 全角连字符、破折号、空白（姓名中间的连字符也属这一类） */
const SEP = '[-－—–─\\s]'

export interface ParsedPhotoFileName {
  /** 班级段原文（如 `9班`） */
  className: string
  /** 姓名（可含连字符，已去掉两侧空白） */
  studentName: string
  /**
   * 完整身份证号 —— **瞬时值**：仅用于解析校验，调用方不得展示 / 持久化 / 写日志。
   * `buildPhotoImportPlan()` 不会把它带进任何计划行。
   */
  idNumber: string
  /** 文件名显式标记的分类；无类型后缀时为 `undefined` */
  category?: StudentPhotoCategory
  /** 去除点号、转小写后的扩展名 */
  extension: string
}

export type PhotoFileNameParse =
  { ok: true; parsed: ParsedPhotoFileName } | { ok: false; error: string }

/** 去掉路径前缀，只留文件名（防止粘贴进来的是 `/tmp/x/9班-...jpg`） */
function baseNameOf(name: string): string {
  const parts = name.split(/[\\/]/)
  return parts[parts.length - 1] ?? name
}

/**
 * 解析 `9班-姓名-身份证号[-证件照|生活照].扩展名`。
 *
 * 姓名里允许有连字符：先按末尾剥离类型后缀，再用**右侧固定格式**的身份证号定位切分点，
 * 左边第一段是班级、中间整段（含连字符）是姓名——不做 `split('-')` 按位取段。
 */
export function parsePhotoFileName(rawName: string): PhotoFileNameParse {
  const name = baseNameOf(rawName.trim())
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) {
    return { ok: false, error: '文件名缺少图片扩展名' }
  }
  const extension = name.slice(dot + 1).toLowerCase()
  if (!PHOTO_IMPORT_EXTENSIONS.includes(extension as (typeof PHOTO_IMPORT_EXTENSIONS)[number])) {
    return { ok: false, error: '不是支持的图片格式（仅 jpg / jpeg / png / webp）' }
  }

  // 全角 / 破折号连字符归一化为半角，空格保留（SEP 会一起处理）
  let stem = name
    .slice(0, dot)
    .replace(/[－—–─]/g, '-')
    .trim()

  // 1) 末尾剥离类型词；只认「证件照 / 生活照」，其它末尾词一律留给姓名/身份证去判错
  let category: StudentPhotoCategory | undefined
  const typed = new RegExp(`^(.+)${SEP}+(证件照|生活照)$`).exec(stem)
  if (typed) {
    stem = typed[1]!.trim()
    category = CATEGORY_WORDS[typed[2]!]
  }

  // 2) 宽松拆成 班级 / 姓名 / 末段；姓名贪婪，故中间连字符都归姓名
  const parts = new RegExp(`^(.+?)${SEP}+(.+)${SEP}+([^\\s-]+)$`).exec(stem)
  if (!parts) {
    return {
      ok: false,
      error: '文件名格式不正确，应为：班级-姓名-身份证号[-证件照|生活照]',
    }
  }
  const className = parts[1]!.trim()
  const studentName = parts[2]!.trim()
  const idNumber = parts[3]!.trim()
  if (!className || !studentName) {
    return { ok: false, error: '班级或姓名为空，无法识别这张照片属于谁' }
  }
  if (!ID_NUMBER_RE.test(idNumber)) {
    return { ok: false, error: '身份证号格式不正确（应为 15 位或 18 位）' }
  }

  return { ok: true, parsed: { className, studentName, idNumber, category, extension } }
}

/** 身份证号在展示字段里的统一掩码（解析成功 / 失败两条路径共用，避免两套规则） */
const ID_MASK = '****'

/**
 * 原始文件名脱敏（**解析失败路径专用**）：把其中符合身份证号格式的片段替换为 `ID_MASK`。
 *
 * 为什么不能只靠 `maskPhotoDisplayName`：那条只在解析成功、拿到结构化字段时才走得到；
 * 文件名格式错误（如类型词写错、段数不对、班级段带脏字符）时，`displayName` 原本直接取
 * 原始文件名，完整身份证号就会明文进预览表 / 人工指定区 / 移除区。
 *
 * 识别规则（避免"全局替换所有连续数字"误伤班级号 / 序号）：
 * - 18 位：`\d{17}[\dXx]`，末位数字或 X/x 均可，优先匹配（放在 15 位之前，避免先截前 15 位）；
 * - 15 位：`\d{15}`；
 * - **边界**：号码前后必须是非字母数字或字符串边界——前后各用一个捕获组保留原字符，
 *   用 `$1` 回填；这样前后紧挨字母 / 数字的长串（如 `班9班`、`abc123…`）不会被截断误伤。
 * - 只替换号码本身，其余部分（班级、姓名、类型词、扩展名）原样保留，便于教师识别文件。
 *
 * 本函数不写日志、不产生除返回字符串外的任何副作用。
 */
export function maskIdNumberInFileName(rawName: string): string {
  return rawName.replace(
    /(^|[^0-9A-Za-z])(\d{17}[\dXx]|\d{15})(?=$|[^0-9A-Za-z])/g,
    (_match, leading: string) => `${leading}${ID_MASK}`,
  )
}

/** 预览展示用文件名（解析成功）：结构化重建，身份证段替换为掩码，其余照常显示 */
export function maskPhotoDisplayName(parsed: ParsedPhotoFileName): string {
  const typeText = parsed.category ? (parsed.category === 'id-photo' ? '证件照' : '生活照') : ''
  const tail = typeText ? `-${typeText}` : ''
  return `${parsed.className}-${parsed.studentName}-${ID_MASK}${tail}.${parsed.extension}`
}

/* ==================== 班级校验 ==================== */

/** 班级配置（唯一事实来源）里的班级号，如「高一9班」→「9」 */
export function configuredClassNumber(): string | undefined {
  return /(\d+)/.exec(DEFAULT_CLASSROOM_CONFIG.name)?.[1]
}

/** 文件名班级段是否指向当前班级。班级段没有可比对的数字时按「无法确认」处理 */
export function classMatchesConfig(className: string): boolean {
  const fromName = /(\d+)/.exec(className)?.[1]
  const expected = configuredClassNumber()
  return Boolean(fromName && expected && fromName === expected)
}

/* ==================== 预览计划 ==================== */

/** 一行的处理状态（同时作为 ImportPreviewTable 的 action 键） */
export type PhotoImportAction =
  | 'ready' // 姓名唯一命中，可导入
  | 'need-choice' // 重名 / 查无此人，需教师人工指定
  | 'blocked-name' // 文件名无法解析
  | 'blocked-class' // 班级不符
  | 'imported' // 已成功保存
  | 'failed' // 保存失败（可重试）

/** 计划里的一行。注意：**没有**任何完整身份证号字段。 */
export interface PhotoImportRow {
  /** 稳定内部 id（文件选择顺序，1 起） */
  id: string
  /** 内存中的原文件；仅供上传，绝不展示其 name 原文、不序列化 */
  file: File
  /** 脱敏后的文件名（预览列用） */
  displayName: string
  className: string
  studentName: string
  /** 分类文案（`证件照` / `生活照` / `自动`） */
  categoryText: string
  /** 显式分类；`undefined` = 交给 Store 自动分类 */
  category?: StudentPhotoCategory
  action: PhotoImportAction
  /** 已确认的最终归属学生 id；只有 action ∈ {ready, imported} 时非空 */
  studentId?: string
  /** 预览展示的最终归属（用消歧后的短名） */
  displayStudent?: string
  /** 需要人工选择时的候选学生（重名 → 同名候选；查无此人 → 全部在读） */
  candidates: readonly Student[]
  errors: string[]
  warnings: string[]
  /** 该生同名分类已有照片数（预览提醒，不覆盖） */
  existingCount: number
  /** 导入成功后的照片 id（重试去重 / 结果核对用） */
  photoId?: string
}

export interface PhotoImportPlan {
  rows: PhotoImportRow[]
  /** 可导入行数（action=ready） */
  readyCount: number
  /** 需人工选择行数 */
  needChoiceCount: number
  /** 被拦下行数 */
  blockedCount: number
}

export interface PlanPhotoImportOptions {
  /** 在读名册（已排除软删学生） */
  activeStudents: readonly Student[]
  /** 姓名计数（用于生成消歧短名，与全站同一份 `buildNameCounts`） */
  nameCounts: ReadonlyMap<string, number>
  /** 已有有效照片（用于「已有 N 张」提醒） */
  existingPhotos: readonly StudentPhoto[]
}

/** 消歧短名：全站唯一规则，不在导入层另造 */
function shortNameOf(student: Student, nameCounts: ReadonlyMap<string, number>): string {
  return formatStudentShortName(student, nameCounts)
}

/**
 * 由选中的文件构建预览计划。完整身份证号在这里被彻底丢弃——
 * 返回的每一行都只带脱敏文件名，不带任何可回溯到身份证号的字段。
 */
export function buildPhotoImportPlan(
  files: readonly File[],
  options: PlanPhotoImportOptions,
): PhotoImportPlan {
  const shortName = (student: Student) => shortNameOf(student, options.nameCounts)
  const rows: PhotoImportRow[] = files.map((file, index) => {
    const base: PhotoImportRow = {
      id: String(index + 1),
      file,
      // 解析失败时也会展示这个字段（预览 / 人工指定 / 移除区），先按身份证号格式脱敏；
      // 解析成功时下面会用 maskPhotoDisplayName 覆盖成结构化重建的展示名。
      displayName: maskIdNumberInFileName(baseNameOf(file.name)),
      className: '',
      studentName: '',
      categoryText: '自动',
      action: 'blocked-name',
      candidates: [],
      errors: [],
      warnings: [],
      existingCount: 0,
    }

    const parsed = parsePhotoFileName(file.name)
    if (!parsed.ok) {
      return { ...base, errors: [parsed.error] }
    }
    const { parsed: info } = parsed
    // 只用脱敏文件名，info.idNumber 到此为止，不再传给任何行
    const row: PhotoImportRow = {
      ...base,
      displayName: maskPhotoDisplayName(info),
      className: info.className,
      studentName: info.studentName,
      category: info.category,
      categoryText: info.category ? (info.category === 'id-photo' ? '证件照' : '生活照') : '自动',
      action: 'blocked-class',
    }

    if (!classMatchesConfig(info.className)) {
      return {
        ...row,
        errors: [`班级「${info.className}」与当前班级（${DEFAULT_CLASSROOM_CONFIG.name}）不符`],
      }
    }

    // 唯一的匹配依据：姓名 + 在读名册。身份证号不参与，绝不声称「已核验」。
    // 这里再滤一次软删学生：宁可多一道防线，也不让已退档者被误关联。
    const active = options.activeStudents.filter((student) => !student.deletedAt)
    const sameName = active.filter((student) => student.name === info.studentName)
    const unverified = '身份证号未核验：请核对照片是否属于该学生'
    if (sameName.length === 0) {
      return {
        ...row,
        action: 'need-choice',
        candidates: active,
        errors: [`在读名册中找不到「${info.studentName}」，请人工指定归属`],
        warnings: [unverified],
      }
    }
    if (sameName.length > 1) {
      return {
        ...row,
        action: 'need-choice',
        candidates: sameName,
        errors: [`有 ${sameName.length} 位同名学生，必须人工指定归属`],
        warnings: [unverified],
      }
    }

    const student = sameName[0]!
    const existingCount = options.existingPhotos.filter((photo) => {
      if (photo.studentId !== student.id || photo.deletedAt) return false
      return info.category ? photo.category === info.category : true
    }).length
    const warnings = [unverified]
    if (existingCount > 0) {
      warnings.push(
        `该生已有 ${existingCount} 张${row.categoryText === '自动' ? '' : row.categoryText}照片，本次为新增，不覆盖旧照片`,
      )
    }
    return {
      ...row,
      action: 'ready',
      studentId: student.id,
      displayStudent: shortName(student),
      existingCount,
      warnings,
    }
  })

  return {
    rows,
    readyCount: rows.filter((row) => row.action === 'ready').length,
    needChoiceCount: rows.filter((row) => row.action === 'need-choice').length,
    blockedCount: rows.filter(
      (row) => row.action === 'blocked-name' || row.action === 'blocked-class',
    ).length,
  }
}

/**
 * 教师为某行人工指定归属：写入最终学生，行进入 `ready`。
 * 纯函数——返回新数组，不改入参。只接受在读学生（软删学生传进来会被拒绝）。
 */
export function chooseImportStudent(
  rows: readonly PhotoImportRow[],
  rowId: string,
  student: Student | undefined,
  nameCounts: ReadonlyMap<string, number> = new Map(),
): PhotoImportRow[] {
  if (!student || student.deletedAt) return [...rows]
  return rows.map((row) => {
    if (row.id !== rowId || (row.action !== 'need-choice' && row.action !== 'ready')) return row
    // 人工指定时该行原本就是 need-choice（existingCount=0），只落归属与消歧短名。
    return {
      ...row,
      action: 'ready',
      studentId: student.id,
      displayStudent: formatStudentShortName(student, nameCounts),
      candidates: [],
      errors: [],
    }
  })
}

/** 从预览中移除若干行（教师不想导入的文件） */
export function removeImportRows(
  rows: readonly PhotoImportRow[],
  ids: readonly string[],
): PhotoImportRow[] {
  const removed = new Set(ids)
  return rows.filter((row) => !removed.has(row.id))
}

/* ==================== 串行导入编排 ==================== */

export interface PhotoImportExecuteOptions {
  /** 每开始一张前检查；返回 true 则停止（已成功的不会回滚） */
  shouldCancel?: () => boolean
  onProgress?: (done: number, total: number) => void
}

export interface PhotoImportExecution {
  /** 更新后的行（含导入成功 / 失败状态与 photoId） */
  rows: PhotoImportRow[]
  /** 成功数 / 失败数 / 是否取消（本地保存口径，不代表云端已同步） */
  success: number
  failed: number
  cancelled: boolean
  /** 失败行的可见原因（用脱敏文件名，不含身份证号） */
  failedRows: { displayName: string; error?: string }[]
  batch: PhotoUploadBatchResult
}

/**
 * 串行导入（一张一张），复用 `runPhotoUploadBatch` 的稳健语义：
 * - 单张失败不中断其它张；取消只影响尚未开始的文件；
 * - `addOne` 由调用方接到 Phase 1 的 `store.addPhoto(studentId, file, category)`，
 *   **串行**保证了「无类型照片」的自动分类按写入顺序正确级联。
 *
 * `addOne` 失败原因由调用方提供，这里不拼接文件名原文（文件名已是脱敏的 displayName）。
 */
export async function executePhotoImport(
  rows: readonly PhotoImportRow[],
  addOne: (row: PhotoImportRow) => Promise<{ photoId: string }>,
  options: PhotoImportExecuteOptions = {},
): Promise<PhotoImportExecution> {
  const ready = rows.filter((row) => row.action === 'ready' && row.studentId)
  const items: PhotoUploadItem[] = ready.map((row) => ({
    fileName: row.displayName,
    file: row.file,
  }))
  const rowOfItem = new Map<PhotoUploadItem, PhotoImportRow>(
    items.map((item, index) => [item, ready[index]!]),
  )

  const batch = await runPhotoUploadBatch(
    items,
    async (item) => addOne(rowOfItem.get(item)!),
    options,
  )
  const summary = summarizePhotoUploadBatch(batch)

  // 结果按行 id 回填；只改结果行，绝不新建/改动未参与导入的行
  const resultById = new Map(batch.results.map((result, index) => [ready[index]!.id, result]))
  const updated = rows.map((row) => {
    const result = resultById.get(row.id)
    if (!result) return row
    return result.ok
      ? { ...row, action: 'imported' as const, photoId: result.photoId }
      : { ...row, action: 'failed' as const, errors: [result.error ?? '保存失败'] }
  })

  return {
    rows: updated,
    success: summary.success,
    failed: summary.failed,
    cancelled: summary.cancelled,
    failedRows: summary.failedFiles.map((item) => ({
      displayName: item.fileName,
      error: item.error,
    })),
    batch,
  }
}
