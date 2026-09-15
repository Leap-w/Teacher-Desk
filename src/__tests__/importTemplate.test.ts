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
    it(`${modal} 走 TemplateDownloadLink，不再自己拼 CSV`, () => {
      const source = readFileSync(fileURLToPath(new URL(`../${modal}`, import.meta.url)), 'utf8')
      expect(source).toContain('TemplateDownloadLink')
      // 手拼 CSV 的三件套：MIME 类型、BOM、`下载模板（CSV）`文案
      expect(source).not.toContain('text/csv')
      expect(source).not.toContain('下载模板（CSV）')
      expect(source).not.toContain('function downloadTemplate')
      // 文件选择器也不该再邀请 CSV —— 选了也读不进来
      expect(source).not.toContain('.csv')
    })
  }

  it('共享实现本身只有一处：CSV 那套已经没有残留', () => {
    const util = readFileSync(
      fileURLToPath(new URL('../utils/xlsxTemplate.ts', import.meta.url)),
      'utf8',
    )
    expect(util).toContain("bookType: 'xlsx'")
    expect(util).not.toContain('text/csv')
  })
})

describe('下载文件名', () => {
  it('不带扩展名时补 .xlsx；已经带了就不重复补', () => {
    expect(templateFilename('学生名单导入模板')).toBe('学生名单导入模板.xlsx')
    expect(templateFilename('学生名单导入模板.xlsx')).toBe('学生名单导入模板.xlsx')
  })
})
