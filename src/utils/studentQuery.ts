import type { Gender, Student } from '@/types'

/**
 * 列表排序方式（Phase 5B）：默认按学号升序 / 按姓名拼音 / 随机。
 * 只有 `'default'` 与 `'pinyin'` 会落盘（见 `utils/studentViewPrefs.ts`）——
 * 随机是一种「此刻的观看顺序」，记住它没有意义。
 */
export type StudentSortMode = 'default' | 'pinyin' | 'random'

export interface StudentQueryOptions {
  keyword?: string
  gender?: Gender
  cadreOnly?: boolean
  /** 排序方式；缺省 `'default'` */
  sort?: StudentSortMode
  /**
   * 拼音排序的键提取器。**没传就退化为默认排序**，而不是原地不动——
   * 拼音词典是动态加载的（见 `services/pinyinSort.ts`），首次点击时可能还没就绪；
   * 这段时间里列表顺序至少要稳定可解释，不能变成「点一下没反应」。
   */
  pinyinKey?: (name: string) => string
  /** 随机排序的次序（id → 权重）；**只在内存里**，不落盘、不进 `students` */
  randomRanks?: ReadonlyMap<string, number>
}

/**
 * 关键词匹配的字段（Phase 5B）：姓名 / 学号 / **班委** / 宿舍 / 标签。
 *
 * 班委是 Phase 5B 补上的：班主任最常找的就是「班长是谁」「学习委员在哪」，
 * 而在这之前 haystack 里根本没有 `cadreRole`，搜「班长」零结果。
 */
function matchesKeyword(student: Student, query: string): boolean {
  if (!query) return true
  const haystack = [
    student.name,
    student.studentNo,
    student.cadreRole ?? '',
    student.dormitory ?? '',
    ...(student.tags ?? []),
  ]
  return haystack.join(' ').toLowerCase().includes(query)
}

/**
 * 学号升序，**空学号一律排在最后**。
 *
 * Phase 5A 允许学号为空之后，空串与数字串比较会排到**最前**——那批「还没补学号」
 * 的学生就顶在了名单头部，这是当时没预料到的副作用。空学号不构成一个可比较的身份，
 * 把它当作「最大」即可。
 */
function byStudentNo(a: Student, b: Student): number {
  if (!a.studentNo) return b.studentNo ? 1 : 0
  if (!b.studentNo) return -1
  return a.studentNo.localeCompare(b.studentNo)
}

/**
 * 生成一次随机顺序：Fisher-Yates 洗牌后把位置当作权重。
 *
 * 用「位置」而不是「随机数」是刻意的：随机数会撞值，撞值就得再定一条并列规则；
 * 洗牌后的位置天然是一个无并列的全序，`sort` 的稳定性也不会来插一脚。
 */
export function buildRandomRanks(ids: readonly string[]): Map<string, number> {
  const shuffled = [...ids]
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const swap = shuffled[i]
    shuffled[i] = shuffled[j]
    shuffled[j] = swap
  }
  return new Map(shuffled.map((id, index) => [id, index]))
}

/**
 * 学生的检索与排序（Phase 5B）——**全应用唯一一份实现**。
 *
 * 纯函数：不碰 DOM、不碰 localStorage、不碰 pinyin-pro（键提取器由调用方注入），
 * 因此可以在 node 环境里直接喂数组跑测试。
 *
 * `source` **不会被就地排序**：过滤本身已产出一个新数组，返回的又始终是新数组。
 */
export function queryStudents(
  source: readonly Student[],
  options: StudentQueryOptions = {},
): Student[] {
  const query = (options.keyword ?? '').trim().toLowerCase()
  const matched = source.filter(
    (student) =>
      (options.gender ? student.gender === options.gender : true) &&
      (options.cadreOnly ? Boolean(student.cadreRole) : true) &&
      matchesKeyword(student, query),
  )
  return sortStudents(matched, options)
}

function sortStudents(matched: Student[], options: StudentQueryOptions): Student[] {
  const sort = options.sort ?? 'default'

  if (sort === 'random') {
    const ranks = options.randomRanks
    if (!ranks || ranks.size === 0) return [...matched]
    // 没被洗进这份次序的学生（洗牌之后才新增的）排到最后，而不是插到最前
    const rankOf = (student: Student) => ranks.get(student.id) ?? Number.MAX_SAFE_INTEGER
    return [...matched].sort((a, b) => rankOf(a) - rankOf(b))
  }

  if (sort === 'pinyin' && options.pinyinKey) {
    const key = options.pinyinKey
    return [...matched].sort((a, b) => {
      const left = key(a.name).toLowerCase()
      const right = key(b.name).toLowerCase()
      if (left === right) return 0
      // 返回 0 交给 Array.prototype.sort 的稳定性保持原序，即「同拼音不换位」
      return left < right ? -1 : 1
    })
  }

  return [...matched].sort(byStudentNo)
}
