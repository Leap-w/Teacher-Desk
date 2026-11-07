/**
 * 座位图导出文件名（v3.7.7）。
 *
 * 需求：不再用导出日期，改用**当前实际选中的座位方案名称**：
 * `高一9班座位图_11.7` / `高一9班座位图_第一次月考后调整`。
 * 方案名由教师自由填写，所以还要守住「Windows / macOS 能正常保存」这条底线：
 * 非法字符、结尾的点 / 空格、空名都必须有确定结果，且**不能因此改坏方案本身**。
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { sanitizeFilenamePart, seatCompareFilename, seatExportBaseName } from '@/utils/seatExport'

/** 文件名里不该出现的字符（含控制字符） */
const ILLEGAL = /[/\\:*?"<>|\p{Cc}]/u

describe('seatExportBaseName：班级 + 当前方案名', () => {
  it.each([
    ['11.7', '高一9班座位图_11.7'],
    ['第一次月考后调整', '高一9班座位图_第一次月考后调整'],
    ['日常座位', '高一9班座位图_日常座位'],
  ])('方案名「%s」→ %s', (plan, expected) => {
    expect(seatExportBaseName('高一9班', plan)).toBe(expected)
  })

  it('方案名为空 / 全空白 / 未定义 → 未命名方案', () => {
    expect(seatExportBaseName('高一9班', '')).toBe('高一9班座位图_未命名方案')
    expect(seatExportBaseName('高一9班', '   ')).toBe('高一9班座位图_未命名方案')
    expect(seatExportBaseName('高一9班', undefined)).toBe('高一9班座位图_未命名方案')
  })

  it('中文 / 空格 / 数字都是合法字符，不因它们导致导出失败', () => {
    const name = seatExportBaseName('高一9班', ' 11.7 第一次月考后调整 ')
    expect(name).toBe('高一9班座位图_11.7 第一次月考后调整')
  })

  it('非法字符清洗后仍保留可读的方案名，且结尾不悬空', () => {
    expect(seatExportBaseName('高一9班', '第一次/月考:调整?')).toBe(
      '高一9班座位图_第一次·月考·调整',
    )
    expect(seatExportBaseName('高一9班', '第一次/月考: 调整?')).toBe(
      '高一9班座位图_第一次·月考· 调整',
    )
  })

  it('方案名以非法字符结尾 → 去掉替换出的结尾 ·，不留悬空分隔符', () => {
    expect(seatExportBaseName('高一9班', '第一次月考后调整?')).toBe(
      '高一9班座位图_第一次月考后调整',
    )
    expect(seatExportBaseName('高一9班', '11.7:')).toBe('高一9班座位图_11.7')
  })

  it('方案名全是空白或非法字符 → 未命名方案', () => {
    expect(seatExportBaseName('高一9班', '///:::???')).toBe('高一9班座位图_未命名方案')
    expect(seatExportBaseName('高一9班', ' ? . ')).toBe('高一9班座位图_未命名方案')
  })
})

describe('sanitizeFilenamePart：文件名片段清洗', () => {
  it('把 Windows / macOS 的非法字符换成 ·，结尾的 · 一并去掉', () => {
    const cleaned = sanitizeFilenamePart('第一次/月考: 调整?*"<>|\\')
    expect(cleaned).not.toMatch(ILLEGAL)
    expect(cleaned).toBe('第一次·月考· 调整')
  })

  it('连续非法字符合并成一个 ·，不出现一串点', () => {
    expect(sanitizeFilenamePart('月考///调整')).toBe('月考·调整')
    expect(sanitizeFilenamePart('月考???调整')).toBe('月考·调整')
  })

  it('名称以非法字符结尾 → 不留下结尾的 ·', () => {
    expect(sanitizeFilenamePart('第一次月考后调整?')).toBe('第一次月考后调整')
    expect(sanitizeFilenamePart('日常座位:')).toBe('日常座位')
    expect(sanitizeFilenamePart('11.7|')).toBe('11.7')
  })

  it('去掉结尾的点和空格（Windows 不允许这样的文件名）', () => {
    expect(sanitizeFilenamePart('11.7...  ')).toBe('11.7')
    expect(sanitizeFilenamePart(' 日常座位 ')).toBe('日常座位')
    expect(sanitizeFilenamePart('日常座位? . ')).toBe('日常座位')
  })

  it('全是非法字符 / 标点或空白 → 返回空串，由调用方兜底', () => {
    expect(sanitizeFilenamePart('///:::???')).toBe('')
    expect(sanitizeFilenamePart('? . ')).toBe('')
    expect(sanitizeFilenamePart('   ')).toBe('')
  })

  it('控制字符（换行 / NUL）不会带进文件名', () => {
    expect(sanitizeFilenamePart('日常\n座位')).toBe('日常·座位')
    expect(sanitizeFilenamePart('日常\u0000座位')).toBe('日常·座位')
  })

  it('清洗后为空是合法结果，兜底由调用方负责', () => {
    expect(sanitizeFilenamePart('   ')).toBe('')
    expect(sanitizeFilenamePart('...')).toBe('')
  })
})

describe('导出入口接线：三种座位导出 + 方案对比', () => {
  const source = readFileSync('src/views/Seats/index.vue', 'utf8')

  it('双视角 PDF / 双视角 Excel / 行列列表共用当前方案名主干', () => {
    expect(source).toContain('seatExportBaseName(config.name, seatStore.currentPlan?.name)')
    expect(source).toContain('pdf.save(`${base}.pdf`)')
    expect(source).toContain('downloadXlsx(buffer, `${base}.xlsx`)')
    expect(source).toContain('`${base}-行列列表.xlsx`')
    // 日期戳彻底退出座位导出文件名（表内日期仍由 exportDateLabel 负责）
    expect(source).not.toContain('exportDateStamp')
  })

  it('方案对比 PDF 走 seatCompareFilename，不再拼导出日期', () => {
    expect(source).toContain('seatCompareFilename(config.name, planA.name, planB.name)')
    expect(source).not.toContain('座位对比-${planA.name}')
  })
})

describe('seatCompareFilename：方案对比 PDF', () => {
  it('两套方案都写进文件名，日期后缀已取消', () => {
    const name = seatCompareFilename('高一9班', '开学初', '第一次月考后')
    expect(name).toBe('高一9班座位对比_开学初-第一次月考后.pdf')
    expect(name).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('方案名为空时兜底，不产生空片段', () => {
    expect(seatCompareFilename('高一9班', '', '  ')).toBe(
      '高一9班座位对比_未命名方案-未命名方案.pdf',
    )
  })

  it('两套方案名都经过清洗', () => {
    const name = seatCompareFilename('高一9班', '开学/初', '月考:后')
    expect(name).toBe('高一9班座位对比_开学·初-月考·后.pdf')
  })
})
