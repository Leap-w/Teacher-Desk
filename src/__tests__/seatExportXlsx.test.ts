/**
 * 座位图导出改版自检（v3.4.0）：横向 A4 · 素格导出图 · 手写 OOXML 的 .xlsx。
 *
 * 需求方原话：「座位图导出时就按照这个模板（两个视角都有）导出即可，把具体的名字换一下；
 * 总之要求就是横向 A4 大小，直接可以打印的那种，目前是竖版的，**有的学生卡片形状和其他
 * 学生不一样**」。于是本文件守三件事：
 *
 *  ① **导出的 .xlsx 必须真能被打开**。这次不能用仓库现成的 `xlsx`（SheetJS 社区版写不出
 *     单元格边框，也写不出 `!pageSetup`，见 `utils/xlsxSheet.ts` 顶部），所以 ZIP 与 OOXML
 *     都是手写的。手写格式的风险恰恰在于「自己觉得对」——少一个 CRC、中央目录偏移差一格、
 *     `<worksheet>` 的子元素顺序不合 schema，在编辑器里一个都看不出来，**只有读回来才知道**。
 *     所以这里让与写侧完全独立的 `XLSX.read()` 当主角：字节头、工作表名、真名、
 *     **座位格带着边框**（社区版做不到的那件事）、合并的讲台、横向 A4 的打印设置，逐条读回。
 *  ② **PDF 一律横向 A4**，双视角是「一个视角一整页」而不是一页对半分。
 *  ③ **导出图上不再有长得不一样的格子**：彩条（班委 / 高个）、头像圈、空座位的虚线＋号与图例
 *     全部撤掉，空座位与有人的座位走同一个 `.ex-seat`——需求方指的就是这个。
 *     同一条纪律也管**性别标记**：屏幕上的座位图 v3.3.2 起给女生卡片加了底条
 *     （「做一下区分」），而需求方明确「**导出的不要这个彩条**」——所以导出图里
 *     连 `gender` 这个词都不该出现（这条由本文件最后一组源码级钉子盯着）。
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import { DEFAULT_CLASSROOM_CONFIG as CFG } from '@/types/classroom'
import { buildSeatGrid } from '@/utils/seat'
import { buildSeatWorkbook } from '@/utils/xlsxSheet'
import type { Student } from '@/types'

function makeStudent(id: string, name: string, idCardSuffix = ''): Student {
  return { id, name, studentNo: '', gender: 'female', idCardSuffix }
}

/**
 * 名册刻意用**与模板样例不同的名字**：模板 `docs/座位图-9.3.xlsx` 里是真实班级的
 * 「旦增卓玛（0063）」等等。生成器若把模板的单元格抄进来（而不是从名册取名），
 * 下面「模板样例名一个都不许出现」那条就会红。
 *
 * 两个「张伟」用来验重名消歧——导出图上必须和屏幕上一样带上身份证尾号。
 */
const ROSTER: Student[] = [
  makeStudent('s1', '王小明'),
  makeStudent('s2', '张伟', '3287'),
  makeStudent('s3', '张伟', '3288'),
  makeStudent('s4', '李思远'),
]
const STUDENTS = new Map(ROSTER.map((student) => [student.id, student]))

/** 座位占用：键是座位号（1 = 第 1 排第 1 列，63 = 末排末尾） */
const OCCUPANTS = new Map<number, string>([
  [1, 's1'], // 第 1 排第 1 列
  [9, 's2'], // 第 1 排第 9 列
  [10, 's3'], // 第 2 排第 1 列
  [62, 's4'], // 第 7 排第 8 列
])

function buildWorkbookBuffer(): ArrayBuffer {
  const seats = buildSeatGrid(OCCUPANTS, CFG)
  return buildSeatWorkbook([
    {
      sheetName: '学生视角',
      config: CFG,
      seats,
      students: STUDENTS,
      view: 'student',
      title: '高一9班 座位表',
      subtitle: '方案：开学初 · 2026年9月16日 · 学生视角',
    },
    {
      sheetName: '老师视角',
      config: CFG,
      seats,
      students: STUDENTS,
      view: 'teacher',
      title: '高一9班 座位表',
      subtitle: '方案：开学初 · 2026年9月16日 · 老师视角',
    },
  ])
}

/** 解包后的整包文本。**ZIP 是 stored（不压缩）**，所以 XML 原样躺在字节里，直接解码就能搜 */
function rawXml(buffer: ArrayBuffer): string {
  return new TextDecoder().decode(new Uint8Array(buffer))
}

function sheetValues(sheet: XLSX.WorkSheet): string[] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '' })
  return rows.flat().map((value) => String(value ?? ''))
}

/* ==================== ① 手写的字节必须真能被读回来 ==================== */

describe('导出 .xlsx：拿独立的解析器读回来验', () => {
  const buffer = buildWorkbookBuffer()
  const bytes = new Uint8Array(buffer)

  it('是真 ZIP（PK 头），不是 CSV 也不是别的什么', () => {
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
  })

  it('工作表名与顺序照需求方模板：学生视角在前、老师视角在后', () => {
    const workbook = XLSX.read(buffer, { type: 'array', cellStyles: true })
    expect(workbook.SheetNames).toEqual(['学生视角', '老师视角'])
  })

  it('名字取自名册（重名带身份证尾号），模板里的样例名一个都不许出现', () => {
    const workbook = XLSX.read(buffer, { type: 'array' })
    const studentView = sheetValues(workbook.Sheets['学生视角']!)
    expect(studentView).toContain('王小明')
    // 重名消歧：与屏幕、与 PNG / PDF 导出图同一个口径（formatStudentShortName）
    expect(studentView).toContain('张伟（3287）')
    expect(studentView).toContain('张伟（3288）')
    // 模板样例名：生成器是从名册取名的，不是把模板的格子抄下来
    for (const sampleName of ['旦增卓玛', '尼玛拉姆', '洛桑益西']) {
      expect(studentView.join('|')).not.toContain(sampleName)
    }
  })

  it('空座位与有人的座位**样式完全相同**，只是里面没字', () => {
    const workbook = XLSX.read(buffer, { type: 'array', cellStyles: true })
    const sheet = workbook.Sheets['学生视角']!
    // 学生视角网格：第 1 行标题、第 2 行副标题，之后每个房间单元占一行——
    // 3 = 讲台 + 前门、4 = 列号 + 窗、5~11 = 第 1 排…第 7 排、12 = 后门。
    // 第 1 列 = 排号、第 2 列 = 左墙、C~M = 座位与过道区、第 14 列 = 右墙。
    // 学生视角列号 9→1，所以第 1 排第 9 列（s2 张伟）落在 C5。
    const occupied = sheet['C5'] as XLSX.CellObject
    expect(occupied.v).toBe('张伟（3287）')

    // 空座位（第 7 排第 9 列 = 恒空的 63 号）**同一个样式**，只是没字——
    // 「有的卡片形状和其他学生不一样」正是从空座位那张虚线＋号卡开始的
    const empty = sheet['C11'] as XLSX.CellObject
    expect(empty).toBeTruthy()
    expect(empty.v).toBeUndefined()
    expect(empty.s).toEqual(occupied.s)
  })

  describe('导出 .xlsx：座位格的边框（只能查字节本身的那一条）', () => {
    const xml = rawXml(buildWorkbookBuffer())

    /**
     * SheetJS 社区版的**读**侧只把填充塞进 `cell.s`——`safe_format()` 里就一句
     * `p.s = styles.Fills[fillid]`，边框 / 字体 / 对齐它根本不读（写侧更是整段忽略）。
     * 所以「座位格有边框」这条没法借它当独立证人，只能查我们写出去的字节本身，
     * 把「单元格引用的样式号」与「样式表里那个样式」对起来。
     * 真机证据留给最后一步：用 Excel / WPS 打开一次（见交付说明）。
     */
    it('座位格引用的是样式表里那条细边框样式', () => {
      const seatStyle = '3' // utils/xlsxSheet.ts 的 STYLE.seat
      // 有人的格子与空着的格子引用**同一个样式号**——这就是「卡片形状都一样」的字节级证据
      expect(xml).toContain(`<c r="C5" s="${seatStyle}" t="inlineStr">`)
      expect(xml).toContain(`<c r="C11" s="${seatStyle}"/>`)

      // cellXfs 的第 3 条（0 起算）必须指向第 1 号边框，并声明 applyBorder。
      // 拆法要认两种写法：自闭合的 `<xf .../>` 与带 `<alignment>` 的 `<xf ...>…</xf>`
      const cellXfs = xml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? ''
      const xfs = cellXfs.match(/<xf\b(?:[^>]*\/>|[^>]*>[\s\S]*?<\/xf>)/g) ?? []
      expect(xfs).toHaveLength(8)
      expect(xfs[3]).toContain('borderId="1"')
      expect(xfs[3]).toContain('applyBorder="1"')
    })

    it('第 1 号边框是四边细线（四边缺一条，打印出来就是断的）', () => {
      const borders = xml.match(/<borders[^>]*>([\s\S]*?)<\/borders>/)?.[1] ?? ''
      const thin = borders.split('</border>')[1] ?? ''
      for (const side of ['left', 'right', 'top', 'bottom']) {
        expect(thin).toContain(`<${side} style="thin">`)
      }
    })
  })

  it('两个视角各按自己的排布出格：列号方向相反、讲台换到另一头', () => {
    const workbook = XLSX.read(buffer, { type: 'array' })
    const studentView = workbook.Sheets['学生视角']!
    const teacherView = workbook.Sheets['老师视角']!

    // 列号行：学生 9→1、老师 1→9（同一份 viewColUnits）
    expect((studentView['C4'] as XLSX.CellObject).v).toBe('9')
    expect((studentView['M4'] as XLSX.CellObject).v).toBe('1')
    expect((teacherView['C4'] as XLSX.CellObject).v).toBe('1')
    expect((teacherView['M4'] as XLSX.CellObject).v).toBe('9')

    // 讲台：学生视角在最上（第 3 行）、老师视角在最下（第 12 行）
    expect((studentView['C3'] as XLSX.CellObject).v).toBe('讲台')
    expect((teacherView['C12'] as XLSX.CellObject).v).toBe('讲台')

    // 同一个学生（第 1 排第 9 列）：学生视角在第 5 行 C 列，老师视角在第 11 行 M 列——
    // 列号翻了个方向，行也跟着讲台换了头（老师视角第 1 排在最下）
    expect((studentView['C5'] as XLSX.CellObject).v).toBe('张伟（3287）')
    expect((teacherView['M11'] as XLSX.CellObject).v).toBe('张伟（3287）')
  })

  it('讲台是合并格：与模板一样横跨整个座位区', () => {
    const workbook = XLSX.read(buffer, { type: 'array' })
    const merges = workbook.Sheets['学生视角']!['!merges'] ?? []
    const refs = merges.map((merge) => XLSX.utils.encode_range(merge))
    expect(refs).toContain('A1:N1') // 标题跨满整张表
    expect(refs).toContain('C3:M3') // 讲台横跨座位区
  })
})

/* ==================== ② 打印设置：横向 A4、缩到一页 ==================== */

describe('导出 .xlsx：打出来就是横向 A4 一整页', () => {
  const xml = rawXml(buildWorkbookBuffer())

  it('纸张 A4 + 横向 + 缩到一页宽一页高', () => {
    expect(xml).toContain(
      '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="1"/>',
    )
    expect(xml).toContain('<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>')
  })

  it('纸上只留我们画的框线：Excel 自己的网格线关掉，改成水平居中', () => {
    expect(xml).toContain('showGridLines="0"')
    expect(xml).toContain('<printOptions horizontalCentered="1"/>')
    expect(xml).toContain('<pageMargins ')
  })

  it('两个工作表都带上了打印设置（漏一个 = 有一个视角打出来是竖的）', () => {
    expect(xml.match(/orientation="landscape"/g)).toHaveLength(2)
  })

  it('<worksheet> 的子元素顺序合 schema —— 顺序错了 Excel 会判文件损坏', () => {
    const order = ['</sheetData>', '<mergeCells', '<printOptions', '<pageMargins', '<pageSetup']
    const positions = order.map((tag) => xml.indexOf(tag))
    for (const position of positions) expect(position).toBeGreaterThan(-1)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })
})

/* ==================== ③ 源码级钉子：PDF 横向 / 导出图素格 ==================== */

describe('导出改版：PDF 横向 A4，导出图不再有长得不一样的格子', () => {
  const read = (path: string) => readFileSync(path, 'utf8')

  it('PDF 一律横向 A4（页面尺寸常量与 jsPDF 的方向都得是横向）', () => {
    const source = read('src/utils/seatExport.ts')
    expect(source).toContain('export const A4_WIDTH_MM = 297')
    expect(source).toContain('export const A4_HEIGHT_MM = 210')
    expect(source).toContain("orientation: 'landscape'")
    // 竖版口径必须彻底清干净：留着任何一处，将来谁照着抄就又竖回去了
    expect(source).not.toContain("orientation: 'portrait'")
  })

  it('双视角 PDF 是「一个视角一整页」，不是一页对半分', () => {
    const source = read('src/views/Seats/index.vue')
    expect(source).toContain('pdf.addPage()')
    // 上下半页那套算法（把两张图压到同一页）必须消失
    expect(source).not.toContain('budget')
    expect(source).not.toContain('A4_HEIGHT_MM')
  })

  it('导出图撤掉彩条 / 头像 / 图例 / 空位虚线＋号，格子只剩边框与姓名', () => {
    const source = read('src/views/Seats/components/SeatExportGraphic.vue')
    // 班委 / 高个的顶条正是需求方说的「卡片形状和其他学生不一样」
    for (const gone of [
      'is-cadre',
      'is-tall',
      'is-tag',
      'seatAccentOf',
      'ex-avatar',
      'ex-legend',
      'ex-swatch',
      'ex-plus',
      'ex-ordinal',
      'seatOrdinal',
      'is-empty',
    ]) {
      expect(source, `${gone} 不该再出现在导出图里`).not.toContain(gone)
    }
    // 空座位与有人的座位走**同一个类**，样式上不可能再分出两种长相
    expect(source).toContain('class="ex-seat"')
  })

  it('导出图仍然与页面共用同一份视角真源（改样式不许把同源改掉）', () => {
    const source = read('src/views/Seats/components/SeatExportGraphic.vue')
    for (const shared of ['viewRoomItems', 'viewRowUnits', 'viewColUnits', 'doorSidesOf']) {
      expect(source).toContain(shared)
    }
  })

  /**
   * 性别标记的两侧约定（v3.3.2）：**屏幕上有、导出图没有**。
   * 这是需求方同一次交付里的两句话——「网站上显示时给女生的卡片加一个彩条做区分」
   * 与「导出的不要这个彩条」。两条都要有钉子，否则将来谁把 SeatCard 复用到导出图
   * （或反过来给导出图补上标记）都发现不了。
   */
  it('女生彩条只在屏幕上，导出图里连 gender 这个词都不该有', () => {
    // 屏幕一侧：座位卡上确实画了底条，且类是父级 seatClass 算出来的
    expect(read('src/views/Seats/components/SeatCard.vue')).toContain('seat-gender-bar')
    expect(read('src/views/Seats/components/SeatClassroom.vue')).toContain("'is-girl'")
    // 令牌必须真的存在——删掉它底条会变成透明，而「没有彩条」与「彩条没颜色」肉眼一样
    expect(read('src/styles/theme.css')).toContain('--color-gender-female')

    // 导出一侧：一个性别标记都不许有
    const graphic = read('src/views/Seats/components/SeatExportGraphic.vue')
    for (const gone of ['is-girl', 'seat-gender-bar', 'gender']) {
      expect(graphic, `导出图不该出现 ${gone}`).not.toContain(gone)
    }
  })
})
