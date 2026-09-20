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

/** 文件名日期段：2026-09-10 */
export function exportDateStamp(date = new Date()): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * 表内日期文案：`2026.09.21`。
 *
 * **与 `exportDateStamp`（文件名用）刻意分开**：文件名走 `-`、表内走 `.`，
 * 两边都是需求方写死的口径——座位图 .xlsx 的日期格照模板就是点分格式，
 * 换成 `-` 或 `/` 与模板对不上。别为了「统一」把这两个合成一个。
 */
export function exportDateDotted(date = new Date()): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}.${month}.${day}`
}

/**
 * 导出种类。**v3.5.1 起只剩两项**：
 *
 * - `pdf-dual`：双视角 PDF（横向 A4、一个视角一整页，共 2 页）；
 * - `xlsx-dual`：两个视角的 .xlsx（模板驱动，见 `utils/seatTemplateXlsx.ts`）。
 *
 * 砍掉的三项是 `png-teacher` / `png-student` / `pdf-teacher`——PNG 两个入口与
 * PDF 老师视角入口都从菜单里撤了。**截画布的那套（`renderExportNode`）保留**：
 * 双视角 PDF 仍然靠它把两个视角的渲染节点拍成图。
 */
export type SeatExportKind = 'pdf-dual' | 'xlsx-dual'

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
