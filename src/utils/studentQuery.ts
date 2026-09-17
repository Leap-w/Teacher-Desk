import type { Gender, Student } from '@/types'
import { familyScopeLabel } from '@/utils/student'

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
 * 一名学生的**可搜索文本**（全应用唯一一份口径）：各字段拼成一行，供子串匹配。
 *
 * 范围分两轮长成现在这样：
 * ・Phase 5B 起：姓名 / 学号 / 班委 / 宿舍 / 标签。班委是那一轮补的——班主任最常找的
 *   就是「班长是谁」「学习委员在哪」，而 haystack 里原本没有 `cadreRole`，搜「班长」零结果。
 * ・v3.4.0 起再补：**电话 / 备注 / 身份证尾号 / 家庭地址与所在地**。
 *   补的理由一律是「教师手里已经拿着这条信息，想按它把人找出来」：
 *   - 电话：家长来电，教师手上只有号码，要反查是谁的家长；
 *   - 备注：备注里写的常是「走读」「中午回家」这类**没有专门字段的事**，
 *     以前只能先筛「有备注」再一条条点开看；
 *   - 身份证尾号：报名表 / 学籍表上印的就是它，而重名的孩子恰恰只有它分得开；
 *   - 家庭地址与所在地：「××乡的孩子有几个」是真实问法。地址全文与结构化的
 *     市 / 县都要能搜到；返家范围（「昌都市区」这种中文文案）另外拼一份——
 *     地址全文里写的是「昌都市卡若区」，只拼全文的话搜「昌都市区」仍是零结果。
 *
 * 字段顺序固定、空值也照拼（`?? ''`）：这份清单同时是**范围说明**，一行一个字段，
 * 拿着它对着 `types/index.ts` 的 `Student` 能逐个核过去，将来加字段时不容易漏。
 */
function searchText(student: Student): string {
  const location = student.familyLocation
  return [
    student.name,
    student.studentNo,
    student.cadreRole ?? '',
    student.dormitory ?? '',
    ...(student.tags ?? []),
    student.phone ?? '',
    // 电话另拼一份纯数字：Excel 里存成「138 1234 5678」的，教师拨打时手里只有一串数字，
    // 按空格 / 短横原样敲进来是搜不到的
    (student.phone ?? '').replace(/\D/g, ''),
    student.remark ?? '',
    student.idCardSuffix ?? '',
    student.familyAddress ?? '',
    location?.prefecture ?? '',
    location?.county ?? '',
    familyScopeLabel(location) ?? '',
  ].join(' ')
}

function matchesKeyword(student: Student, query: string): boolean {
  if (!query) return true
  return searchText(student).toLowerCase().includes(query)
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
