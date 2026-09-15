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
 * 导出种类：PNG（单视角）/ PDF（老师单页、双视角两页）/ Excel（两个视角各一个工作表）。
 *
 * v3.4.0：PDF 全部改为**横向 A4**，`pdf-dual` 由「一页装两个视角」改为**一个视角一页**；
 * 新增 `xlsx-dual`（照需求方模板出的 .xlsx，见 `utils/xlsxSheet.ts`）。
 */
export type SeatExportKind =
  'png-teacher' | 'png-student' | 'pdf-teacher' | 'pdf-dual' | 'xlsx-dual'

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

/** 画布 → 浏览器下载 PNG（文件名示例：座位表-开学初-2026-09-10-老师视角.png） */
export function downloadPng(canvas: HTMLCanvasElement, filename: string): void {
  const anchor = document.createElement('a')
  anchor.href = canvas.toDataURL('image/png')
  anchor.download = filename
  anchor.click()
}

/** 新建横向 A4 PDF（unit mm）。所有导出 PDF（单视角 / 双视角 / 方案对比）共用同一个页面口径 */
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
