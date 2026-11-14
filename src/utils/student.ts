import type { FamilyLocation, FamilyScope, SelectOption, Student } from '@/types'

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

/**
 * 宿舍快捷预设（v3.8.1 Phase 2）。
 *
 * ## 只是快捷选项，**不是**合法值白名单
 *
 * 宿舍字段是自由文本：教师可以直接输入任意宿舍名称；历史值（如 `女生2栋113`、
 * `男生1栋211`、`男生1栋212`、`3 号楼 412`）必须原样保留，不得因不在本清单里被清空。
 *
 * ## 顺序固定、不按性别拆分
 *
 * 顺序由需求指定，**不要调整**；也不再按学生性别过滤——性别与宿舍已解耦
 * （女生可以保留男生楼的值，反之亦然），表单里八项对所有人都一致展示。
 */
export const DORMITORY_PRESETS: readonly string[] = [
  '女生2栋212',
  '女生2栋114',
  '女生2栋115',
  '女生2栋116',
  '男生1栋203',
  '男生1栋210',
  '男生1栋208',
  '男生1栋209',
]

/**
 * 「＋ 自定义宿舍」的**哨兵值，绝不写入模型**——它只负责把输入框亮出来，
 * 提交时取输入框里的文本（与 `CADRE_CUSTOM` 同一手法）。
 */
export const DORMITORY_CUSTOM = '__custom_dormitory__'

/**
 * 表单下拉选项：未分配 + 八项快捷预设。
 * **不再接受 gender 参数**：性别与宿舍解耦后，按性别收窄选项只会把另一栋的有效宿舍藏起来。
 */
export function dormitoryOptions(): SelectOption<string>[] {
  return [
    { label: '未分配', value: '' },
    ...DORMITORY_PRESETS.map((room) => ({ label: room, value: room })),
  ]
}

/**
 * 这个值是否属于八项快捷预设。
 * **不是合法性校验**——只用于表单回填时判断「下拉里能不能选中」。
 */
export function isDormitoryPreset(value: unknown): value is string {
  return typeof value === 'string' && (DORMITORY_PRESETS as readonly string[]).includes(value)
}

/** 宿舍是否有可展示的内容（全空白视为未分配；数据仍原样保留，只影响展示/校验） */
export function hasDormitoryValue(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * 自定义宿舍是否「选了自定义却空着」。
 * 单个表单与批量修改共用：空着提交等于清空，必须让教师明确选「未分配」而不是静默清掉。
 */
export function isDormitorySelectionMissing(select: string, custom: string): boolean {
  return select === DORMITORY_CUSTOM && custom.trim() === ''
}

/** 表单里「下拉值 + 自定义输入」的两段式表示 */
export interface DormitoryFormValue {
  /** 下拉框选中值：预设、`''`（未分配）或 `DORMITORY_CUSTOM` */
  select: string
  /** 选中「＋ 自定义」时的输入内容 */
  custom: string
}

/**
 * 编辑回填：把已保存的宿舍拆成「下拉值 + 自定义输入」。
 * **不在预设里的历史值必须回填到输入框**，否则原生 `<select>` 找不到匹配项会显示空白，
 * 一保存就把这个值抹掉（与班委自定义同款处理）。
 */
export function splitDormitoryForForm(dormitory: string | undefined): DormitoryFormValue {
  if (!dormitory) return { select: '', custom: '' }
  if (isDormitoryPreset(dormitory)) return { select: dormitory, custom: '' }
  return { select: DORMITORY_CUSTOM, custom: dormitory }
}

/**
 * 提交：从「下拉值 + 自定义输入」还原成模型值。
 * - 自定义输入**原样返回**（不 trim、不格式化——需求明确不得改写用户输入）；
 * - 空值与项目既有约定一致：返回 `undefined`（不写这个键），即「未分配」。
 */
export function dormitoryFromForm(select: string, custom: string): string | undefined {
  const value = select === DORMITORY_CUSTOM ? custom : select
  return value || undefined
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
  // v3.8.1 Phase 2：宿舍是**自由文本**，八项预设只是快捷选项、不是白名单。
  // 这里**只剔除空值与非字符串**（项目既有约定：可选字段空串 = 不写这个键），
  // 对任何非空字符串**原样保留**：不 trim、不改写、不按性别校验。
  // 这一步同时跑在首屏加载 / 跨标签页同步 / 云端采纳 / 备份导入四条路径上，
  // 因此历史值（女生2栋113、男生1栋211、男生1栋212、3 号楼 412…）不会被静默清掉。
  const dormitory = normalized.dormitory
  if (typeof dormitory !== 'string' || dormitory === '') delete normalized.dormitory
  const suffix = typeof normalized.idCardSuffix === 'string' ? normalized.idCardSuffix.trim() : ''
  if (suffix) normalized.idCardSuffix = suffix.slice(0, 4)
  else delete normalized.idCardSuffix
  // 昌都市内亲属（v3.6.1）——与上面那条**刻意不同**：这里**保留 `false`**。
  // 照 `isTemporary === true` 那句写会把「明确没有」折成「没填」，而这两者在导出名单里
  // 是「无」与空单元格的区别，教师据此知道谁还没问过（见 Student 类型上的说明）。
  // 非布尔一律剔键：`'有'` / `1` 这类来自手改缓存的值不可信，留着会让 `=== true` 的判定全落空
  if (typeof normalized.hasChangduRelative !== 'boolean') delete normalized.hasChangduRelative
  const relation =
    typeof normalized.changduRelativeRelation === 'string'
      ? normalized.changduRelativeRelation.trim()
      : ''
  // 关系只在「有亲属」时留下：没有亲属却有关系，是一句自相矛盾的数据。
  // 这条不变式放在数据层而不是表单里——导入、备份恢复、跨端同步三条路径都会经过这里，
  // 表单只管得住其中一条（同上面宿舍值为什么必须在数据层原样保留：表单只管得住一条路径）
  if (relation && normalized.hasChangduRelative === true)
    normalized.changduRelativeRelation = relation
  else delete normalized.changduRelativeRelation
  return normalized
}

/**
 * 「昌都市内亲属」一列的显示文案（导出名单与档案页共用这一份）：
 * 有 / 无 / **空串**（未填）。空串而不是「—」或「不详」：规格要求「未填」与「无」可区分，
 * 而导出到 Excel 后空单元格正是教师一眼扫出「还没问过」的那批人的方式。
 */
export function hasChangduRelativeLabel(student: Pick<Student, 'hasChangduRelative'>): string {
  if (student.hasChangduRelative === true) return '有'
  if (student.hasChangduRelative === false) return '无'
  return ''
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

/*
  v3.7.5（§4.3）：座位图展示精简——原来的「座位强调类别」（班委 > 高个 > 其他标签）
  与 `seatAccentOf()` 已删除：座位图上只剩**姓名 / 性别 / 班委**三种信息，
  高个与标签不再上座位图。学生档案里的 `tags`（含「高个」）与备注**一个字段都没动**，
  自动排座的「高个」软偏好（utils/seatArrange.ts / utils/constraint.ts）也照旧读它。
*/

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
