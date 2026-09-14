/**
 * 表格单元格公共规则的常驻自检（V3.0 起）。
 *
 * 这三条规则此前在五个导入服务里各抄一份，其中**日期那一档分了叉**：
 * 四份用 `toISOString()`（UTC），只有工作清单那份用本地日历日。东八区本地零点会被
 * UTC 算成前一天，教师的「9 月 14 日」于是变成「9 月 13 日」——不报错、只在某些时刻错一格。
 * 这里把口径钉死，五个导入服务共用同一份实现（`services/sheetCell.ts`）。
 */
import { describe, expect, it } from 'vitest'

import { cellText, isBlankRow, normalizeHeader } from '@/services/sheetCell'

describe('cellText：单元格 → 文本', () => {
  it('1. 字符串去首尾空白，数字转字符串', () => {
    expect(cellText('  旦增卓玛 ')).toBe('旦增卓玛')
    expect(cellText(63)).toBe('63')
    expect(cellText(0)).toBe('0')
  })

  it('2. null / undefined / 布尔 / 对象一律给空串（不猜内容）', () => {
    expect(cellText(null)).toBe('')
    expect(cellText(undefined)).toBe('')
    expect(cellText(true)).toBe('')
    expect(cellText({ a: 1 })).toBe('')
  })

  it('3. 非有限数字给空串（NaN / Infinity 来自损坏的表）', () => {
    expect(cellText(Number.NaN)).toBe('')
    expect(cellText(Number.POSITIVE_INFINITY)).toBe('')
  })

  it('4. 日期取**本地日历日**，不是 UTC 那一天（东八区本地零点不许退回前一天）', () => {
    // 本地零点（东八区 = UTC 前一天 16:00）：若用 toISOString().slice(0,10) 会得到 09-13
    const localMidnight = new Date(2026, 8, 14, 0, 0, 0)
    expect(cellText(localMidnight)).toBe('2026-09-14')
    expect(cellText(localMidnight)).not.toBe(localMidnight.toISOString().slice(0, 10))

    // 本地 23:59 同理不能变成第二天
    expect(cellText(new Date(2026, 8, 14, 23, 59, 59))).toBe('2026-09-14')
    // 跨月 / 补零
    expect(cellText(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('normalizeHeader：表头归一', () => {
  it('5. 去掉「（必填）」这类后缀说明与全部空白（含全角括号、方括号）', () => {
    expect(normalizeHeader('学号（必填）')).toBe('学号')
    expect(normalizeHeader('姓名 (选填)')).toBe('姓名')
    expect(normalizeHeader('【行】')).toBe('行')
    expect(normalizeHeader(' 姓 名 ')).toBe('姓名')
  })

  it('6. 没有后缀时保持原样（归一不该改变普通表头）', () => {
    expect(normalizeHeader('座位行')).toBe('座位行')
    expect(normalizeHeader('')).toBe('')
  })
})

describe('isBlankRow：全空行判定', () => {
  const map = { name: 0, gender: 1, note: -1 }

  it('7. 本模块关心的列全空 → 空行（Excel 到处都留这种尾行）', () => {
    expect(isBlankRow([], map)).toBe(true)
    expect(isBlankRow(['', '   '], map)).toBe(true)
    expect(isBlankRow([null, undefined], map)).toBe(true)
  })

  it('8. 关心的列里有内容 → 不是空行', () => {
    expect(isBlankRow(['李明', ''], map)).toBe(false)
    expect(isBlankRow(['', '男'], map)).toBe(false)
  })

  it('9. 下标为 -1 的列（表里没有这一列）不参与判定', () => {
    // note 那列不存在；只有第 3 列有内容 → 关心的两列都空 → 仍算空行
    expect(isBlankRow(['', '', '随便写的备注'], map)).toBe(true)
  })
})
