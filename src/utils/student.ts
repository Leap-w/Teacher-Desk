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
  }
  // Phase 2.1 收敛：历史 localStorage 中可能残留 boarding 键（全班统一住校，模型已移除），
  // 升级时一并剔除，保证该键不再随 deep watch 写回持久层
  delete normalized.boarding
  return normalized
}

/** 返家范围中文文案；家庭信息缺失时返回 undefined（由展示层决定占位） */
export function familyScopeLabel(location: FamilyLocation | undefined): string | undefined {
  return location ? FAMILY_SCOPE_LABELS[location.scope] : undefined
}

/**
 * 学生展示名：姓名（学号后四位｜座位号）。
 * 同名学生可凭学号后四位与座位号区分，如「旦增卓玛（0101｜1 号）」。
 */
export function formatStudentDisplayName(student: Student): string {
  const parts: string[] = []
  const lastFour = student.studentNo.slice(-4)
  if (lastFour) parts.push(lastFour)
  if (student.seatNumber !== undefined) parts.push(`${student.seatNumber} 号`)
  if (parts.length === 0) return student.name
  return `${student.name}（${parts.join('｜')}）`
}

/** 座位展示文案 */
export function formatSeatLabel(student: Student): string {
  return student.seatNumber !== undefined ? `${student.seatNumber} 号座位` : '未排座'
}
