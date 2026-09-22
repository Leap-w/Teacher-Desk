/**
 * 导入模板自检（v3.3.1）。
 *
 * 这里守的是一条**只能在数据层验**的性质：**模板文件必须能被自家的导入器读进去**。
 *
 * v3.3.1 之前，课程表 / 工作清单 / 值日三个模块发的是 CSV，而 `readSheetRows()` 是按
 * **文件头**认格式的（只认 ZIP 的 `PK` 与 OLE2 的 `D0 CF 11 E0`），CSV 一律拒收。
 * 于是「下载模板 → 填 → 导入」这条路在第一份文件上就断了，而且**在浏览器里点不出来**：
 * 点一遍只会看到一句「这不是 Excel 文件」，看不出是模板本身发错了格式。
 *
 * 所以这里不测「按钮有没有渲染」，测的是把模板真的生成出来、再喂回导入器：
 *   ① 字节头必须是 `PK`（真 .xlsx，不是 CSV）
 *   ② `readSheetRows()` 必须收下它 —— **修复前 CSV 会挂在这一步**
 *   ③ 解析器必须认出表头，且**示例行一条错误都不能有** —— 表头与校验规则同源，谁改歪都红
 *
 * 顺带钉住迁移的完成度：五个弹窗都得用共用的 `TemplateDownloadLink`，
 * 谁再手拼一份 CSV 就会在这里被点名。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { buildXlsxTemplate, templateFilename } from '@/utils/xlsxTemplate'
import {
  STUDENT_IMPORT_HEADERS,
  STUDENT_IMPORT_OPTIONAL,
  STUDENT_IMPORT_REQUIRED,
  STUDENT_IMPORT_SAMPLE,
  parseStudentRows,
  readSheetRows,
} from '@/services/studentImport'
import { SEAT_IMPORT_HEADERS, SEAT_IMPORT_SAMPLE, parseSeatRows } from '@/services/seatImport'
import {
  COURSE_IMPORT_HEADERS,
  COURSE_IMPORT_SAMPLE,
  parseCourseRows,
} from '@/services/courseImport'
import { WORK_IMPORT_HEADERS, WORK_IMPORT_SAMPLE, parseWorkRows } from '@/services/workImport'
import {
  DUTY_ARRANGE_HEADERS,
  DUTY_ARRANGE_SAMPLE,
  DUTY_GROUP_HEADERS,
  DUTY_GROUP_SAMPLE,
  parseDutyArrangeRows,
  parseDutyGroupRows,
} from '@/services/dutyImport'

/** 五个模板：表头与示例**都从服务层取**，不在测试里另抄一份 */
const TEMPLATES = [
  {
    name: '学生名单',
    headers: STUDENT_IMPORT_HEADERS,
    sample: STUDENT_IMPORT_SAMPLE,
    parse: (rows: unknown[][]) => parseStudentRows(rows),
  },
  {
    name: '座位表',
    headers: SEAT_IMPORT_HEADERS,
    sample: SEAT_IMPORT_SAMPLE,
    parse: (rows: unknown[][]) => parseSeatRows(rows),
  },
  {
    name: '课程表',
    headers: COURSE_IMPORT_HEADERS,
    sample: COURSE_IMPORT_SAMPLE,
    parse: (rows: unknown[][]) => parseCourseRows(rows),
  },
  {
    name: '工作清单',
    headers: WORK_IMPORT_HEADERS,
    sample: WORK_IMPORT_SAMPLE,
    parse: (rows: unknown[][]) => parseWorkRows(rows),
  },
  {
    name: '值日分组',
    headers: DUTY_GROUP_HEADERS,
    sample: DUTY_GROUP_SAMPLE,
    parse: (rows: unknown[][]) => parseDutyGroupRows(rows),
  },
  {
    name: '值日安排',
    headers: DUTY_ARRANGE_HEADERS,
    sample: DUTY_ARRANGE_SAMPLE,
    parse: (rows: unknown[][]) => parseDutyArrangeRows(rows),
  },
] as const

describe('导入模板：下载下来就能填、填完就能导进去', () => {
  for (const template of TEMPLATES) {
    it(`${template.name}模板是真正的 .xlsx，且导入器认得出、示例行零错误`, async () => {
      const data = await buildXlsxTemplate({
        filename: `${template.name}导入模板`,
        headers: template.headers,
        sample: template.sample,
      })
      expect(data).not.toBeNull()

      // ① 字节头是 PK —— 这一步就把「发了个 CSV 出去」挡死
      const head = new Uint8Array(data!, 0, 2)
      expect([head[0], head[1]]).toEqual([0x50, 0x4b])

      // ② 交给导入器自己的那一层（文件头校验 + xlsx 解析），必须收下
      const sheet = await readSheetRows(data!)
      expect(sheet.ok).toBe(true)
      if (!sheet.ok) return

      // ③ 表头与示例必须被解析器认出来，且一条错误都没有
      const parsed = template.parse(sheet.rows)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      const errors = parsed.rows.flatMap((row) => row.errors)
      expect(errors).toEqual([])
      expect(parsed.rows.length).toBe(template.sample.length)
    })
  }
})

describe('反面：CSV 走不通，这正是模板不发 CSV 的原因', () => {
  it('同样表头的 CSV（哪怕带 BOM）会被导入器按文件头拒收', async () => {
    const csv = [
      STUDENT_IMPORT_HEADERS.join(','),
      STUDENT_IMPORT_SAMPLE[0]!.join(','),
      STUDENT_IMPORT_SAMPLE[1]!.join(','),
    ].join('\n')
    // 用 String.fromCharCode 拼 BOM，避免源码里出现看不见的字符
    const bytes = new TextEncoder().encode(String.fromCharCode(0xfeff) + csv)

    const sheet = await readSheetRows(bytes.buffer as ArrayBuffer)
    expect(sheet.ok).toBe(false)
    // 拒收的理由必须是「格式不对」而不是「表头没找到」——后者会把教师引到表头上去改
    if (!sheet.ok) expect(sheet.error).toContain('这不是 Excel 文件')
  })
})

describe('模板迁移的完成度：五个弹窗共用一份实现', () => {
  const MODALS = [
    'views/Students/components/StudentImportModal.vue',
    'views/Seats/components/SeatImportModal.vue',
    'views/Schedule/components/ScheduleImportModal.vue',
    'views/Works/components/WorkImportModal.vue',
    'views/Duty/components/DutyImportModal.vue',
  ]

  for (const modal of MODALS) {
    it(`${modal} 走共享导入 UI，模板入口不再各自手拼`, () => {
      const source = readFileSync(fileURLToPath(new URL(`../${modal}`, import.meta.url)), 'utf8')
      // v3.5.0：五个弹窗的外观（上传卡 / 说明区 / 已选文件行 / 统计卡 / 提示条 / 逐行预览表）
      // 由 components/ui 里的共享组件提供，谁也不许再抄一套 `.stat` / `.preview-table`
      expect(source).toContain('ImportIntro')
      expect(source).toContain('ImportFileCard')
      expect(source).toContain('ImportFileRow')
      expect(source).toContain('ImportPreviewTable')
      // 取文件的管道（input / 体积上限 / 文件名 / 工作表说明 / 两条入口同一路径）
      // 也只有一份实现；自己再写一个 `pickFile` 就是第二套
      expect(source).toContain('useSheetImport')
      expect(source).not.toContain('function pickFile')
      // 下载模板只有一条路：ImportIntro 内部的 TemplateDownloadLink。
      // 弹窗里再直接调 downloadXlsxTemplate，就是「第二套实现」的开端
      expect(source).not.toContain('downloadXlsxTemplate')
      // 手拼 CSV 的三件套：MIME 类型、BOM、`下载模板（CSV）`文案
      expect(source).not.toContain('text/csv')
      expect(source).not.toContain('下载模板（CSV）')
      expect(source).not.toContain('function downloadTemplate')
      // 文件选择器也不该再邀请 CSV —— 选了也读不进来
      expect(source).not.toContain('.csv')
    })
  }

  it('共享实现本身只有一处：写字节的那一半在 xlsxBook，CSV 那套已经没有残留', () => {
    // v3.6.0：写字节的实现从 `xlsxTemplate.ts` 搬到了 `utils/xlsxBook.ts`
    //（班费账本要出两个工作表，单表接口装不下）。钉子跟着实现走，并且**加一条**：
    // 模板这一层只许转发，不许再自己写一遍工作表 / 列宽 / 下载
    const book = readFileSync(
      fileURLToPath(new URL('../utils/xlsxBook.ts', import.meta.url)),
      'utf8',
    )
    expect(book).toContain("bookType: 'xlsx'")
    expect(book).not.toContain('text/csv')

    const template = readFileSync(
      fileURLToPath(new URL('../utils/xlsxTemplate.ts', import.meta.url)),
      'utf8',
    )
    expect(template).not.toContain("bookType: 'xlsx'")
    expect(template).not.toContain('aoa_to_sheet')
    expect(template).not.toContain('createObjectURL')
    expect(template).not.toContain('text/csv')
  })

  it('模板下载按钮只被 ImportIntro 使用（五个弹窗共用同一个入口）', () => {
    const intro = readFileSync(
      fileURLToPath(new URL('../components/ui/ImportIntro.vue', import.meta.url)),
      'utf8',
    )
    expect(intro).toContain('TemplateDownloadLink')
  })
})

/**
 * 示例行的格子数必须与表头一致。
 *
 * 少写一格不会报错：解析器按**表头**取列，缺的格子读成空串——于是模板上明明看着有
 * 「备注」列，示例里却一个字都没有，教师照着填会发现那一列像是没人要。
 * v3.5.0 给学生模板加了 3 列，正是最容易漏改示例的那种改动。
 */
describe('模板示例的宽度必须与表头对齐', () => {
  for (const template of TEMPLATES) {
    it(`${template.name}模板：每一行示例的格子数与表头一致`, () => {
      for (const [index, row] of template.sample.entries()) {
        expect(row.length, `示例第 ${index + 1} 行`).toBe(template.headers.length)
      }
    })
  }
})

/**
 * 学生模板必须覆盖档案页能填的字段。
 *
 * 需求方报的就是这个洞：「学生档案导入模板缺少所属县市、备注等信息」——
 * 导入只带 10 列，而表单能填 13 项，于是「用 Excel 建一批档案」之后
 * 每个人都得再点开补一遍。这里把三个字段钉住，免得下次加字段时又漏。
 */
describe('学生模板覆盖档案页的字段', () => {
  it('模板里有 备注 / 所属地区 / 所属县·区 三列（v3.5.0 补的洞）', () => {
    expect(STUDENT_IMPORT_HEADERS).toContain('备注')
    expect(STUDENT_IMPORT_HEADERS).toContain('所属地区')
    expect(STUDENT_IMPORT_HEADERS).toContain('所属县/区')
  })

  it('必填与选填两份清单合起来正好是整套表头，不重不漏', () => {
    const union = [...STUDENT_IMPORT_REQUIRED, ...STUDENT_IMPORT_OPTIONAL]
    expect([...union].sort()).toEqual([...STUDENT_IMPORT_HEADERS].sort())
    expect(STUDENT_IMPORT_REQUIRED).toEqual(['姓名', '性别'])
  })

  it('示例行里就带着这三个新字段的值（教师照着抄得出来）', () => {
    const remarkIndex = STUDENT_IMPORT_HEADERS.indexOf('备注')
    const prefectureIndex = STUDENT_IMPORT_HEADERS.indexOf('所属地区')
    const countyIndex = STUDENT_IMPORT_HEADERS.indexOf('所属县/区')

    const filled = STUDENT_IMPORT_SAMPLE.filter((row) => String(row[remarkIndex] ?? '').trim())
    expect(filled.length).toBeGreaterThan(0)
    // 所属地区 / 县区每一行都给出值：这两列是「照着填」最需要示范的
    for (const row of STUDENT_IMPORT_SAMPLE) {
      expect(String(row[prefectureIndex] ?? '').trim()).not.toBe('')
      expect(String(row[countyIndex] ?? '').trim()).not.toBe('')
    }
  })
})

describe('下载文件名', () => {
  it('不带扩展名时补 .xlsx；已经带了就不重复补', () => {
    expect(templateFilename('学生名单导入模板')).toBe('学生名单导入模板.xlsx')
    expect(templateFilename('学生名单导入模板.xlsx')).toBe('学生名单导入模板.xlsx')
  })
})
