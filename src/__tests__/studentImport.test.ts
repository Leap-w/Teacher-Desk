/**
 * Excel 批量导入（Phase 5A）。
 *
 * 被测的是 `services/studentImport.ts` 的两层：`readSheetRows`（唯一碰 xlsx 的地方）
 * 与 `parseStudentRows` / `planStudentImport`（纯函数）。规则全在纯函数那一层，
 * 所以这里能把班级名单的各种脏写法直接喂进去跑，不必开浏览器。
 *
 * 最要紧的三条，都是「错了会静默丢数据」的类型：
 *  ① **被拦的行绝不能进 plan**。教师看到预览上写着「3 行被拦下」，落库时却把空姓名的
 *     学生也建了档，他不会再去核对一遍。
 *  ② **更新只覆盖这一行确实填了的字段**。教师第二遍导入一份只列「姓名 + 新宿舍」的表，
 *     若把空的单元格当作「清空」，标签和班委就整批没了——而 Excel 里那些格子本来就是空的，
 *     他根本看不出发生了什么。
 *  ③ **合并必须按学号**。学号是唯一的身份键；按姓名合并会把两个「旦增卓玛」合成一个人。
 */
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import { installFakeBrowser, type FakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import { parseStudentRows, planStudentImport, readSheetRows } from '@/services/studentImport'
import { useStudentStore } from '@/stores/student'
import type { Student } from '@/types'

const prefix = appConfig.storageKeyPrefix
const STUDENTS_KEY = `${prefix}:students`

const HEADER = ['姓名', '性别', '学号', '宿舍', '班委', '标签', '联系电话', '家庭住址', '返家范围']

/** 表头 + 数据行 */
function sheet(...rows: unknown[][]): unknown[][] {
  return [HEADER, ...rows]
}

/** 解析成功时取结果；失败就让断言直接炸掉并带上真实错误文案，省得每条用例写一遍收窄 */
function parseOk(rows: unknown[][]) {
  const result = parseStudentRows(rows)
  if (!result.ok) throw new Error(`预期解析成功，实际失败：${result.error}`)
  return result
}

function makeStudent(
  id: string,
  name: string,
  studentNo: string,
  extra: Partial<Student> = {},
): Student {
  return { id, name, studentNo, gender: 'female', ...extra }
}

describe('表头识别：按列名认列，不靠列的位置', () => {
  it('列顺序调换照样认得出（教师在 Excel 里挪过列是常事）', () => {
    const result = parseOk([
      ['学号', '宿舍', '姓名', '性别'],
      ['0101', '女生2栋113', '旦增卓玛', '女'],
    ])

    expect(result.rows[0]!.name).toBe('旦增卓玛')
    expect(result.rows[0]!.studentNo).toBe('0101')
    expect(result.rows[0]!.dormitory).toBe('女生2栋113')
    expect(result.rows[0]!.gender).toBe('female')
  })

  it('表头带「（必填）」这类后缀说明照样认得出', () => {
    const result = parseOk([
      ['姓名（必填）', '性别 (必填)', '学号'],
      ['旦增卓玛', '女', '0101'],
    ])
    expect(result.rows[0]!.studentNo).toBe('0101')
  })

  it('缺「姓名」列时整体报错，不进预览（否则每一行的姓名都会是空的）', () => {
    const result = parseStudentRows([
      ['性别', '学号'],
      ['女', '0101'],
    ])

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('姓名')
  })

  it('缺「性别」列时整体报错（性别是必填，没它整批都写不进去）', () => {
    const result = parseStudentRows([
      ['姓名', '学号'],
      ['旦增卓玛', '0101'],
    ])

    expect(result.ok).toBe(false)
  })

  it('表头下面没有数据行时给出明确错误，而不是一个空的预览', () => {
    const result = parseStudentRows([HEADER])
    expect(result.ok).toBe(false)
  })
})

describe('逐行校验：拦的只有空姓名与重复学号，其余只提示', () => {
  it('空姓名被拦下', () => {
    const result = parseOk(sheet(['', '女', '0101']))
    expect(result.rows[0]!.errors).toContain('姓名为空')
  })

  it('性别支持中文、英文与单字母缩写', () => {
    const result = parseOk(
      sheet(['甲', '男', '0101'], ['乙', '女生', '0102'], ['丙', 'M', '0103'], ['丁', 'F', '0104']),
    )

    expect(result.rows.map((row) => row.gender)).toEqual(['male', 'female', 'male', 'female'])
  })

  it('性别认不出来时拦下该行（gender 是必填字段，认不出就没法写）', () => {
    const result = parseOk(sheet(['甲', '未知', '0101']))
    expect(result.rows[0]!.errors.join()).toContain('性别')
  })

  it('表内学号重复：只留第一行，后面的拦下并指出与第几行冲突', () => {
    const result = parseOk(sheet(['甲', '女', '0101'], ['乙', '女', '0101']))

    expect(result.rows[0]!.errors).toEqual([])
    // 不指出第几行的话，教师拿着几十行名单没法找是哪一个重了
    expect(result.rows[1]!.errors.join()).toContain('第 2 行')
  })

  it('宿舍不在固定清单内：只提示、不拦，且该行宿舍留空', () => {
    const result = parseOk(sheet(['甲', '女', '0101', '3 号楼 412']))
    const row = result.rows[0]!

    // 学生本身是有效的，不该为了一间写错的宿舍丢掉整条档案
    expect(row.errors).toEqual([])
    expect(row.warnings.join()).toContain('3 号楼 412')
    expect(row.dormitory).toBe('')
    expect(row.dormitoryRejected).toBe(true)
  })

  it('宿舍属于另一个性别时同样算不合法（女生不能住男生楼）', () => {
    const result = parseOk(sheet(['甲', '女', '0101', '男生1栋209']))

    expect(result.rows[0]!.dormitory).toBe('')
    expect(result.rows[0]!.dormitoryRejected).toBe(true)
  })

  it('宿舍在清单内则原样保留', () => {
    const result = parseOk(sheet(['甲', '男', '0101', '男生1栋209']))
    expect(result.rows[0]!.dormitory).toBe('男生1栋209')
    expect(result.rows[0]!.dormitoryRejected).toBe(false)
  })

  it('标签按中英文逗号、顿号、分号切开并去重', () => {
    const result = parseOk(
      sheet(['甲', '女', '0101', '', '', '三好学生，体育骨干、三好学生; 文艺']),
    )
    // 重复的「三好学生」只留一次：重复标签会在卡片上排出两个一模一样的徽章
    expect(result.rows[0]!.tags).toEqual(['三好学生', '体育骨干', '文艺'])
  })

  it('学号为空：不拦，但明确提示「每次导入都会新增一条」', () => {
    const result = parseOk(sheet(['甲', '女', '']))
    const row = result.rows[0]!

    expect(row.errors).toEqual([])
    // 没有学号就没有合并依据，这条必须让教师看见，否则他会以为第二遍导入是「更新」
    expect(row.warnings.join()).toContain('每次导入都会新增一条')
  })

  it('返家范围能认出正式文案与常见简写', () => {
    const result = parseOk(
      sheet(
        ['甲', '女', '0101', '', '', '', '', '', '昌都市区'],
        ['乙', '女', '0102', '', '', '', '', '', '市外'],
      ),
    )

    expect(result.rows[0]!.scope).toBe('changdu-city')
    expect(result.rows[1]!.scope).toBe('outside-changdu')
  })

  it('中间的空行被跳过，且后面各行的行号仍与 Excel 里一致', () => {
    const result = parseOk(sheet(['甲', '女', '0101'], [], ['乙', '女', '0102']))

    expect(result.rows).toHaveLength(2)
    // 行号是教师回 Excel 找那一行的唯一线索，跳过空行时绝不能顺移
    expect(result.rows[1]!.rowNumber).toBe(4)
  })
})

describe('合并分流：学号命中更新、没命中新增，被拦的一律不进计划', () => {
  it('学号命中库内学生 → 更新；没命中 → 新增', () => {
    const existing = [makeStudent('s1', '旦增卓玛', '0101')]
    const result = planStudentImport(
      parseOk(sheet(['旦增卓玛', '女', '0101'], ['新同学', '男', '0102'])).rows,
      existing,
    )

    expect(result.updated).toBe(1)
    expect(result.added).toBe(1)
    expect(result.plan.updates[0]!.id).toBe('s1')
    expect(result.plan.adds).toHaveLength(1)
    expect(result.plan.adds[0]!.name).toBe('新同学')
  })

  it('被拦下的行不进计划——预览说「拦下 1 行」，落库就不能多出一个人', () => {
    const result = planStudentImport(
      parseOk(sheet(['', '女', '0101'], ['乙', '女', '0102'])).rows,
      [],
    )

    expect(result.blocked).toBe(1)
    expect(result.importable).toBe(1)
    expect(result.plan.adds).toHaveLength(1)
    expect(result.plan.adds[0]!.name).toBe('乙')
  })

  it('重名只提示、不拦（同名是两个真实的人，不是错误）', () => {
    const existing = [makeStudent('s1', '旦增卓玛', '0101')]
    const result = planStudentImport(parseOk(sheet(['旦增卓玛', '女', '0102'])).rows, existing)

    expect(result.blocked).toBe(0)
    expect(result.importable).toBe(1)
    expect(result.duplicateNames).toContain('旦增卓玛')
  })

  it('学号为空的行走新增且不参与匹配，并计入「每次都会新增」的提示数', () => {
    const existing = [makeStudent('s1', '甲', '0101')]
    const result = planStudentImport(parseOk(sheet(['甲', '女', ''])).rows, existing)

    // 绝不能按姓名匹配：那会把两个同名学生合成一个人，且丢掉的档案不可恢复
    expect(result.added).toBe(1)
    expect(result.updated).toBe(0)
    expect(result.emptyStudentNo).toBe(1)
  })

  it('软删除的学生不参与匹配（已退档的学号不该把新学生合并进去）', () => {
    const existing = [makeStudent('s1', '甲', '0101', { deletedAt: '2026-01-01T00:00:00.000Z' })]
    const result = planStudentImport(parseOk(sheet(['甲', '女', '0101'])).rows, existing)

    expect(result.added).toBe(1)
    expect(result.updated).toBe(0)
  })

  it('身份证尾号列：认得出，且随新增 / 更新两条路径落库（v3.3.1）', () => {
    const header = [...HEADER, '身份证尾号']
    const parsed = parseStudentRows([
      header,
      ['甲', '女', '0101', '', '', '', '', '', '昌都市区', '3287'],
    ])
    if (!parsed.ok) throw new Error(`预期解析成功，实际失败：${parsed.error}`)
    expect(parsed.rows[0]!.idCardSuffix).toBe('3287')
    expect(parsed.columns).toContain('身份证尾号')

    // 新增：带进 StudentInput
    const added = planStudentImport(parsed.rows, [])
    expect(added.plan.adds[0]!.idCardSuffix).toBe('3287')

    // 更新：同样带上（学号命中）
    const updated = planStudentImport(parsed.rows, [makeStudent('s1', '甲', '0101')])
    expect(updated.plan.updates[0]!.patch.idCardSuffix).toBe('3287')
  })

  it('身份证尾号超过 4 位时截断（Excel 里写成一整串也不会被整段存下）', () => {
    const parsed = parseStudentRows([
      [...HEADER, '身份证尾号'],
      ['甲', '女', '0101', '', '', '', '', '', '昌都市区', '110101199001013287'],
    ])
    if (!parsed.ok) throw new Error(`预期解析成功，实际失败：${parsed.error}`)
    expect(parsed.rows[0]!.idCardSuffix).toBe('1101')
  })

  it('空格子不覆盖既有尾号（与其它字段同一口径）', () => {
    const existing = [makeStudent('s1', '甲', '0101', { idCardSuffix: '3287' })]
    const result = planStudentImport(parseOk(sheet(['甲', '女', '0101'])).rows, existing)
    expect(result.plan.updates[0]!.patch.idCardSuffix).toBeUndefined()
  })

  it('更新只带这一行确实填了的字段，空格子不覆盖既有值', () => {
    const existing = [
      makeStudent('s1', '甲', '0101', {
        cadreRole: '班长',
        tags: ['三好学生'],
        phone: '13800000000',
        dormitory: '女生2栋113',
      }),
    ]
    // 一份只列「姓名 + 性别 + 学号」的表：班委 / 标签 / 电话 / 宿舍四列全空
    const result = planStudentImport(parseOk(sheet(['甲', '女', '0101'])).rows, existing)
    const patch = result.plan.updates[0]!.patch

    expect(patch.name).toBe('甲')
    // 这四行是本节最要紧的断言：Excel 里那几格本来就是空的，
    // 若被当成「清空」就整批抹掉，而教师从表面上看不出发生了什么
    expect(patch.cadreRole).toBeUndefined()
    expect(patch.tags).toBeUndefined()
    expect(patch.phone).toBeUndefined()
    expect(patch.dormitory).toBeUndefined()
  })

  it('更新返家范围时保留已录的所属地区与县区（Excel 里没有这两列）', () => {
    const existing = [
      makeStudent('s1', '甲', '0101', {
        familyLocation: { prefecture: '昌都市', county: '卡若区', scope: 'changdu-city' },
      }),
    ]
    const result = planStudentImport(
      parseOk(sheet(['甲', '女', '0101', '', '', '', '', '', '昌都市外'])).rows,
      existing,
    )
    const patch = result.plan.updates[0]!.patch

    // familyLocation 是 obj 一体的，整体替换会把教师已录的地区和县区一起清掉
    expect(patch.familyLocation).toEqual({
      prefecture: '昌都市',
      county: '卡若区',
      scope: 'outside-changdu',
    })
  })

  it('统计口径自洽：可导入 = 新增 + 更新，总数 = 可导入 + 被拦', () => {
    const result = planStudentImport(
      parseOk(
        sheet(
          ['甲', '女', '0101'],
          ['', '女', '0102'],
          ['丙', '男', '0103', '3 号楼 412'],
          ['丁', '女', ''],
        ),
      ).rows,
      [],
    )

    expect(result.total).toBe(4)
    expect(result.importable).toBe(result.added + result.updated)
    expect(result.total).toBe(result.importable + result.blocked)
    // 宿舍写错留着空值但学生照常导入，所以它是「提示」不是「拦下」
    expect(result.missingDormitory).toBe(1)
    expect(result.blocked).toBe(1)
  })
})

/**
 * v3.5.0 补的三列：备注 / 所属地区 / 所属县·区。
 *
 * 需求方报的洞：「学生档案导入模板缺少所属县市、备注等信息」——导入模板只认 10 列，
 * 而档案页能填 13 项，于是 Excel 建完档还得逐个点开补。
 *
 * 这一节守两件事：
 * ① 三个字段要真的能**写进去**（新增与更新两条路都算）；
 * ② 所属地区 / 县区与返家范围同属 `familyLocation` 一个对象，**逐格合并**——
 *    只填了县区的那一行，不能把教师已录的地区和范围一起抹掉。
 */
describe('所属地区 / 所属县·区 / 备注（v3.5.0 补齐的列）', () => {
  /** 这一节的表头按新列的**语义**排，与位置无关（解析器按列名认列） */
  const FULL_HEADER = [
    '姓名',
    '性别',
    '学号',
    '宿舍',
    '班委',
    '联系电话',
    '标签',
    '备注',
    '返家范围',
    '所属地区',
    '所属县/区',
    '家庭地址',
  ]

  function fullSheet(...rows: unknown[][]): unknown[][] {
    return [FULL_HEADER, ...rows]
  }

  it('三个新字段能写进新增（含家庭地址与返家范围一起）', () => {
    const result = parseOk(
      fullSheet([
        '甲',
        '女',
        '0101',
        '女生2栋113',
        '班长',
        '13800000000',
        '住校生',
        '家长长期在外，由爷爷接送',
        '昌都市其他县',
        '昌都市',
        '江达县',
        '西藏自治区昌都市江达县岗托镇某村',
      ]),
    )
    const row = result.rows[0]!

    expect(row.remark).toBe('家长长期在外，由爷爷接送')
    expect(row.prefecture).toBe('昌都市')
    expect(row.county).toBe('江达县')

    const input = planStudentImport(result.rows, []).plan.adds[0]!
    expect(input.remark).toBe('家长长期在外，由爷爷接送')
    expect(input.familyLocation).toEqual({
      prefecture: '昌都市',
      county: '江达县',
      scope: 'changdu-county',
    })
  })

  it('「备注」列的空格子不覆盖既有备注（与其它字段同一口径）', () => {
    const existing = [makeStudent('s1', '甲', '0101', { remark: '班里的留守儿童' })]
    const result = planStudentImport(parseOk(fullSheet(['甲', '女', '0101'])).rows, existing)
    expect(result.plan.updates[0]!.patch.remark).toBeUndefined()
  })

  it('只填了「所属县/区」、没填返家范围时，仍能更新已有档案（scope 沿用库里那份）', () => {
    const existing = [
      makeStudent('s1', '甲', '0101', {
        familyLocation: { prefecture: '昌都市', county: '卡若区', scope: 'changdu-city' },
      }),
    ]
    // 第 9 格（返家范围）留空，第 11 格（所属县/区）改成左贡县
    const result = planStudentImport(
      parseOk(fullSheet(['甲', '女', '0101', '', '', '', '', '', '', '', '左贡县'])).rows,
      existing,
    )
    const patch = result.plan.updates[0]!.patch

    expect(patch.familyLocation).toEqual({
      prefecture: '昌都市', // 表里没填 → 沿用库里的
      county: '左贡县', // 表里填了 → 以表为准
      scope: 'changdu-city', // 表里没填 → 沿用库里的
    })
  })

  it('新建的档案缺返家范围时，明说所属地区 / 县区存不下（不替教师编一个分类）', () => {
    const result = parseOk(
      fullSheet(['甲', '女', '0101', '', '', '', '', '', '', '昌都市', '江达县']),
    )

    // scope 是模型里的必填枚举。没有它，这两个字段无处安放——**不静默丢掉，也不默认成
    // 「昌都市其他县」**（那会把拉萨的学生算进昌都，直接污染周末返家统计），而是说清楚
    expect(result.rows[0]!.warnings.some((text) => text.includes('存不下'))).toBe(true)

    const input = planStudentImport(result.rows, []).plan.adds[0]!
    expect(input.familyLocation).toBeUndefined()
  })

  it('所属地区 / 县区的别名收得住（「所属县市」「所在地区」这类写法）', () => {
    const result = parseOk([
      ['姓名', '性别', '所在地区', '所属县市'],
      ['甲', '女', '拉萨市', '城关区'],
    ])
    expect(result.rows[0]!.prefecture).toBe('拉萨市')
    expect(result.rows[0]!.county).toBe('城关区')
  })

  it('「家庭住址」这个老写法照样认（这一版把模板标签改成了「家庭地址」）', () => {
    const result = parseOk([
      ['姓名', '性别', '家庭住址'],
      ['甲', '女', '西藏自治区昌都市卡若区某村'],
    ])
    expect(result.rows[0]!.familyAddress).toBe('西藏自治区昌都市卡若区某村')
  })
})

/**
 * 昌都市内亲属 / 亲戚关系（v3.6.1）。
 *
 * 这一列有两个与其它列不同的性质，两条都只能在数据层验：
 *  ① 它是**三态**的（有 / 无 / 没问过），而 Excel 只有「格子空着」一种表达「没问过」的方式。
 *     `undefined` 与 `false` 在导出名单上是空单元格与「无」的区别，混起来就再也分不回来。
 *  ② 它是**唯一一处「空 = 清空」**：填「无」时必须连关系一起抹掉，否则留下「无（舅舅）」。
 *     其余所有列的「空 = 本次没填」，这一条反过来写就会静默丢数据。
 */
describe('昌都市内亲属 / 亲戚关系（v3.6.1）', () => {
  let browser: FakeBrowser
  beforeEach(() => {
    browser = installFakeBrowser()
    setActivePinia(createPinia())
  })

  /** 模板的真实列序：两列在**最后**（家庭地址之后），老表头在前 */
  const V361_HEADER = [...HEADER, '昌都市内亲属', '亲戚关系']

  /**
   * v3.6.1 表头下的一行：前 9 格对齐 HEADER，后两格是新列。
   * 学号与返家范围都给上——**默认填满**，这样用例里那条「一条提示都没有」的断言
   * 才只可能被新列的逻辑弄红，而不是被「学号为空」「缺返家范围」这两条无关的提示搅和。
   */
  function row361(name: string, flag: string, relation: string, studentNo: string): string[] {
    return [name, '女', studentNo, '', '', '', '', '', '昌都市区', flag, relation]
  }

  function parseV361(...rows: unknown[][]) {
    return parseOk([V361_HEADER, ...rows])
  }

  /** 落库路径就是 `JSON.stringify` —— 用它断言「这个字段压根没写」，与盘上的形状一致 */
  function persisted(value: unknown): Record<string, unknown> {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
  }

  it('两列都认得出，且列序排在家庭地址之后（与模板列序一致）', () => {
    const result = parseV361(row361('甲', '有', '舅舅', '0101'))
    expect(result.columns.slice(-2)).toEqual(['昌都市内亲属', '亲戚关系'])
    expect(result.rows[0]!.hasChangduRelative).toBe(true)
    expect(result.rows[0]!.changduRelativeRelation).toBe('舅舅')
  })

  it('常见写法都认得出：有 / 是 / TRUE / 1 / ✓ / √ / yes 与它们的反面', () => {
    const yes = ['有', '是', 'TRUE', '1', '✓', '√', 'yes']
    const no = ['无', '否', '没有', 'false', '0', '×', 'no']

    for (const text of yes) {
      const parsed = parseV361(row361('甲', text, '', '0101'))
      expect(parsed.rows[0]!.hasChangduRelative, `「${text}」应认作有`).toBe(true)
    }
    for (const text of no) {
      const parsed = parseV361(row361('甲', text, '', '0101'))
      expect(parsed.rows[0]!.hasChangduRelative, `「${text}」应认作无`).toBe(false)
    }
  })

  it('空着 = 没问过（三态的第三态），既不报错也不猜', () => {
    const result = parseV361(row361('甲', '', '', '0101'), row361('乙', '   ', '', '0102'))

    expect(result.rows[0]!.hasChangduRelative).toBeUndefined()
    expect(result.rows[1]!.hasChangduRelative).toBeUndefined()
    // 空着不是问题，一条提示都不该有——否则一份老名单导入会弹出满屏警告
    expect(result.rows.flatMap((row) => row.warnings)).toEqual([])
  })

  it('认不出的写法**不猜**：按未填处理并点名那一格（猜错的方向正好是「有亲属的记成没有」）', () => {
    const result = parseV361(row361('甲', '不知道', '', '0101'), row361('乙', '有一点', '', '0102'))

    expect(result.rows[0]!.hasChangduRelative).toBeUndefined()
    expect(result.rows[1]!.hasChangduRelative).toBeUndefined()
    expect(result.rows[0]!.warnings.join()).toContain('不知道')
    expect(result.rows[0]!.warnings.join()).toContain('无法识别')
  })

  it('交叉规则：填了关系却空着有无列 → 按「有」记，并说明是我们替他定的', () => {
    const result = parseV361(row361('甲', '', '舅舅', '0101'))

    expect(result.rows[0]!.hasChangduRelative).toBe(true)
    expect(result.rows[0]!.changduRelativeRelation).toBe('舅舅')
    expect(result.rows[0]!.warnings.join()).toContain('按「有」处理')
  })

  it('交叉规则：有无列写着「无」→ 关系一律丢弃，不留「无（舅舅）」这种自相矛盾的行', () => {
    const result = parseV361(row361('甲', '无', '舅舅', '0101'))

    expect(result.rows[0]!.hasChangduRelative).toBe(false)
    expect(result.rows[0]!.changduRelativeRelation).toBe('')
    expect(result.rows[0]!.warnings.join()).toContain('舅舅')
  })

  it('交叉规则：写着「有」没写关系 → 合法，不提示（追问得到答案但答不出细节是常事）', () => {
    const result = parseV361(row361('甲', '有', '', '0101'))

    expect(result.rows[0]!.hasChangduRelative).toBe(true)
    expect(result.rows[0]!.changduRelativeRelation).toBe('')
    expect(result.rows[0]!.warnings).toEqual([])
  })

  it('老文件（没有这两列）一条错误一条提示都没有，也不写这两个字段', () => {
    // 旧模板就是这 9 列。缺列必须静默——教师手上几十份老名单，弹一句「没找到某列」
    // 都不该出现；更不能顺手把档案里已有的值清成「没问过」
    const parsed = parseOk(sheet(['甲', '女', '0101', '', '', '', '', '', '昌都市区']))
    expect(parsed.rows[0]!.errors).toEqual([])
    expect(parsed.rows[0]!.warnings).toEqual([])

    const existing = [
      makeStudent('s1', '甲', '0101', {
        hasChangduRelative: true,
        changduRelativeRelation: '舅舅',
      }),
    ]
    const result = planStudentImport(parsed.rows, existing)

    // 命中学号 → 更新：**一个字段都不进 patch**。进了 patch 就等于「本次没提」变成
    // 「按 undefined 写」，档案里那份「有(舅舅)」会被老名单静默抹掉
    expect(result.plan.updates).toHaveLength(1)
    const patch = persisted(result.plan.updates[0]!.patch)
    expect(patch).not.toHaveProperty('hasChangduRelative')
    expect(patch).not.toHaveProperty('changduRelativeRelation')

    // 没命中学号 → 新增：同样是「没问过」，不是「没有」
    const added = persisted(planStudentImport(parsed.rows, []).plan.adds[0])
    expect(added).not.toHaveProperty('hasChangduRelative')
    expect(added).not.toHaveProperty('changduRelativeRelation')
  })

  it('新增：有亲属带关系照单全收；「无」不留下关系字段', () => {
    const parsed = parseV361(row361('甲', '有', ' 姑姑 ', '0101'), row361('乙', '无', '', '0102'))
    const result = planStudentImport(parsed.rows, [])

    const withRelative = persisted(result.plan.adds[0])
    expect(withRelative.hasChangduRelative).toBe(true)
    expect(withRelative.changduRelativeRelation).toBe('姑姑')

    const without = persisted(result.plan.adds[1])
    expect(without.hasChangduRelative).toBe(false)
    expect(without).not.toHaveProperty('changduRelativeRelation')
  })

  it('更新：填「有」但关系空着时**沿用**既有关系（与其它列同一口径：空 = 本次没填）', () => {
    const existing = [
      makeStudent('s1', '甲', '0101', {
        hasChangduRelative: true,
        changduRelativeRelation: '舅舅',
      }),
    ]
    const parsed = parseV361(row361('甲', '有', '', '0101'))
    const result = planStudentImport(parsed.rows, existing)

    const patch = persisted(result.plan.updates[0]!.patch)
    expect(patch.hasChangduRelative).toBe(true)
    expect(patch).not.toHaveProperty('changduRelativeRelation')
  })

  it('落库：「有(舅舅)」改成「无」时关系一起清掉，盘上不留「无（舅舅）」', async () => {
    browser.localStorage.seed(
      STUDENTS_KEY,
      JSON.stringify([
        makeStudent('s1', '甲', '0101', {
          hasChangduRelative: true,
          changduRelativeRelation: '舅舅',
        }),
      ]),
    )
    const store = useStudentStore()
    const parsed = parseV361(row361('甲', '无', '', '0101'))
    const result = planStudentImport(parsed.rows, store.students)

    store.applyStudentImport(result.plan)
    await nextTick()

    const updated = store.students.find((student) => student.id === 's1')!
    expect(updated.hasChangduRelative).toBe(false)
    expect(updated.changduRelativeRelation).toBeUndefined()
    // 盘上的形状也要干净：JSON 会丢掉 undefined 键，「设成 undefined」与「没有这个键」
    // 在落库这一层必须收敛成同一个结果，否则每次读回来都要重新判断一次
    const onDisk = JSON.parse(browser.localStorage.getItem(STUDENTS_KEY)!) as Array<
      Record<string, unknown>
    >
    expect(onDisk[0]).not.toHaveProperty('changduRelativeRelation')
  })

  it('落库：「无」改成「有(姑姑)」时两个字段都写进去', async () => {
    browser.localStorage.seed(
      STUDENTS_KEY,
      JSON.stringify([makeStudent('s1', '甲', '0101', { hasChangduRelative: false })]),
    )
    const store = useStudentStore()
    const parsed = parseV361(row361('甲', '有', '姑姑', '0101'))
    const result = planStudentImport(parsed.rows, store.students)

    store.applyStudentImport(result.plan)
    await nextTick()

    const updated = store.students.find((student) => student.id === 's1')!
    expect(updated.hasChangduRelative).toBe(true)
    expect(updated.changduRelativeRelation).toBe('姑姑')
  })
})

describe('readSheetRows：唯一碰 xlsx 的一层', () => {
  it('读得回一份真造的 xlsx，并说清读了哪个工作表', async () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(sheet(['甲', '女', '0101'])),
      '名单',
    )
    const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer

    const result = await readSheetRows(buffer)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sheetName).toBe('名单')
    expect(result.sheetCount).toBe(1)

    // 第 1 层 + 第 2 层连起来跑一遍：这才是教师点完文件之后真实走的那条路
    const parsed = parseStudentRows(result.rows)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.rows[0]!.studentNo).toBe('0101')
  })

  it('文件里有多个工作表时说清只读了第一个（避免教师改错了表却看不出来）', async () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(sheet(['甲', '女', '0101'])),
      '一班',
    )
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(sheet(['乙', '男', '0201'])),
      '二班',
    )
    const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer

    const result = await readSheetRows(buffer)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sheetName).toBe('一班')
    expect(result.sheetCount).toBe(2)
  })

  it('下到一半的 xlsx：返回错误而不是抛异常（抛出去会把整个页面打断）', async () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(sheet(['甲', '女', '0101'])),
      '名单',
    )
    const full = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const truncated = full.slice(0, Math.floor(full.byteLength / 2))

    const result = await readSheetRows(truncated)

    expect(result.ok).toBe(false)
  })

  it('把 CSV 改名成 .xlsx 时，明说「这不是 Excel」而不是让教师去改表头', async () => {
    // SheetJS 的 read 会自动嗅探 CSV，纯文本喂进去它照样「成功」，而且按 latin1 解码——
    // 「姓名」变成「å§å」，于是表头明明写着姓名，错误却是「没有找到「姓名」列」。
    // 教师会在表头上反复改也改不对，所以这一层必须在交给 xlsx 之前就挡下
    const result = await readSheetRows(
      // TypedArray.buffer 在 TS 里的类型是 ArrayBufferLike（含 SharedArrayBuffer），
      // 而 readSheetRows 收的是 ArrayBuffer —— 这里造的就是本进程内的普通缓冲区
      new TextEncoder().encode('姓名,性别\n甲,女').buffer as ArrayBuffer,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('不是 Excel')
    expect(result.error).toContain('另存为')
  })

  it('空文件给出明确提示，不至于让预览停在「读取中」', async () => {
    const result = await readSheetRows(new ArrayBuffer(0))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('空')
  })
})

describe('落库：整批一次写盘', () => {
  let browser: FakeBrowser

  beforeEach(() => {
    browser = installFakeBrowser()
    setActivePinia(createPinia())
  })

  it('一次性替换学生数组，只写一次盘（逐行调 addStudent 会写 N 次盘 + 广播 N 次）', async () => {
    browser.localStorage.seed(STUDENTS_KEY, JSON.stringify([makeStudent('s1', '甲', '0101')]))
    const store = useStudentStore()
    const parsed = parseOk(sheet(['乙', '女', '0102'], ['丙', '男', '0103'], ['甲', '女', '0101']))
    const result = planStudentImport(parsed.rows, store.students)

    browser.localStorage.resetCounters()
    const outcome = store.applyStudentImport(result.plan)
    await nextTick()

    expect(outcome).toEqual({ added: 2, updated: 1 })
    expect(store.students).toHaveLength(3)
    expect(browser.localStorage.writesFor(STUDENTS_KEY)).toBe(1)
  })

  it('更新保留既有字段与软删除标记：展开合并不整条替换', async () => {
    browser.localStorage.seed(
      STUDENTS_KEY,
      JSON.stringify([
        makeStudent('s1', '甲', '0101', { cadreRole: '班长', seatNumber: 7, deletedAt: undefined }),
        makeStudent('s2', '已退档', '0102', { deletedAt: '2026-01-01T00:00:00.000Z' }),
      ]),
    )
    const store = useStudentStore()
    const parsed = parseOk(sheet(['甲', '女', '0101']))
    const result = planStudentImport(parsed.rows, store.students)

    store.applyStudentImport(result.plan)
    await nextTick()

    const updated = store.students.find((item) => item.id === 's1')!
    expect(updated.cadreRole).toBe('班长')
    // 座位号已退出界面但模型字段保留：座位方案的「＋ 新建方案」还靠它自动就座，
    // 导入更新若把它抹掉，新建方案时这些学生就不会被排上座
    expect(updated.seatNumber).toBe(7)
    // 已退档的学生不参与匹配，也不该被顺手改动
    expect(store.students.find((item) => item.id === 's2')!.deletedAt).toBeDefined()
  })
})
