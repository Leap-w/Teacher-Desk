import { toCanvas } from 'html-to-image'
import { jsPDF } from 'jspdf'

/**
 * 座位图导出工具（Phase 3C）：html-to-image 把静态渲染节点快照为画布，jsPDF 组装 A4 页面。
 * 中文一律经浏览器渲染进画布（jsPDF 内置字体不含 CJK），标题 / 日期等文案由渲染节点自带。
 */

/** px → mm（浏览器 CSS 像素按 96dpi 折算，jsPDF unit: 'mm'） */
const MM_PER_PX = 25.4 / 96
/**
 * A4 **横向**页面尺寸（mm）。
 *
 * v3.4.0：由竖版（210×297）改为横向——需求方给的座位图模板就是横向 A4
 * （`pageSetup paperSize="9" orientation="landscape"`），竖版打出来左右空一大片。
 * 座位图天然是「宽 > 高」的一间教室，横向才是它的正形。
 */
export const A4_WIDTH_MM = 297
export const A4_HEIGHT_MM = 210

/** 中文导出日期文案：2026年9月10日 */
export function exportDateLabel(date = new Date()): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

/**
 * 日期戳（`2026-09-10`）。班费 / 假期导出仍用它拼文件名；
 * **v3.7.7 起座位图导出改用「班级 + 方案名」**，不再带导出日期。
 */
export function exportDateStamp(date = new Date()): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * 表内日期文案：`2026.09.21`。
 *
 * **与 `exportDateStamp` 刻意分开**：日期戳走 `-`、表内走 `.`，
 * 两边都是需求方写死的口径——座位图 .xlsx 的日期格照模板就是点分格式，
 * 换成 `-` 或 `/` 与模板对不上。别为了「统一」把这两个合成一个。
 */
export function exportDateDotted(date = new Date()): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}.${month}.${day}`
}

/* ==================== 导出文件名（v3.7.7） ==================== */

/**
 * 文件名里不能出现的字符：Windows 与 macOS 的并集（含控制字符）。
 * 统一换成 `·`，与 `holidayExportFilename` 的既有口径一致。
 */
const FILENAME_ILLEGAL_CHARS = /[/\\:*?"<>|\p{Cc}]/gu

/**
 * 清洗文件名中的一个片段（班级名 / 方案名）。
 *
 * 座位方案名由教师自由填写，可能带 `/`、`:`、`?` 等字符；Windows 还禁止片段
 * 以点或空格结尾。这里只处理文件名，**不改动方案本身的数据与名称**：
 * 非法字符 → `·`、连续 `·` 合并、多余空白压成一个、去掉首尾空白。
 * 最后统一清掉结尾的 `.`、`·` 和空格——非法字符被替换成 `·` 后，原本以
 * `?` 之类结尾的名字会留下一个悬空的 `·`，同样不能带进文件名。
 * 清洗后可能为空，由调用方决定兜底名。
 */
export function sanitizeFilenamePart(value: string): string {
  return value
    .replace(FILENAME_ILLEGAL_CHARS, '·')
    .replace(/·{2,}/g, '·')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.· ]+$/g, '')
}

/**
 * 座位图导出文件名主干（不含扩展名）：`高一9班座位图_11.7`。
 *
 * 方案名为空 / 清洗后为空 → `未命名方案`；班级名异常为空 → `班级`。
 * 三种导出（双视角 PDF、双视角 Excel、行列列表 Excel）共用这一个主干，
 * 行列列表另加 `-行列列表` 区分，避免与双视角 Excel 同名。
 */
export function seatExportBaseName(className: string, planName: string | undefined): string {
  const klass = sanitizeFilenamePart(className) || '班级'
  const plan = sanitizeFilenamePart(planName ?? '') || '未命名方案'
  return `${klass}座位图_${plan}`
}

/**
 * 方案对比 PDF 文件名：`高一9班座位对比_开学初-第一次月考后.pdf`。
 *
 * 对比天然涉及两份方案，名字里都要写清；v3.7.7 一并去掉导出日期后缀。
 */
export function seatCompareFilename(
  className: string,
  planAName: string,
  planBName: string,
): string {
  const klass = sanitizeFilenamePart(className) || '班级'
  const planA = sanitizeFilenamePart(planAName) || '未命名方案'
  const planB = sanitizeFilenamePart(planBName) || '未命名方案'
  return `${klass}座位对比_${planA}-${planB}.pdf`
}

/**
 * 导出种类。v3.5.1 精简为两项，本次新增第三项：
 *
 * - `pdf-dual`：双视角 PDF（横向 A4、一个视角一整页，共 2 页）；
 * - `xlsx-dual`：两个视角的 .xlsx（模板驱动，见 `utils/seatTemplateXlsx.ts`）；
 * - `xlsx-list`：行列列表 .xlsx（四列纯数据，见 `utils/seatList.ts`）。
 *
 * 砍掉的三项是 `png-teacher` / `png-student` / `pdf-teacher`——PNG 两个入口与
 * PDF 老师视角入口都从菜单里撤了。**截画布的那套（`renderExportNode`）保留**：
 * 双视角 PDF 仍然靠它把两个视角的渲染节点拍成图。
 */
export type SeatExportKind = 'pdf-dual' | 'xlsx-dual' | 'xlsx-list'

/** 把（隐藏的）导出渲染节点快照为画布；等待字体就绪避免中文 / 图标缺失 */
export async function renderExportNode(
  node: HTMLElement,
  pixelRatio = 2,
): Promise<HTMLCanvasElement> {
  await document.fonts.ready
  return toCanvas(node, {
    pixelRatio,
    backgroundColor: '#ffffff',
    cacheBust: false,
  })
}

/**
 * 新建横向 A4 PDF（unit mm）。所有导出 PDF（双视角座位图 / 方案对比）共用同一个页面口径
 */
export function createPdf(): jsPDF {
  return new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
}

export interface PdfImageOptions {
  /** 画布抓取时的 pixelRatio（与 renderExportNode 一致，折算回 CSS 尺寸用） */
  pixelRatio?: number
  /** 可用宽（mm）；缺省 = 页宽 - 20 */
  maxWidth?: number
  /** 可用高（mm）；缺省 = 页高 - 20 */
  maxHeight?: number
  /** 左上角 x（mm）；缺省水平居中 */
  x?: number
  /** 左上角 y（mm），必填（自上而下排布） */
  y: number
}

/**
 * 把一张画布按比例缩放进给定区域（保持宽高比，等比取 min），返回实际绘制高度（mm）。
 * 用于单图整页 / 双视角上下半页 / 对比多页的排版。
 */
export function embedPdfImage(
  doc: jsPDF,
  canvas: HTMLCanvasElement,
  options: PdfImageOptions,
): number {
  const ratio = options.pixelRatio ?? 2
  const naturalW = (canvas.width / ratio) * MM_PER_PX
  const naturalH = (canvas.height / ratio) * MM_PER_PX
  const maxW = options.maxWidth ?? A4_WIDTH_MM - 20
  const maxH = options.maxHeight ?? A4_HEIGHT_MM - 20
  const scale = Math.min(maxW / naturalW, maxH / naturalH)
  const drawW = naturalW * scale
  const drawH = naturalH * scale
  const x = options.x ?? (A4_WIDTH_MM - drawW) / 2
  doc.addImage(canvas.toDataURL('image/png'), 'PNG', x, options.y, drawW, drawH)
  return drawH
}
