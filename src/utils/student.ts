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
  return normalized
}

/** 返家范围中文文案；家庭信息缺失时返回 undefined（由展示层决定占位） */
export function familyScopeLabel(location: FamilyLocation | undefined): string | undefined {
  return location ? FAMILY_SCOPE_LABELS[location.scope] : undefined
}

/**
 * 学生展示名：姓名（学号后四位｜座位号）。
 * 同名学生可凭学号后四位与座位号区分，如「旦增卓玛（0101｜1 号）」。
 *
 * **Phase 5A 起只用于座位图与请假模块**（座位格提示 / 换座与删除 toast / 请假抽屉的学生下拉）——
 * 那些场景里座位是当场有效的。**学生档案模块一律走 `formatStudentShortName()`**：
 * 档案从 Phase 5A 起不再维护 `seatNumber`，在档案里摆一个只读不写的座位号，
 * 教师会以为它还在起作用。两个函数刻意都留着，见 §2.3。
 */
export function formatStudentDisplayName(student: Student): string {
  const parts: string[] = []
  const lastFour = student.studentNo.slice(-4)
  if (lastFour) parts.push(lastFour)
  if (student.seatNumber !== undefined) parts.push(`${student.seatNumber} 号`)
  if (parts.length === 0) return student.name
  return `${student.name}（${parts.join('｜')}）`
}

/**
 * 学生短名：姓名（学号后四位），如「旦增卓玛（0101）」。
 * 学号后四位缺失时仅姓名（Phase 5A 起学号可为空，这条路径不再是异常）。
 *
 * 两处用途，共用同一份重名消歧规则（§2.3「重名靠学号后四位区分」）：
 * ① 换座 / 日志 / 快照——座位号在那里即刻失真，本就不能带（原始理由）；
 * ② 学生档案模块——座位号已退出该模块的界面（Phase 5A）。
 * **不再新写第三个格式化函数**：规则多一份就多一处会漂移的地方（§11.1）。
 */
export function formatStudentShortName(student: Pick<Student, 'name' | 'studentNo'>): string {
  const lastFour = student.studentNo.slice(-4)
  return lastFour ? `${student.name}（${lastFour}）` : student.name
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
  let changed = false
  const next: T[] = []
  for (const record of records) {
    const student = byId.get(record.studentId)
    const name = student ? formatStudentShortName(student) : record.studentName
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
