import { ALL_DORMITORIES, FAMILY_SCOPE_LABELS, isValidDormitory } from '@/utils/student'
import type { FamilyLocation, FamilyScope, Gender, Student, StudentInput } from '@/types'
import { cellText, isBlankRow, normalizeHeader } from '@/services/sheetCell'

/* ==========================================================================
 * Excel 批量导入（Phase 5A）
 *
 * 刻意切成两层：
 *   ① readSheetRows —— 目前唯一碰 xlsx 与浏览器 File 的地方，只负责「字节 → 二维数组」。
 *   ② parseStudentRows / planStudentImport —— 纯函数，不碰 xlsx、不碰 DOM。
 * 分流规则、异常判定、字段覆盖口径全在 ②，所以它们能在 node 环境的常驻自检里
 * 直接被喂一堆数组来跑（本仓库不装 jsdom，见 vitest.config.ts）。
 * 规则若写进 ①，就只能在浏览器里点着试——那正是导入功能最容易出错的地方。
 * ========================================================================== */

/** 一行数据在文件里的位置与原始内容 */
export interface ParsedRow {
  /** Excel 里的实际行号（1 起，含表头行）——预览里要给教师看「第几行」，必须能在表里对上 */
  rowNumber: number
  name: string
  gender: Gender | ''
  studentNo: string
  /** 身份证尾号（选填，最多 4 位）：重名消歧用（v3.3.1） */
  idCardSuffix: string
  dormitory: string
  cadreRole: string
  tags: string[]
  phone: string
  /** 备注（v3.5.0）。档案页有「有备注」筛选、检索也吃这个字段，所以它必须能导入 */
  remark: string
  /** 所属地区（地级市 / 地区，如「昌都市」）——与表单里的「所属地区」同一个字段（v3.5.0） */
  prefecture: string
  /** 所属县 / 区（如「卡若区」）——与表单里的「所属县/区」同一个字段（v3.5.0） */
  county: string
  familyAddress: string
  scope: FamilyScope | ''
  /** 拦截原因：非空表示这一行不会入库 */
  errors: string[]
  /** 提示：不拦截，只是让教师知道 */
  warnings: string[]
  /**
   * 原文件里写了宿舍、但不合法（已置空）。**结构化标记而非靠 warnings 文本反查**——
   * 统计与文案是两件事，靠字符串去认，改一次文案就会让计数静默变成 0
   */
  dormitoryRejected: boolean
}

/** 表头识别结果：列下标，-1 表示没有这一列 */
interface ColumnMap {
  name: number
  gender: number
  studentNo: number
  idCardSuffix: number
  dormitory: number
  cadreRole: number
  tags: number
  phone: number
  remark: number
  prefecture: number
  county: number
  familyAddress: number
  scope: number
}

/**
 * 列名与常见别名的对应表。**先匹配到的列胜出**，所以顺序即优先级（也是模板列序）。
 *
 * v3.5.0 补齐三个原本只能在档案页手填的字段：**备注 / 所属地区 / 所属县·区**。
 * 之前它们只存在于 `StudentFormModal`，Excel 里没有对应列，于是「从 Excel 建一批档案」
 * 之后每个人都得再点开补一遍——导入的意义正好丢掉一半。
 * 「家庭住址」一并在这一版改叫「家庭地址」，与表单上的字段名对齐
 * （两个写法都在别名里，老文件照样认得出）。
 */
const COLUMN_ALIASES: Array<{ key: keyof ColumnMap; label: string; aliases: string[] }> = [
  { key: 'name', label: '姓名', aliases: ['姓名', '名字', '学生姓名'] },
  { key: 'gender', label: '性别', aliases: ['性别'] },
  { key: 'studentNo', label: '学号', aliases: ['学号', '学籍号', '考号'] },
  {
    key: 'idCardSuffix',
    label: '身份证尾号',
    // 只认「尾号」类的写法，**不收「身份证号」**：整串身份证号不是这个字段要的东西，
    // 收进来只会把 18 位号码截成 4 位存下，教师还以为存的是完整号码
    aliases: ['身份证尾号', '身份证后四位', '身份证后4位', '证件尾号', '尾号'],
  },
  { key: 'dormitory', label: '宿舍', aliases: ['宿舍', '宿舍号', '寝室', '房间'] },
  { key: 'cadreRole', label: '班委', aliases: ['班委', '职务', '班委职务', '班级职务'] },
  {
    key: 'phone',
    label: '联系电话',
    aliases: ['联系电话', '电话', '手机', '手机号', '家长电话', '联系方式'],
  },
  { key: 'tags', label: '标签', aliases: ['标签', '标记'] },
  { key: 'remark', label: '备注', aliases: ['备注', '说明', '备注说明'] },
  { key: 'scope', label: '返家范围', aliases: ['返家范围', '返家', '回家范围'] },
  {
    key: 'prefecture',
    label: '所属地区',
    // 与表单上的「所属地区」同一个字段。不收裸「市」：那个字太容易出现在无关列名里
    aliases: ['所属地区', '所在地区', '地区', '地级市', '所属市', '所在市'],
  },
  {
    key: 'county',
    label: '所属县/区',
    // 同表单上的「所属县/区」。不收裸「县」「区」——它们太短，撞上别的列名就悄悄存错地方
    aliases: ['所属县/区', '所属县区', '所属县市', '县/区', '县区', '区县', '所属县', '所属区'],
  },
  {
    key: 'familyAddress',
    label: '家庭地址',
    aliases: ['家庭地址', '家庭住址', '住址', '地址'],
  },
]

/**
 * 模板下载用的表头（v3.3.1）。
 * **从 `COLUMN_ALIASES` 的 label 派生，不另抄一份**——抄一份迟早会出现
 * 「模板上写着 A、识别器只认 B」这种「自家模板导不进自家系统」的事故。
 * 顺序即模板列序（必填的姓名 / 性别在最前，其余按录入习惯排）。
 */
export const STUDENT_IMPORT_HEADERS: readonly string[] = COLUMN_ALIASES.map(
  (column) => column.label,
)

/**
 * 必填列 —— 就是 `parseStudentRows` 里「缺了直接整体报错」的那两个字段。
 * 键名从别名表派生，文案才不会在改 label 时走样。
 */
const REQUIRED_KEYS: readonly (keyof ColumnMap)[] = ['name', 'gender']

export const STUDENT_IMPORT_REQUIRED: readonly string[] = COLUMN_ALIASES.filter((column) =>
  REQUIRED_KEYS.includes(column.key),
).map((column) => column.label)

/**
 * 选填列 = 模板表头 − 必填列。**派生，不另抄一份**：
 * v3.5.0 加了三列，正是「抄一份就必然漏掉」的那种改动（弹窗文案会悄悄少列一个字段，
 * 教师以为导入不了，又回去手填）。
 */
export const STUDENT_IMPORT_OPTIONAL: readonly string[] = STUDENT_IMPORT_HEADERS.filter(
  (header) => !STUDENT_IMPORT_REQUIRED.includes(header),
)

/**
 * 模板示例（v3.3.1 起，v3.5.0 随列一起扩到 13 列）。三行的取舍：
 * ① 一行女生、一行男生——宿舍按性别分列，示例里各举一间才说明得清；
 * ② 第一行**故意留空「备注」**、第二行**故意留空「身份证尾号」与「班委」**，
 *    让教师看见选填列可以空着（空着不等于清空既有值，这条口径见 `toPatch`）；
 * ③ 「标签」写成 `住校生,体育委员`——逗号分隔这件事光靠文字说明容易被忽略。
 * 学号与姓名沿用座位模板里的那两个（0101/0102），两份模板填起来是同一个班的故事。
 */
export const STUDENT_IMPORT_SAMPLE: readonly (readonly string[])[] = [
  [
    '旦增卓玛',
    '女',
    '0101',
    '3287',
    '女生2栋113',
    '班长',
    '13800000000',
    '住校生,体育委员',
    '',
    '昌都市区',
    '昌都市',
    '卡若区',
    '西藏自治区昌都市卡若区城关镇某村',
  ],
  [
    '扎西顿珠',
    '男',
    '0102',
    '',
    '男生1栋209',
    '',
    '13900000000',
    '住校生',
    '家长长期在外务工，由爷爷接送',
    '昌都市其他县',
    '昌都市',
    '江达县',
    '西藏自治区昌都市江达县岗托镇某村',
  ],
]

/** 性别列的各种写法 */
const GENDER_ALIASES: Record<string, Gender> = {
  男: 'male',
  男生: 'male',
  男性: 'male',
  m: 'male',
  male: 'male',
  女: 'female',
  女生: 'female',
  女性: 'female',
  f: 'female',
  female: 'female',
}

/**
 * 返家范围列的各种写法。正式文案从 `FAMILY_SCOPE_LABELS` 派生（**不重复抄一遍**，
 * 否则改了文案这里会静默失配），短写另行补充。
 */
const SCOPE_ALIASES: Record<string, FamilyScope> = {
  ...Object.fromEntries(
    Object.entries(FAMILY_SCOPE_LABELS).map(([code, label]) => [label, code as FamilyScope]),
  ),
  市区: 'changdu-city',
  其他县: 'changdu-county',
  其他: 'changdu-county',
  市外: 'outside-changdu',
  区外: 'outside-changdu',
  外地: 'outside-changdu',
}

/* ------------------------------------------------------------------ 第 1 层 */

export type ReadSheetResult =
  | { ok: true; rows: unknown[][]; sheetName: string; sheetCount: number }
  | { ok: false; error: string }

/**
 * 按文件头判断这到底是不是 Excel，把不属于它的东西挡在 xlsx 之前。
 *
 * **必须挡**：SheetJS 的 `read` 会自动嗅探 CSV，一份纯文本喂进去它照样「成功」——
 * 而且按 latin1 解码，`姓名` 变成 `å§å`。于是教师把从别处导出的 CSV 改名成 .xlsx 之后，
 * 得到的是一句「没有找到「姓名」列」，而表头明明写着「姓名」。错在格式，提示却指向内容，
 * 他会在表头上反复改也改不对。所以这里直接说清是什么问题。
 *
 * .xlsx 是 ZIP（`PK`），.xls 是 OLE2 复合文档（`D0 CF 11 E0`），两者都不是就拒收。
 */
function checkFileSignature(data: ArrayBuffer): string | undefined {
  if (data.byteLength === 0) return '文件是空的'
  if (data.byteLength < 4) return '文件不完整，读不出内容'
  const head = new Uint8Array(data, 0, 4)
  const isZip = head[0] === 0x50 && head[1] === 0x4b
  const isOle2 = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0
  if (isZip || isOle2) return undefined
  return '这不是 Excel 文件。若名单来自其他系统导出的 CSV / 文本，请先在 Excel 里「另存为」.xlsx 再导入'
}

/**
 * 读工作簿第一个工作表 → 二维数组。
 *
 * **`import('xlsx')` 是动态的**：xlsx 压缩后约 400 KB，而导入是低频操作。
 * 静态引入会把它塞进首屏包，让每次打开工作台都多等一段——首屏已经被
 * 「未压缩 + no-store」拖过一次（见开发手册遗留问题），不该再加码。
 *
 * `blankrows: true` 是刻意的：丢掉空行会让后面的行号整体前移，教师按预览里的
 * 「第 12 行」回 Excel 去找就对不上了。空行在这里保留、在 parseStudentRows 里跳过。
 * `raw: false` 让单元格按自身格式转成文本，学号 20230101 不会变成 2.0230101e7。
 */
export async function readSheetRows(data: ArrayBuffer): Promise<ReadSheetResult> {
  const signatureError = checkFileSignature(data)
  if (signatureError) return { ok: false, error: signatureError }

  let XLSX: typeof import('xlsx')
  try {
    XLSX = await import('xlsx')
  } catch {
    return { ok: false, error: '导入功能加载失败，请检查网络后刷新页面重试' }
  }

  try {
    const workbook = XLSX.read(data, { type: 'array' })
    const sheetName = workbook.SheetNames[0]
    if (!sheetName) return { ok: false, error: '这个文件里没有工作表' }
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: true,
    })
    return { ok: true, rows, sheetName, sheetCount: workbook.SheetNames.length }
  } catch {
    return {
      ok: false,
      error: '读取失败：文件可能已损坏，或者不是 Excel 的 .xlsx / .xls 格式',
    }
  }
}

/* ------------------------------------------------------------------ 第 2 层 */

function mapColumns(headerRow: unknown[]): ColumnMap {
  // 初始值从别名表派生。**不再手抄一份键名**：抄漏一个键，那一列的下标就是 `undefined`，
  // 而 `undefined !== -1` 成立 → 这一列永远认不出来，且不报错。
  // v3.5.0 加三列时正是靠这里少改一处。
  const map = {} as ColumnMap
  for (const column of COLUMN_ALIASES) map[column.key] = -1
  headerRow.forEach((cell, index) => {
    const text = normalizeHeader(cell)
    if (!text) return
    for (const column of COLUMN_ALIASES) {
      // 一个字段只认第一列（同一份表里「姓名」写两遍时，左边那列说了算）
      if (map[column.key] !== -1) continue
      if (!column.aliases.includes(text)) continue
      map[column.key] = index
      return
    }
  })
  return map
}

export type ParseResult =
  { ok: true; rows: ParsedRow[]; columns: string[] } | { ok: false; error: string }

export function parseStudentRows(rows: unknown[][]): ParseResult {
  if (rows.length === 0) return { ok: false, error: '表格里没有任何内容' }

  const map = mapColumns(rows[0])
  if (map.name === -1) {
    return { ok: false, error: '没有找到「姓名」列。请确认第一行是表头，并含「姓名」这一列' }
  }
  if (map.gender === -1) {
    return { ok: false, error: '没有找到「性别」列。请确认第一行是表头，并含「性别」这一列' }
  }
  const columns = COLUMN_ALIASES.filter((column) => map[column.key] !== -1).map(
    (column) => column.label,
  )

  const parsed: ParsedRow[] = []
  /** 表内已出现过的学号 → 首次出现的行号，用于「与第 N 行重复」 */
  const seenStudentNo = new Map<string, number>()

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index]
    if (!Array.isArray(row) || isBlankRow(row, map)) continue

    const errors: string[] = []
    const warnings: string[] = []
    const at = (key: keyof ColumnMap): string => (map[key] >= 0 ? cellText(row[map[key]]) : '')

    const name = at('name')
    if (!name) errors.push('姓名为空')

    const gender = GENDER_ALIASES[at('gender').toLowerCase()] ?? ''
    const genderText = at('gender')
    if (!gender) {
      errors.push(genderText ? `性别「${genderText}」无法识别` : '性别为空')
    }

    const studentNo = at('studentNo')
    if (studentNo) {
      const firstAt = seenStudentNo.get(studentNo)
      if (firstAt !== undefined) {
        errors.push(`学号 ${studentNo} 与第 ${firstAt} 行重复`)
      } else {
        seenStudentNo.set(studentNo, index + 1)
      }
    } else {
      // 空学号不是错误（学号是选填列），但它会让这一行失去合并依据，必须让教师看见
      warnings.push('学号为空，无法与已有学生合并，每次导入都会新增一条')
    }

    // 身份证尾号：去空白 + 截到 4 位，与 normalizeStudent 同一口径
    // （Excel 里写成 15 位手机号也不会被整段存进来）
    const idCardSuffix = at('idCardSuffix').trim().slice(0, 4)

    const dormitoryText = at('dormitory')
    let dormitory = dormitoryText
    const dormitoryRejected =
      Boolean(dormitoryText) && !isValidDormitory(dormitoryText, gender || undefined)
    if (dormitoryRejected) {
      // 只提示不拦截：学生本身是有效的，不该为了一间写错的宿舍丢掉整条档案
      warnings.push(`宿舍「${dormitoryText}」不在固定宿舍清单内，本次留空`)
      dormitory = ''
    }

    const scopeText = at('scope')
    const scope = SCOPE_ALIASES[scopeText] ?? ''
    if (scopeText && !scope) warnings.push(`返家范围「${scopeText}」无法识别，本次留空`)

    const prefecture = at('prefecture')
    const county = at('county')
    if (!scope) {
      // 所属地区 / 县区与返家范围是 `familyLocation` 这一个对象的三条腿，`scope` 在模型里是
      // **必填枚举**。缺了它，新建的档案存不进去这两个新列；此时既不静默丢掉，也不替教师
      // 编一个默认分类（那会把「拉萨的学生」算进「昌都市其他县」，直接污染周末返家统计）。
      // 更新已有档案时 scope 会沿用库里那份，所以这条提示里点明的是「新建的档案」。
      warnings.push(
        prefecture || county
          ? '缺返家范围，导入后需在档案里补——新建的档案存不下所属地区 / 县区'
          : '缺返家范围，导入后需在档案里补',
      )
    }

    const tags = at('tags')
      .split(/[,，、;；]/)
      .map((tag) => tag.trim())
      .filter(Boolean)

    parsed.push({
      rowNumber: index + 1,
      name,
      gender,
      studentNo,
      idCardSuffix,
      dormitory,
      cadreRole: at('cadreRole'),
      // 同一行里重复写两遍的标签去掉；顺序保留教师的书写顺序（他大概是按重要性排的）
      tags: [...new Set(tags)],
      phone: at('phone'),
      remark: at('remark'),
      prefecture,
      county,
      familyAddress: at('familyAddress'),
      scope,
      errors,
      warnings,
      dormitoryRejected,
    })
  }

  if (parsed.length === 0) {
    return { ok: false, error: '表头下面没有数据行（只找到表头）' }
  }
  return { ok: true, rows: parsed, columns }
}

/* ------------------------------------------------------------------ 分流 */

export interface StudentImportPlan {
  adds: StudentInput[]
  updates: Array<{ id: string; patch: Partial<StudentInput> }>
}

export type ImportAction = 'add' | 'update' | 'blocked'

export interface ImportPreviewRow extends ParsedRow {
  action: ImportAction
  /** action 为 update 时命中的既有学生 id */
  targetId?: string
}

export interface StudentImportResult {
  /** 总数据行数（不含表头、不含全空行） */
  total: number
  rows: ImportPreviewRow[]
  /** 可导入行数 = 新增 + 更新 */
  importable: number
  /** 被拦行数 */
  blocked: number
  added: number
  updated: number
  /** 重名的学生名（只提示，不拦） */
  duplicateNames: string[]
  /** 学号为空的行数——这些行每次导入都会新增，教师必须知道 */
  emptyStudentNo: number
  /** 宿舍写错被留空的行数 */
  missingDormitory: number
  /** 缺返家范围的行数 */
  missingScope: number
  plan: StudentImportPlan
}

/**
 * 把解析结果与库内学生合并成一份可执行计划（纯函数，无副作用）。
 *
 * **合并口径（Phase 5A 决策）**：学号命中库内未软删学生 → 更新，否则新增。
 * **字段覆盖口径**：更新时**只覆盖这一行确实填了的字段**——空单元格视为「本次没填」，
 * 而不是「清空」。教师第二遍导入一份只列「姓名 + 新宿舍」的表，不该把标签和班委抹掉。
 * 代价是导入无法清空字段，需要手工编辑；这个方向的错误（丢数据）比另一个方向（清不掉）
 * 严重得多，所以选它。
 *
 * 每次调用都重新按当前学生表算一遍：预览数字与真正落库的计划必须来自同一次计算，
 * 否则教师在预览上看到的「新增 40」和落库时的 41 就对不上了。
 */
export function planStudentImport(rows: ParsedRow[], existing: Student[]): StudentImportResult {
  const byStudentNo = new Map<string, Student>()
  for (const student of existing) {
    if (student.deletedAt) continue
    if (!student.studentNo) continue
    // 先到先得：库里理论上不该有重号，真有时也不让后一条把它顶掉
    if (!byStudentNo.has(student.studentNo)) byStudentNo.set(student.studentNo, student)
  }

  // 重名提示：库里已有的同名 + 本表内自己也重名的，一起报给教师
  const nameCount = new Map<string, number>()
  for (const student of existing) {
    if (student.deletedAt) continue
    nameCount.set(student.name, (nameCount.get(student.name) ?? 0) + 1)
  }
  const duplicateNames = new Set<string>()
  const seenInFile = new Set<string>()

  const plan: StudentImportPlan = { adds: [], updates: [] }
  const previewRows: ImportPreviewRow[] = []
  let emptyStudentNo = 0
  let missingDormitory = 0
  let missingScope = 0

  for (const row of rows) {
    if (!row.studentNo) emptyStudentNo += 1
    if (row.dormitoryRejected) missingDormitory += 1
    if (!row.scope) missingScope += 1

    if (row.errors.length > 0) {
      previewRows.push({ ...row, action: 'blocked' })
      continue
    }

    if (nameCount.has(row.name) || seenInFile.has(row.name)) duplicateNames.add(row.name)
    seenInFile.add(row.name)

    const matched = row.studentNo ? byStudentNo.get(row.studentNo) : undefined
    if (!matched) {
      plan.adds.push(toStudentInput(row))
      previewRows.push({ ...row, action: 'add' })
      continue
    }

    plan.updates.push({ id: matched.id, patch: toPatch(row, matched) })
    previewRows.push({ ...row, action: 'update', targetId: matched.id })
  }

  const added = previewRows.filter((row) => row.action === 'add').length
  const updated = previewRows.filter((row) => row.action === 'update').length
  return {
    total: rows.length,
    rows: previewRows,
    importable: added + updated,
    blocked: previewRows.length - added - updated,
    added,
    updated,
    duplicateNames: [...duplicateNames],
    emptyStudentNo,
    missingDormitory,
    missingScope,
    plan,
  }
}

/** 新增：整行照单全收；没填的字段留 undefined，与手工新增的空表单等价 */
function toStudentInput(row: ParsedRow): StudentInput {
  // `scope` 在模型里是必填枚举，缺了它整份家庭信息都存不下——落库侧与
  // `parseStudentRows` 里那条警告是同一件事（那边说，这边照做）
  const familyLocation: FamilyLocation | undefined = row.scope
    ? { prefecture: row.prefecture, county: row.county, scope: row.scope }
    : undefined
  return {
    name: row.name,
    studentNo: row.studentNo,
    idCardSuffix: row.idCardSuffix || undefined,
    gender: row.gender as Gender,
    dormitory: row.dormitory || undefined,
    cadreRole: row.cadreRole || undefined,
    tags: row.tags,
    phone: row.phone || undefined,
    remark: row.remark || undefined,
    familyAddress: row.familyAddress,
    familyLocation,
  }
}

/** 更新：只带这一行确实填了的字段；空单元格保持既有值 */
function toPatch(row: ParsedRow, matched: Student): Partial<StudentInput> {
  const patch: Partial<StudentInput> = {
    name: row.name,
    studentNo: row.studentNo,
    gender: row.gender as Gender,
  }
  if (row.idCardSuffix) patch.idCardSuffix = row.idCardSuffix
  if (row.dormitory) patch.dormitory = row.dormitory
  if (row.cadreRole) patch.cadreRole = row.cadreRole
  if (row.tags.length > 0) patch.tags = row.tags
  if (row.phone) patch.phone = row.phone
  if (row.remark) patch.remark = row.remark
  if (row.familyAddress) patch.familyAddress = row.familyAddress
  if (row.scope || row.prefecture || row.county) {
    // familyLocation 是三个字段一体的对象，所以**逐格**合并：表格里空着的格子沿用库里那份，
    // 与上面每个字段同一口径；整份替换会把教师已录的地区 / 县区一起清掉。
    // scope 优先取表里的，表里没填则沿用库里的（v3.5.0 起才会走到这条：只填了
    // 所属地区 / 县区、没填返家范围的行，对已有档案依然能把这两个字段存进去）；
    // 两边都没有 scope 就真的建不出这个对象——跳过，解析阶段那条警告已经报过。
    const scope = row.scope || matched.familyLocation?.scope
    if (scope) {
      patch.familyLocation = {
        prefecture: row.prefecture || matched.familyLocation?.prefecture || '',
        county: row.county || matched.familyLocation?.county || '',
        scope,
      }
    }
  }
  return patch
}

/** 预览用：固定宿舍清单，教师看到「不在清单内」时能立刻知道该怎么改 */
export const DORMITORY_HINT = ALL_DORMITORIES.join(' / ')
