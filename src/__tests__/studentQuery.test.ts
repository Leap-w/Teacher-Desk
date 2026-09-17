/**
 * 学生检索与排序（Phase 5B）。
 *
 * 被测的是 `utils/studentQuery.ts` 与 `utils/studentViewPrefs.ts` 两个纯函数层。
 * 规则全在这一层，所以能把名单的各种形状直接喂进去跑，不必开浏览器。
 *
 * 四条最要紧的，坏了都不会当场报错、只会让人「用着不对劲」：
 *  ① **搜索要看班委**。班主任最常找的是「班长是谁」；haystack 里漏掉 `cadreRole` 时，
 *     搜「班长」零结果，而界面上看不出少了什么。
 *  ② **空学号排最后**。Phase 5A 允许学号为空之后，空串与数字串比较会排到最前——
 *     那批「还没补学号」的学生顶在名单头部，是当时没预料到的副作用。
 *  ③ **排序不改入参数组**。`source` 是 store 里的 `activeStudents`，就地排序等于
 *     悄悄改写列表本身；而且 Vue 的 computed 依赖它会连带触发别处的重算。
 *  ④ **界面偏好不进同步名单**。`syncPersisted` 一注册就同时上跨标签页与 CloudBase，
 *     还会参与「最后写入胜出」的冲突判定——教师的搜索框内容不该有这三重后果。
 *  ⑤ **扩围后的字段不能把空值拼进去**（v3.4.0 起 haystack 补上电话 / 备注 /
 *     身份证尾号 / 家庭地址与所在地）。搜「138」「走读」必须只命中确实写了它的人；
 *     空字段若被当成有效文本拼进去，全班都会命中，而界面只是「搜出来有点多」。
 */
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { installFakeBrowser, type FakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import { syncedKeys } from '@/services/sync'
import { useStudentStore } from '@/stores/student'
import { buildRandomRanks, queryStudents } from '@/utils/studentQuery'
import {
  DEFAULT_STUDENT_VIEW_PREFS,
  loadStudentViewPrefs,
  saveStudentViewPrefs,
} from '@/utils/studentViewPrefs'
import type { Student } from '@/types'

const prefix = appConfig.storageKeyPrefix
const STUDENTS_KEY = `${prefix}:students`
const VIEW_KEY = `${prefix}:studentView`

/** 女生的默认值；宿舍与班委按需在 `extra` 里覆盖 */
function makeStudent(
  id: string,
  name: string,
  studentNo: string,
  extra: Partial<Student> = {},
): Student {
  return { id, name, studentNo, gender: 'female', ...extra }
}

/**
 * 固定的测试名单。**学号故意不是按下标递增的**，也**故意留一个空学号**——
 * 若排序实现退化成「按原数组顺序」，这两种排列会立刻露出马脚。
 */
function roster(): Student[] {
  return [
    makeStudent('s1', '张三', '0103', { tags: ['体育骨干'] }),
    makeStudent('s2', '李四', '0101', { cadreRole: '班长' }),
    makeStudent('s3', '王五', ''), // 学号待补（Phase 5A 起允许为空）
    makeStudent('s4', '赵六', '0102', { dormitory: '女生2栋113' }),
  ]
}

function ids(list: Student[]): string[] {
  return list.map((student) => student.id)
}

/** 姓名 → 全拼。**注入假键而不是引 pinyin-pro**：这一层要验的是排序规则本身，
 *  词典准不准是 pinyin-pro 的事，把它拉进来只会让用例依赖第三方数据 */
const ROMAN: Record<string, string> = {
  张三: 'zhangsan',
  李四: 'lisi',
  王五: 'wangwu',
  赵六: 'zhaoliu',
}

function romanKey(name: string): string {
  return ROMAN[name] ?? name
}

let browser: FakeBrowser

beforeEach(() => {
  browser = installFakeBrowser()
})

describe('搜索：字段范围与匹配口径', () => {
  it('搜班委能搜到（Phase 5B 补上的字段——在这之前搜「班长」是零结果）', () => {
    expect(ids(queryStudents(roster(), { keyword: '班长' }))).toEqual(['s2'])
  })

  it('姓名 / 学号 / 宿舍 / 标签都在搜索范围内', () => {
    const source = roster()
    expect(ids(queryStudents(source, { keyword: '赵六' }))).toEqual(['s4'])
    expect(ids(queryStudents(source, { keyword: '0102' }))).toEqual(['s4'])
    expect(ids(queryStudents(source, { keyword: '2栋113' }))).toEqual(['s4'])
    expect(ids(queryStudents(source, { keyword: '体育' }))).toEqual(['s1'])
  })

  it('不区分大小写（拉丁字母的学号 / 标签）', () => {
    const source = [
      makeStudent('a', '甲', 'A0101'),
      makeStudent('b', '乙', 'b0202', { tags: ['Sports'] }),
    ]

    expect(ids(queryStudents(source, { keyword: 'a0101' }))).toEqual(['a'])
    expect(ids(queryStudents(source, { keyword: 'SPORTS' }))).toEqual(['b'])
  })

  it('中文子串匹配（教师不会输入完整的姓名）', () => {
    const source = [makeStudent('a', '旦增卓玛', '0101'), makeStudent('b', '旦增旺堆', '0102')]

    expect(ids(queryStudents(source, { keyword: '旦增' }))).toEqual(['a', 'b'])
    expect(ids(queryStudents(source, { keyword: '卓玛' }))).toEqual(['a'])
  })

  it('空关键词与纯空格都返回全部（空格不该把名单清空）', () => {
    expect(ids(queryStudents(roster(), { keyword: '' }))).toHaveLength(4)
    expect(ids(queryStudents(roster(), { keyword: '   ' }))).toHaveLength(4)
    expect(ids(queryStudents(roster()))).toHaveLength(4)
  })

  it('关键词两端的空格被忽略（从 Excel 里复制过来常带空格）', () => {
    expect(ids(queryStudents(roster(), { keyword: '  班长  ' }))).toEqual(['s2'])
  })

  it('筛选与搜索叠加：性别 / 班委筛选与关键词是「且」的关系', () => {
    const source = [
      makeStudent('a', '甲', '0101', { gender: 'female', cadreRole: '班长' }),
      makeStudent('b', '乙', '0102', { gender: 'male', cadreRole: '班长' }),
      makeStudent('c', '丙', '0103', { gender: 'male' }),
    ]

    expect(ids(queryStudents(source, { gender: 'male' }))).toEqual(['b', 'c'])
    expect(ids(queryStudents(source, { cadreOnly: true }))).toEqual(['a', 'b'])
    expect(ids(queryStudents(source, { gender: 'male', keyword: '班长' }))).toEqual(['b'])
  })
})

describe('搜索：扩围后的字段（电话 / 备注 / 身份证尾号 / 家庭地址与所在地）', () => {
  /**
   * 扩出来的字段**各点一名学生，且互不重叠**——命中谁就是谁。
   * 断言写成 id 列表而不是「数量大于 0」：后者对「搜什么都把全班带出来」同样通过，
   * 而扩 haystack 最典型的事故正是这个（顺手拼进去一个空值 / 一个共享字段）。
   */
  function contactRoster(): Student[] {
    return [
      makeStudent('c1', '旦增卓玛', '0201', { phone: '138 1234 5678' }),
      makeStudent('c2', '旦增旺堆', '0202', { remark: '走读，中午回家吃饭' }),
      makeStudent('c3', '格桑', '0203', { idCardSuffix: '3287' }),
      makeStudent('c4', '卓嘎', '0204', {
        familyAddress: '西藏自治区昌都市卡若区埃西乡××村',
        familyLocation: { prefecture: '昌都市', county: '卡若区', scope: 'changdu-city' },
      }),
      makeStudent('c5', '次仁', '0205', {
        familyLocation: { prefecture: '昌都市', county: '江达县', scope: 'changdu-county' },
      }),
      makeStudent('c6', '白玛', '0206', {
        familyLocation: { prefecture: '拉萨市', county: '城关区', scope: 'outside-changdu' },
      }),
      makeStudent('c7', '扎西', '0207'), // 扩出来的字段一个都没填
    ]
  }

  it('电话能搜到（家长来电，教师手里只有号码，要反查是谁的家长）', () => {
    expect(ids(queryStudents(contactRoster(), { keyword: '13812345678' }))).toEqual(['c1'])
  })

  it('电话存的时候带空格 / 短横也搜得到（按原样敲一半同样算命中）', () => {
    // 盘上存的是「138 1234 5678」，教师拨打时手里只有一串数字，原样敲进来不能搜不到
    expect(ids(queryStudents(contactRoster(), { keyword: '138 1234' }))).toEqual(['c1'])
    expect(ids(queryStudents(contactRoster(), { keyword: '5678' }))).toEqual(['c1'])
  })

  it('备注的内容能搜到（不只是「有备注」这一档）', () => {
    expect(ids(queryStudents(contactRoster(), { keyword: '走读' }))).toEqual(['c2'])
    expect(ids(queryStudents(contactRoster(), { keyword: '中午回家' }))).toEqual(['c2'])
  })

  it('身份证尾号能搜到（报名表 / 学籍表上印的就是它）', () => {
    // 重名的孩子只有尾号分得开，而这两个「旦增」的名字互相匹配得到对方（子串「旦增」）
    expect(ids(queryStudents(contactRoster(), { keyword: '3287' }))).toEqual(['c3'])
    expect(ids(queryStudents(contactRoster(), { keyword: '旦增' }))).toEqual(['c1', 'c2'])
  })

  it('家庭地址全文能搜到（「××乡的孩子有几个」是真实问法）', () => {
    expect(ids(queryStudents(contactRoster(), { keyword: '埃西乡' }))).toEqual(['c4'])
  })

  it('家庭所在地的结构化字段能搜到（地址全文没写的县名也算）', () => {
    expect(ids(queryStudents(contactRoster(), { keyword: '江达县' }))).toEqual(['c5'])
    expect(ids(queryStudents(contactRoster(), { keyword: '卡若区' }))).toEqual(['c4'])
  })

  it('返家范围的中文文案能搜到（地址全文里写的是「昌都市卡若区」，搜「昌都市区」原本零结果）', () => {
    expect(ids(queryStudents(contactRoster(), { keyword: '昌都市区' }))).toEqual(['c4'])
    expect(ids(queryStudents(contactRoster(), { keyword: '昌都市外' }))).toEqual(['c6'])
    // 代价记在这：三类文案共有的「昌都」也一并变成可搜词，所以搜「昌都」会把
    // 「昌都市外」的学生一起带出来——他分明不在昌都。换来的是「昌都市区 / 市外」
    // 这两个真正常用的问法搜得到，这笔账划算，但要写下来而不是假装没有
    expect(ids(queryStudents(contactRoster(), { keyword: '昌都' }))).toEqual(['c4', 'c5', 'c6'])
  })

  it('新字段全空的学生不会被扩围牵连（空值绝不能当成有效文本拼进去）', () => {
    // 扩 haystack 的典型事故：拼进去一个全班共享或人人皆空的值，搜什么都命中一片，
    // 而界面只是「搜出来有点多」，看不出坏了
    expect(ids(queryStudents(contactRoster(), { keyword: '138' }))).toEqual(['c1'])
    expect(ids(queryStudents(contactRoster(), { keyword: '旦增' }))).toEqual(['c1', 'c2'])
  })

  it('扩围之后原有的匹配口径不变：仍是子串、不区分大小写', () => {
    const source = [makeStudent('a', '甲', '0101', { remark: 'Sports Day 请假' })]

    expect(ids(queryStudents(source, { keyword: 'sports' }))).toEqual(['a'])
    expect(ids(queryStudents(source, { keyword: 'SPORTS' }))).toEqual(['a'])
  })
})

describe('默认排序：学号升序，空学号排最后', () => {
  it('按学号升序，与数组原顺序无关', () => {
    expect(ids(queryStudents(roster(), { sort: 'default' }))).toEqual(['s2', 's4', 's1', 's3'])
  })

  it('空学号排在最后，而不是最前（Phase 5A 遗留的副作用就在这里）', () => {
    const sorted = queryStudents(roster(), { sort: 'default' })

    expect(sorted.at(-1)!.id).toBe('s3')
    expect(sorted.at(-1)!.studentNo).toBe('')
  })

  it('全部学号为空时保持原序（没有可比较的键，就不该乱动）', () => {
    const source = [
      makeStudent('a', '甲', ''),
      makeStudent('b', '乙', ''),
      makeStudent('c', '丙', ''),
    ]

    expect(ids(queryStudents(source, { sort: 'default' }))).toEqual(['a', 'b', 'c'])
  })

  it('不修改传入的数组，返回的也永远是新数组', () => {
    const source = roster()
    const snapshot = ids(source)

    const sorted = queryStudents(source, { sort: 'default' })

    expect(ids(source)).toEqual(snapshot)
    expect(sorted).not.toBe(source)
  })

  it('筛选结果同样不共享数组（过滤已产出新数组，排序再拷一次）', () => {
    const source = roster()
    const sorted = queryStudents(source, { keyword: '班长' })

    expect(sorted).not.toBe(source)
    expect(ids(source)).toEqual(['s1', 's2', 's3', 's4'])
  })
})

describe('拼音排序：键由调用方注入', () => {
  it('按注入的键重排，与学号无关', () => {
    const sorted = queryStudents(roster(), { sort: 'pinyin', pinyinKey: romanKey })

    // lisi → wangwu → zhangsan → zhaoliu（注意王五学号为空，仍按拼音排在中段）
    expect(ids(sorted)).toEqual(['s2', 's3', 's1', 's4'])
  })

  it('拼音相同的学生保持原来的相对顺序（同音是并列，不进入第二次比较）', () => {
    const source = [
      makeStudent('a', '张三', '0103'),
      makeStudent('b', '张姗', '0101'), // 与「张三」同音，且学号更小
      makeStudent('c', '李四', '0102'),
    ]
    const samePinyin = (name: string) => (name.startsWith('张') ? 'zhang' : 'li')

    // 期望 a → b 而不是 b → a：若同音时退化成按学号再分一次，b 会跑到前面。
    // 保持原序才说明同音被当成并列，交给了 `Array.prototype.sort` 的稳定性
    expect(ids(queryStudents(source, { sort: 'pinyin', pinyinKey: samePinyin }))).toEqual([
      'c',
      'a',
      'b',
    ])
  })

  it('没传键时退化为默认排序，而不是原地不动', () => {
    // 词典是动态加载的（services/pinyinSort.ts），首次点击「首字母」时可能还没就绪。
    // 这段时间里顺序必须仍是可解释的默认序——不能是「点一下没反应」
    expect(ids(queryStudents(roster(), { sort: 'pinyin' }))).toEqual(['s2', 's4', 's1', 's3'])
  })
})

describe('随机排序：次序来自外部注入的权重表', () => {
  it('buildRandomRanks 产出的是一份完整排列（每个 id 恰好一个位置）', () => {
    const ranks = buildRandomRanks(['a', 'b', 'c', 'd'])

    expect(ranks.size).toBe(4)
    expect([...ranks.keys()].sort()).toEqual(['a', 'b', 'c', 'd'])
    expect([...ranks.values()].sort((x, y) => x - y)).toEqual([0, 1, 2, 3])
  })

  it('同一份权重多次查询结果一致（会话内翻来翻去顺序不变）', () => {
    const ranks = buildRandomRanks(['s1', 's2', 's3', 's4'])
    const first = ids(queryStudents(roster(), { sort: 'random', randomRanks: ranks }))
    const second = ids(queryStudents(roster(), { sort: 'random', randomRanks: ranks }))

    expect(second).toEqual(first)
  })

  it('权重换了顺序就换（「再点一次随机」要真的重洗）', () => {
    const source = roster()
    const forward = new Map([
      ['s1', 0],
      ['s2', 1],
      ['s3', 2],
      ['s4', 3],
    ])
    const backward = new Map([
      ['s1', 3],
      ['s2', 2],
      ['s3', 1],
      ['s4', 0],
    ])

    expect(ids(queryStudents(source, { sort: 'random', randomRanks: forward }))).toEqual([
      's1',
      's2',
      's3',
      's4',
    ])
    expect(ids(queryStudents(source, { sort: 'random', randomRanks: backward }))).toEqual([
      's4',
      's3',
      's2',
      's1',
    ])
  })

  it('没被洗进权重表的学生排到最后，而不是插到最前', () => {
    // 洗牌之后才新增的学生就会是这个处境
    const ranks = new Map([
      ['s1', 0],
      ['s2', 1],
    ])

    expect(ids(queryStudents(roster(), { sort: 'random', randomRanks: ranks }))).toEqual([
      's1',
      's2',
      's3',
      's4',
    ])
  })

  it('没有权重表时保持原序兜底（不做随机，也不报错）', () => {
    expect(ids(queryStudents(roster(), { sort: 'random' }))).toEqual(['s1', 's2', 's3', 's4'])
    expect(ids(queryStudents(roster(), { sort: 'random', randomRanks: new Map() }))).toEqual([
      's1',
      's2',
      's3',
      's4',
    ])
  })
})

describe('纯函数层不碰浏览器', () => {
  it('检索与洗牌都不写盘、不读盘、不删键', () => {
    const source = roster()
    browser.localStorage.seed(STUDENTS_KEY, JSON.stringify(source))
    browser.localStorage.resetCounters()

    queryStudents(source, { keyword: '班长', sort: 'default' })
    queryStudents(source, { sort: 'pinyin', pinyinKey: romanKey })
    queryStudents(source, { sort: 'random', randomRanks: buildRandomRanks(ids(source)) })

    expect(browser.localStorage.writes).toBe(0)
    expect(browser.localStorage.removes).toBe(0)
  })
})

describe('界面偏好：搜索词与排序方式', () => {
  it('写进去再读出来一致（刷新后搜索状态还在）', () => {
    saveStudentViewPrefs({ keyword: '班长', sort: 'pinyin' })

    expect(loadStudentViewPrefs()).toEqual({ keyword: '班长', sort: 'pinyin' })
  })

  it('键不存在时回默认值', () => {
    expect(loadStudentViewPrefs()).toEqual(DEFAULT_STUDENT_VIEW_PREFS)
  })

  it('盘上是坏 JSON → 回默认值且不抛（偏好坏掉不该让档案页打不开）', () => {
    browser.localStorage.seed(VIEW_KEY, '{ 这不是 JSON')

    expect(() => loadStudentViewPrefs()).not.toThrow()
    expect(loadStudentViewPrefs()).toEqual(DEFAULT_STUDENT_VIEW_PREFS)
  })

  it('盘上不是对象（`null` / 字符串）→ 回默认值', () => {
    browser.localStorage.seed(VIEW_KEY, 'null')
    expect(loadStudentViewPrefs()).toEqual(DEFAULT_STUDENT_VIEW_PREFS)

    browser.localStorage.seed(VIEW_KEY, '"hello"')
    expect(loadStudentViewPrefs()).toEqual(DEFAULT_STUDENT_VIEW_PREFS)
  })

  it('盘上写着 random → 收窄成 default，但搜索词照常恢复（随机不落盘）', () => {
    // 正常路径不会写出这个值；这条防的是有人手工改盘、或将来写入侧被改宽
    browser.localStorage.seed(VIEW_KEY, JSON.stringify({ keyword: '走读', sort: 'random' }))

    expect(loadStudentViewPrefs()).toEqual({ keyword: '走读', sort: 'default' })
  })

  it('字段类型不对时逐项回默认，不整条丢掉（搜索词还在就还能用）', () => {
    browser.localStorage.seed(VIEW_KEY, JSON.stringify({ keyword: 123, sort: 'pinyin' }))

    expect(loadStudentViewPrefs()).toEqual({ keyword: '', sort: 'pinyin' })
  })

  it('这个键不登记进同步名单——搜索词与排序是本机偏好，不该上云、也不该参与冲突判定', () => {
    expect(syncedKeys()).not.toContain(VIEW_KEY)

    // 反向确认注册表本身是活的：学生数据确实登记了。
    // 少了这一句，将来注册表整个空掉时上面那条断言会**假通过**
    setActivePinia(createPinia())
    useStudentStore()
    expect(syncedKeys()).toContain(STUDENTS_KEY)
  })
})
