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
