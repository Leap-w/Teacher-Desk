/**
 * 假期名单导出的自检（v3.6.1，规格第 7 节）。
 *
 * 这一层盯的是**「屏幕上看着都对、导出来才发现错」**的那几类事——它们不会报错，
 * 也不会让页面有任何异常，只有把文件打开逐格看才看得出来：
 *
 * ① **「未填」不能写成「无」**。这是本次升级里「三态不可折叠」在导出上的落点：
 *    空格 = 还没问过、要去问，「无」= 问过了、确实没有。写成「无」等于替教师
 *    回答了没问过的问题，而他再也没法从这份表里把这两批人分回来。
 * ② **「亲戚关系」只在「有亲属」时写**。数据层已保证，但导出的表会被打印、转发出去，
 *    自相矛盾的一行一旦印出来就收不回了，所以这一层再挡一次。
 * ③ **未登记的学生必须在表里**——这份表的主要用处之一就是拿它去问还没登记的那几个。
 * ④ 列序与表头逐字对齐规格（EXCEL 是按列读的，挪一列就是错一列）。
 */
import { describe, expect, it } from 'vitest'

import {
  HOLIDAY_EXPORT_HEADERS,
  buildHolidayRosterSheet,
  holidayExportFilename,
} from '@/utils/holidayExport'
import type { HolidayRosterRow } from '@/utils/holidayQuery'
import type { HolidayStatus } from '@/types/holiday'
import type { Student } from '@/types'

/* ==================== 造数据 ==================== */

function student(id: string, name: string, extra: Partial<Student> = {}): Student {
  return { id, name, studentNo: '', gender: 'female', ...extra }
}

function row(studentRow: Student, status: HolidayStatus): HolidayRosterRow {
  return { student: studentRow, status }
}

const NAME_COUNTS = new Map<string, number>()

/** 取某一列的全部取值（按表头名找下标，不写死列号——挪列时这些测试会一起跟着动） */
function column(
  sheet: { headers: readonly string[]; rows: readonly (readonly (string | number)[])[] },
  header: string,
): (string | number)[] {
  const index = sheet.headers.indexOf(header)
  expect(index, `表头里没有「${header}」`).toBeGreaterThanOrEqual(0)
  return sheet.rows.map((line) => line[index] ?? '')
}

/* ==================== 表头与列序 ==================== */

describe('表头与列序', () => {
  it('九列，逐字对齐规格第 7 节', () => {
    expect([...HOLIDAY_EXPORT_HEADERS]).toEqual([
      '序号',
      '姓名',
      '性别',
      '学号',
      '家庭所在地',
      '昌都市内亲属',
      '亲戚关系',
      '假期去向',
      '备注',
    ])
  })

  it('每一行的格子数与表头一致（少一格会让后面的值整体左移一列）', () => {
    const sheet = buildHolidayRosterSheet(
      '国庆',
      [row(student('s1', '张三', { studentNo: '01' }), 'home')],
      NAME_COUNTS,
    )
    for (const line of sheet.rows) expect(line).toHaveLength(HOLIDAY_EXPORT_HEADERS.length)
  })

  it('工作表名就是假期名（教师在同一份文件里多个假期时靠它分）', () => {
    expect(buildHolidayRosterSheet('藏历新年', [], NAME_COUNTS).sheetName).toBe('藏历新年')
  })

  it('序号从 1 开始，按传入顺序', () => {
    const sheet = buildHolidayRosterSheet(
      '国庆',
      [row(student('s1', '张三'), 'home'), row(student('s2', '李四'), 'stay')],
      NAME_COUNTS,
    )
    expect(column(sheet, '序号')).toEqual([1, 2])
  })
})

/* ==================== 三态与未填 ==================== */

describe('昌都市内亲属这一列：三态不可折叠', () => {
  const sheet = buildHolidayRosterSheet(
    '国庆',
    [
      row(student('s1', '甲', { hasChangduRelative: true }), 'home'),
      row(student('s2', '乙', { hasChangduRelative: false }), 'stay'),
      // 什么都没填：这一格必须是空的
      row(student('s3', '丙'), 'unregistered'),
    ],
    NAME_COUNTS,
  )

  it('有 → 「有」，无 → 「无」，**没填 → 空串（绝不写「无」）**', () => {
    expect(column(sheet, '昌都市内亲属')).toEqual(['有', '无', ''])
  })

  it('空串与「无」在表里是两格不同的值——教师据此认出「这批还没问」', () => {
    const values = column(sheet, '昌都市内亲属')
    expect(values[2]).not.toBe(values[1])
  })

  it('未登记的学生**在表里**，去向列写「未登记」（这份表的用处之一就是拿它去问）', () => {
    expect(column(sheet, '假期去向')).toContain('未登记')
  })

  it('三态去向逐字写出来，不写英文、不缩写', () => {
    expect(column(sheet, '假期去向')).toEqual(['回家', '留校', '未登记'])
  })
})

describe('亲戚关系这一列：只在「有亲属」时写', () => {
  it('有 + 填了关系 → 两格都写', () => {
    const sheet = buildHolidayRosterSheet(
      '国庆',
      [
        row(
          student('s1', '甲', { hasChangduRelative: true, changduRelativeRelation: '舅舅' }),
          'home',
        ),
      ],
      NAME_COUNTS,
    )
    expect(column(sheet, '昌都市内亲属')).toEqual(['有'])
    expect(column(sheet, '亲戚关系')).toEqual(['舅舅'])
  })

  it('有但没写关系 → 合法，关系栏留空（不是每种亲属都非得写出来）', () => {
    const sheet = buildHolidayRosterSheet(
      '国庆',
      [row(student('s1', '甲', { hasChangduRelative: true }), 'home')],
      NAME_COUNTS,
    )
    expect(column(sheet, '亲戚关系')).toEqual([''])
  })

  it('**明确「无」时关系栏一定为空**（自相矛盾的「无（舅舅）」印出去就收不回了）', () => {
    const sheet = buildHolidayRosterSheet(
      '国庆',
      [
        row(
          student('s1', '甲', { hasChangduRelative: false, changduRelativeRelation: '舅舅' }),
          'stay',
        ),
      ],
      NAME_COUNTS,
    )
    expect(column(sheet, '昌都市内亲属')).toEqual(['无'])
    expect(column(sheet, '亲戚关系')).toEqual([''])
  })

  it('未填时关系栏也为空（关系是从属于「有」的，没有「有」就没有它）', () => {
    const sheet = buildHolidayRosterSheet(
      '国庆',
      [row(student('s1', '甲', { changduRelativeRelation: '舅舅' }), 'unregistered')],
      NAME_COUNTS,
    )
    expect(column(sheet, '昌都市内亲属')).toEqual([''])
    expect(column(sheet, '亲戚关系')).toEqual([''])
  })
})

/* ==================== 其余各列 ==================== */

describe('其余各列的取值口径', () => {
  it('家庭所在地写**返家范围**，不是地址全文（地址几十字会把别的列挤没）', () => {
    const sheet = buildHolidayRosterSheet(
      '国庆',
      [
        row(
          student('s1', '甲', {
            familyAddress: '西藏自治区昌都市卡若区××乡××村××号',
            familyLocation: { prefecture: '昌都市', county: '卡若区', scope: 'changdu-city' },
          }),
          'home',
        ),
      ],
      NAME_COUNTS,
    )
    expect(column(sheet, '家庭所在地')).toEqual(['昌都市区'])
  })

  it('家庭信息缺失时留空，不写「不详」之类的臆造值', () => {
    const sheet = buildHolidayRosterSheet('国庆', [row(student('s1', '甲'), 'home')], NAME_COUNTS)
    expect(column(sheet, '家庭所在地')).toEqual([''])
  })

  it('性别写中文；备注取档案备注', () => {
    const sheet = buildHolidayRosterSheet(
      '国庆',
      [
        row(student('s1', '甲', { gender: 'male', remark: '对花生过敏' }), 'home'),
        row(student('s2', '乙', { gender: 'female' }), 'stay'),
      ],
      NAME_COUNTS,
    )
    expect(column(sheet, '性别')).toEqual(['男', '女'])
    expect(column(sheet, '备注')).toEqual(['对花生过敏', ''])
  })

  it('重名学生带上身份证尾号——纸质表上的名字与屏幕上必须逐字一致', () => {
    const sheet = buildHolidayRosterSheet(
      '国庆',
      [
        row(student('s1', '旦增卓玛', { idCardSuffix: '3287' }), 'home'),
        row(student('s2', '旦增卓玛', { idCardSuffix: '4120' }), 'stay'),
        row(student('s3', '扎西'), 'home'),
      ],
      new Map([
        ['旦增卓玛', 2],
        ['扎西', 1],
      ]),
    )
    expect(column(sheet, '姓名')).toEqual(['旦增卓玛（3287）', '旦增卓玛（4120）', '扎西'])
  })

  it('学号为空写空串（真实班级里学号大面积空缺，别编一个占位值）', () => {
    const sheet = buildHolidayRosterSheet('国庆', [row(student('s1', '甲'), 'home')], NAME_COUNTS)
    expect(column(sheet, '学号')).toEqual([''])
  })
})

/* ==================== 文件名 ==================== */

describe('文件名', () => {
  it('班级_假期假期名单_日期.xlsx', () => {
    expect(holidayExportFilename('高一9班', '国庆', '2026-09-29')).toBe(
      '高一9班_国庆假期名单_2026-09-29.xlsx',
    )
  })

  it('班级名为空时不拼一个假的班级名', () => {
    expect(holidayExportFilename('  ', '国庆', '2026-09-29')).toBe('国庆假期名单_2026-09-29.xlsx')
  })

  it('假期名里的路径字符换成「·」——`/` 在有的系统上会被当成路径分隔符', () => {
    expect(holidayExportFilename('高一9班', '国庆/中秋', '2026-09-29')).toBe(
      '高一9班_国庆·中秋假期名单_2026-09-29.xlsx',
    )
  })

  it('假期名整个为空时用「假期」兜底，不产生一个以日期开头的怪文件名', () => {
    expect(holidayExportFilename('高一9班', '   ', '2026-09-29')).toBe(
      '高一9班_假期假期名单_2026-09-29.xlsx',
    )
  })
})
