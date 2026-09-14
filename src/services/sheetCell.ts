/**
 * 表格类导入的**公共单元格规则**（V3.0 起唯一实现）。
 *
 * 学生 / 座位 / 课表 / 值日 / 工作清单五个 Excel 导入服务此前各自抄了一份
 * `cellText` / `normalizeHeader` / `isBlankRow`——五份实现意味着修一次 bug 要改五处
 * （事实上就分叉过一次：四份用 `toISOString()` 取日期，只有工作清单那份用了本地日历日）。
 * 现在只留这一份，五个导入服务统一从 `services/studentImport.ts` 的读表出口往这边取。
 *
 * 本文件**只碰单元格值**，不碰 xlsx、不碰 DOM、不碰 store——所以能在 node 常驻自检里
 * 直接喂二维数组跑。
 */
import { formatDateKey } from '@/utils/date'

/**
 * 单元格 → 文本。数字、布尔、日期都可能来自 xlsx，统一收成字符串。
 *
 * 日期一律取**本地日历日**：`toISOString()` 是 UTC，东八区本地零点会被算成前一天——
 * 教师填的「9 月 14 日」变成「9 月 13 日」，正是那种不会报错、只在某一天悄悄错开一格的 bug。
 */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (value instanceof Date) return formatDateKey(value)
  return ''
}

/**
 * 表头归一：去掉「（必填）」这类后缀说明与全部空白，再做精确比对。
 *
 * 边界：整格就是一个括号说明（如「【行】」）时，上面的正则会把内容一起去掉——那样这一列
 * 会被当成「没有表头」而整列失效。所以结果为空时退回「只去括号、留内容」的写法。
 */
export function normalizeHeader(value: unknown): string {
  const text = cellText(value)
  const stripped = text.replace(/[（(【[].*?[）)】\]]/g, '').replace(/\s+/g, '')
  if (stripped !== '') return stripped
  return text.replace(/[（(【[）)】\]]/g, '').replace(/\s+/g, '')
}

/**
 * 全空行判定：**本模块关心的那几列都没内容**才算空行，其余列有值不影响。
 * Excel 处处都留全空的尾行，直接跳过（`exceljs` 也会补空单元格，所以只看自己那几列）。
 *
 * `map` 只按「值」用（列名 → 列下标），所以参数类型写成 `object`：各导入服务的
 * `ColumnMap` 是具名接口，而具名接口没有隐式索引签名——写成 `Record<string, number>`
 * 会逼着每个调用方给自己的接口补一个纯粹为迁就参数类型的索引签名。
 */
export function isBlankRow(row: unknown[], map: object): boolean {
  const indexes = Object.values(map).filter(
    (index) => typeof index === 'number' && index >= 0,
  ) as number[]
  return indexes.every((index) => cellText(row[index]) === '')
}
