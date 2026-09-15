import type { FamilyLocation, FamilyScope, Gender, SelectOption, Student } from '@/types'

/** 返家范围代码 → 中文文案（列表 Badge / 详情 / 统计共用） */
export const FAMILY_SCOPE_LABELS: Record<FamilyScope, string> = {
  'changdu-city': '昌都市区',
  'changdu-county': '昌都市其他县',
  'outside-changdu': '昌都市外',
}

/** 返家范围表单选项（固定三类；接入行政区划配置后可再扩展） */
export const FAMILY_SCOPE_OPTIONS: SelectOption<FamilyScope>[] = [
  { label: FAMILY_SCOPE_LABELS['changdu-city'], value: 'changdu-city' },
  { label: FAMILY_SCOPE_LABELS['changdu-county'], value: 'changdu-county' },
  { label: FAMILY_SCOPE_LABELS['outside-changdu'], value: 'outside-changdu' },
]

function isFamilyScope(value: unknown): value is FamilyScope {
  return typeof value === 'string' && value in FAMILY_SCOPE_LABELS
}

function isGender(value: unknown): value is Gender {
  return value === 'male' || value === 'female'
}

/**
 * 宿舍房间（Phase 5A）：班级实际只占这 8 间，档案里不再接受自由文本。
 * **按性别分列**——宿舍分配本身就是按性别的，把男生排进女生楼是真实会犯的错，
 * 让选项表替教师挡掉，比事后发现再改便宜。
 */
export const DORMITORIES: Record<Gender, readonly string[]> = {
  female: ['女生2栋113', '女生2栋114', '女生2栋115', '女生2栋116'],
  male: ['男生1栋209', '男生1栋210', '男生1栋211', '男生1栋212'],
}

/**
 * 拍平后的全部合法房间。**只给「判断合法性」用**（迁移收敛、Excel 导入校验）：
 * 这两条路径上性别未必可信或未必已知，放宽到 8 间才不会把一个字段的问题连坐给另一个。
 * 表单/下拉一律走 `dormitoryOptions()`，那里才按性别收窄。
 */
export const ALL_DORMITORIES: readonly string[] = [...DORMITORIES.female, ...DORMITORIES.male]

/** 宿舍下拉选项：当前性别的 4 间 + 首项「未分配」（宿舍可选，留空合法） */
export function dormitoryOptions(gender: Gender): SelectOption<string>[] {
  return [
    { label: '未分配', value: '' },
    ...DORMITORIES[gender].map((room) => ({ label: room, value: room })),
  ]
}

/** 宿舍是否合法：性别可识别时只认该性别的房间，否则放宽到全部 8 间 */
export function isValidDormitory(value: unknown, gender?: unknown): value is string {
  if (typeof value !== 'string' || value === '') return false
  const rooms = isGender(gender) ? DORMITORIES[gender] : ALL_DORMITORIES
  return rooms.includes(value)
}

/**
 * 「＋ 自定义」的**哨兵值，绝不写入模型**——它只负责把输入框亮出来，提交时取输入框里的文本。
 * 之所以要绕这一下：`AppSelect` 包的是原生 `<select>`，没有「既可选又可输入」这一档
 * （§11.5 不为一个表单控件引入组件库）。
 *
 * Phase 5B 起从 `StudentFormModal.vue` 上移到此处：批量修改弹窗要用同一份清单，
 * 各定义一份的话，加一个职务就要改两个地方（§11.1）。
 */
export const CADRE_CUSTOM = '__custom__'

/**
 * 班委职务选项。首项「无」（空值 = 非班委），末项是自定义哨兵。
 * 批量修改与新增/编辑表单**共用这一份**；下拉里那两个「不修改 / 清空」之类的
 * 批量专用项由弹窗自己拼接，不混进来。
 */
export const CADRE_OPTIONS: SelectOption<string>[] = [
  { label: '无', value: '' },
  { label: '班长', value: '班长' },
  { label: '副班长', value: '副班长' },
  { label: '学习委员', value: '学习委员' },
  { label: '体育委员', value: '体育委员' },
  { label: '文艺委员', value: '文艺委员' },
  { label: '劳动委员', value: '劳动委员' },
  { label: '生活委员', value: '生活委员' },
  { label: '＋ 自定义…', value: CADRE_CUSTOM },
]

/** 除「无」与哨兵以外的预设职务，用于判断既有值是否属于预设（表单回填时要区分） */
export const PRESET_CADRES: string[] = CADRE_OPTIONS.map((option) => option.value).filter(
  (value) => value !== '' && value !== CADRE_CUSTOM,
)

/**
 * 历史数据升级（load 时逐条调用）：为缺失的家庭信息补安全默认值，
 * 保证升级数据模型后旧 localStorage 数据可正常加载、不被覆盖。
 */
export function normalizeStudent(raw: Student): Student {
  const family = raw.familyLocation
  let familyLocation: FamilyLocation | undefined
  if (family && typeof family === 'object') {
    familyLocation = {
      prefecture: typeof family.prefecture === 'string' ? family.prefecture : '',
      county: typeof family.county === 'string' ? family.county : '',
      // 无法识别的 scope 统一归入「昌都市其他县」兜底（本校学生以昌都籍为主）
      scope: isFamilyScope(family.scope) ? family.scope : 'changdu-county',
    }
  }
  const normalized: Student & { boarding?: unknown } = {
    ...raw,
    familyAddress: typeof raw.familyAddress === 'string' ? raw.familyAddress : '',
    // 身份证尾号（v3.3.1）：去首尾空白 + 截到 4 位，**空值一律删除键**。
    // 留一个 `''` 会让「重名但没填尾号」与「填了个空」在展示层分不开，
    // 而这两者的界面结果相同（都只显示姓名）——那就干脆只留一种状态。
    // 不做数字校验：身份证尾号可能是 X，写死数字会把合法值挡在门外（见 Student 类型上的说明）
    familyLocation,
    // 姓名缺失（外部篡改 / 手改缓存）时给空串，理由同学号：座位图与值日卡片在渲染路径上
    // 直接调用 `name.charAt(0)`，undefined 会抛错把整页打断。**不丢弃这条记录**——
    // 档案里留着教师才有机会补上姓名，丢了他连「记录被吃了」都看不见（§六：安全空值）
    name: typeof raw.name === 'string' ? raw.name : '',
    // 学号缺失（外部导入 / 手改缓存）时给空串：展示函数一律 `studentNo.slice(-4)`，
    // undefined 会直接抛错把整页渲染打断（值日卡片、座位图都在渲染路径上调用它们）
    studentNo: typeof raw.studentNo === 'string' ? raw.studentNo : '',
  }
  // Phase 2.1 收敛：历史 localStorage 中可能残留 boarding 键（全班统一住校，模型已移除），
  // 升级时一并剔除，保证该键不再随 deep watch 写回持久层
  delete normalized.boarding
  // Phase 5A 收敛：宿舍改为固定 8 间后，历史自由文本（「3 号楼 412」「5 号楼 208」等）一律剔除。
  // **刻意用白名单而不是「升级时清一次 + 迁移标记」**：本函数在首屏加载、跨标签页同步、
  // 云同步三条路径上都会跑，白名单是幂等的——从备份文件恢复、或新设备拉回一份旧云端快照，
  // 旧值同样会被清掉；一次性标记只在升级那一刻生效，之后旧值会重新冒出来且永不再清。
  // 性别不可识别时放宽到全部 8 间：gender 自己有问题，不该连坐宿舍
  if (!isValidDormitory(normalized.dormitory, normalized.gender)) delete normalized.dormitory
  const suffix = typeof normalized.idCardSuffix === 'string' ? normalized.idCardSuffix.trim() : ''
  if (suffix) normalized.idCardSuffix = suffix.slice(0, 4)
  else delete normalized.idCardSuffix
  return normalized
}

/** 返家范围中文文案；家庭信息缺失时返回 undefined（由展示层决定占位） */
export function familyScopeLabel(location: FamilyLocation | undefined): string | undefined {
  return location ? FAMILY_SCOPE_LABELS[location.scope] : undefined
}

/** 身份证尾号（去空白后的；未填 / 空串 → undefined） */
export function idCardSuffixOf(student: Pick<Student, 'idCardSuffix'>): string | undefined {
  const suffix = student.idCardSuffix?.trim()
  return suffix || undefined
}

/**
 * 学生展示名（**全站唯一的一份姓名显示规则**，v3.3.1 重写）。
 *
 *     不重名                  →  张三
 *     重名且填了身份证尾号    →  张三（4321）
 *     重名但没填身份证尾号    →  张三
 *
 * `nameCounts` 走 `buildNameCounts(students)`——**它决定「是否重名」**，因此是必填参数：
 * 让「谁算重名」只有一个判断依据，也逼着每个渲染点明确回答「我看的是哪份名册」
 * （档案页是全部在读学生、座位图是当前方案里的学生，两者未必相同）。
 *
 * v3.3.1 之前这里叫 `formatStudentShortName`，规则是「一律拼上学号后四位」。
 * 换掉的理由有两条：一是学号自 Phase 5A 起是选填列，真实班级里大面积空缺，
 * 拼出来是「旦增卓玛（）」或者干脆什么都没拼上；二是**不重名的学生根本不需要消歧**，
 * 给六十多张卡片里的每一张都挂一个括号，读起来全是噪音（§2.3 重名消歧）。
 */
export function formatStudentShortName(
  student: Pick<Student, 'name' | 'idCardSuffix'>,
  nameCounts: ReadonlyMap<string, number>,
): string {
  const suffix = disambiguatorOf(student, nameCounts)
  return suffix ? `${student.name}（${suffix}）` : student.name
}

/** 带学生姓名快照的记录（请假记录、周末返家记录等，见下方 refreshStudentNames 的说明） */
export interface StudentNamedRecord {
  studentId: string
  studentName: string
}

/**
 * 姓名快照维护：学生在档案里 → 按档案刷新（改名、补学号能同步）。
 * 学生被删除后仍在 `students`（软删，列表里过滤掉、档案保留），因此其快照实际
 * **冻结在删除那一刻**——这正是快照存在的意义：记录不随学生删除消失，
 * 仍能读出「这是谁的记录」（§11.3）。只有学生 id 在档案中彻底不存在时才沿用
 * 记录自带的快照；两处都拿不到姓名则无法展示归属，丢弃。
 * 无变化时返回原数组，避免无谓的写盘。
 *
 * 请假记录与周末返家记录**共用这一份实现**（Phase 7B 抽自 `stores/leave.ts` 的同名私有函数）：
 * 两者的快照口径本就相同，各存一份迟早会漂移（§9.14 合并 `isPlainObject` 的同款问题）。
 */
export function refreshStudentNames<T extends StudentNamedRecord>(
  records: T[],
  students: Student[],
): T[] {
  const byId = new Map(students.map((item) => [item.id, item]))
  // 名册就在这里，重名判断不必再让每个调用方各算一遍（v3.3.1：消歧规则要 counts）。
  // **软删除的学生不参与计数**——与 store 的 `nameCounts` 口径一致（StudentStore 说明），
  // 否则删掉一个同名学生后，剩下那个的记录还会一直挂着括号。
  const nameCounts = buildNameCounts(students.filter((item) => !item.deletedAt))
  let changed = false
  const next: T[] = []
  for (const record of records) {
    const student = byId.get(record.studentId)
    const name = student ? formatStudentShortName(student, nameCounts) : record.studentName
    if (!name) {
      changed = true
      continue
    }
    if (name !== record.studentName) {
      changed = true
      // 只改写 studentName 这一个既有字符串字段，形状不变（泛型收窄不到字面量组合，故断言）
      next.push({ ...record, studentName: name } as T)
      continue
    }
    next.push(record)
  }
  return changed ? next : records
}

/** 座位强调类别：只复用学生档案既有字段；高个由「高个」标签表达（档案暂无独立身高字段） */
export type SeatAccent = 'cadre' | 'tall' | 'tag'

/**
 * 座位图上的强调标记：班委 > 高个 > 其他标签（优先级递减）；均无则不强调。
 * 颜色映射见 views/Seats 页面图例（一律取自 theme.css，不新增主题色）。
 */
export function seatAccentOf(student: Student): SeatAccent | undefined {
  if (student.cadreRole) return 'cadre'
  if (student.tags?.includes('高个')) return 'tall'
  if (student.tags?.length) return 'tag'
  return undefined
}

/* ---------- 重名消歧（Student Hub 与课堂工具共用，Phase Classroom-1 上收） ---------- */

/**
 * 姓名 → 同名人数（含软删除记录吗？调用方传什么就数什么：档案页传在读、日志快照传全体）。
 * 参数放宽到 `{ name }` 是为了让只拿得到姓名的地方（如座位图里的 `Student` 投影）也能直接用。
 */
export function buildNameCounts(students: readonly { name: string }[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const student of students) {
    counts.set(student.name, (counts.get(student.name) ?? 0) + 1)
  }
  return counts
}

/**
 * 学生 id → 值日组名（同一学生在多个组时取**第一个**，与档案页展示口径一致）。
 *
 * v3.3.1 起**只用于展示「这名学生在哪个值日组」**（档案卡的辅助信息行），
 * 不再参与重名消歧——「第 3 组」是值日轮换的临时产物，拿它当身份后缀，
 * 下个月学生换组了，卡片上的名字就跟着变了（见 `disambiguatorOf`）。
 */
export function buildDutyGroupNameById(
  groups: { name: string; studentIds: string[] }[],
): Map<string, string> {
  const map = new Map<string, string>()
  for (const group of groups) {
    for (const id of group.studentIds) {
      if (!map.has(id)) map.set(id, group.name)
    }
  }
  return map
}

/**
 * 重名消歧后缀：**只有重名时才返回**（`nameCounts` 里该姓名 > 1），且只取身份证尾号。
 * 单名、或重名但没填尾号 → undefined（界面就只显示姓名）。
 *
 * v3.3.1 收敛：此前这里「值日组优先、回落学号后四位」，于是同一个学生在档案页显示
 * 「旦增卓玛（第3组）」、在座位图上显示「旦增卓玛（0101）」——**两处对不上**，
 * 而且「第 3 组」是值日轮换的临时产物，下个月就不是了。现在只剩一个来源：
 * 教师自己填的身份证尾号（§11.1 唯一实现）。
 */
export function disambiguatorOf(
  student: Pick<Student, 'name' | 'idCardSuffix'>,
  nameCounts: ReadonlyMap<string, number>,
): string | undefined {
  if ((nameCounts.get(student.name) ?? 1) <= 1) return undefined
  return idCardSuffixOf(student)
}
