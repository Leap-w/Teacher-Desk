/**
 * 「我的」页版本信息弹窗（v3.7.7）自检。
 *
 * 这不是「真的检查更新」：不调 GitHub API、不请求远程版本、不接 Releases。
 * 测试要钉住三件事：
 *  ① 版本号来自 package.json，弹窗显示当前版本（v3.8.2 为 `V3.8.2`）；
 *  ② 更新日志集中在 `config/releaseNotes.ts`，当前版本有 2～4 条、与版本号对齐；
 *  ③ 品牌卡片用「检查更新」替换了 GitHub 链接，弹窗复用 AppModal 且没有网络请求。
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { appConfig } from '@/config'
import {
  RELEASE_NOTES,
  currentReleaseDate,
  currentReleaseHighlights,
  currentVersionLabel,
} from '@/config/releaseNotes'

const read = (path: string) => readFileSync(path, 'utf8')

describe('版本信息：当前版本与本地更新日志', () => {
  it('当前版本来自 package.json，弹窗显示口径为 V3.8.2', () => {
    expect(appConfig.version).toBe('3.8.2')
    expect(currentVersionLabel).toBe('V3.8.2')
  })

  it('当前版本在更新日志里有记录，且条目数在 2～4 条之间', () => {
    const note = RELEASE_NOTES.find((item) => item.version === appConfig.version)
    expect(note).toBeDefined()
    expect(note!.highlights.length).toBeGreaterThanOrEqual(2)
    expect(note!.highlights.length).toBeLessThanOrEqual(4)
    expect(currentReleaseHighlights()).toEqual(note!.highlights)
  })

  it('v3.8.2 的三条更新内容与实际交付一致（不夸大能力）', () => {
    expect(currentReleaseDate()).toBe('2026-11-16')
    const highlights = currentReleaseHighlights()
    expect(highlights).toEqual([
      '学生照片上传更省心：一名学生第一次上传的照片会自动作为证件照，之后再上传会自动归为生活照；证件照仍可手动改为生活照、生活照也可改回证件照，当前证件照可随时手动更换。',
      '照片墙新增「批量导入」：按「班级-姓名-身份证号-证件照/生活照」命名照片后，可一次选中多张自动识别并预览。重名或查不到学生会请你人工确认归属，班级不符的文件会被拦下；身份证号只用于解析命名、不会保存，也不会自动替你核验身份。',
      '修复从「班级管理」进入照片墙、请假、班费等页面时，顶部「班级管理」不再持续高亮的问题；二级页面自己的选中状态不受影响。',
    ])
    // 更新日志不能把尚未完成的云端真实链路写成已验收
    expect(highlights.every((item) => !item.includes('云端已'))).toBe(true)
    // 不能声称身份证已核验 / 解决了跨设备并发覆盖 / 做了照片去重
    const all = highlights.join('')
    expect(all).not.toContain('已核验')
    expect(all).not.toContain('已解决')
    expect(all).not.toContain('去重')
  })

  it('每条更新日志都有版本号和非空内容', () => {
    // 数据质量底线；查找逻辑本身允许当前版本暂无记录（此时返回空数组，不编造内容）。
    expect(RELEASE_NOTES.every((note) => note.version && note.highlights.length > 0)).toBe(true)
  })
})

describe('品牌卡片与弹窗的实现约束', () => {
  it('品牌卡片右下角是「检查更新」，GitHub 仓库链接已撤下', () => {
    const source = read('src/views/My/components/AboutCard.vue')
    expect(source).toContain('检查更新')
    expect(source).toContain('aria-haspopup="dialog"')
    expect(source).toContain('VersionModal')
    expect(source).not.toContain('https://github.com')
    expect(source).not.toContain('Github')
  })

  it('弹窗复用 AppModal（ESC / 遮罩 / 滚动锁 / 焦点还原）', () => {
    const source = read('src/views/My/components/VersionModal.vue')
    expect(source).toContain('<AppModal')
    expect(source).toContain('aria-label="版本信息"')
    expect(source).toContain('已经是最新版本')
    expect(source).toContain('本次更新内容')
    expect(source).toContain('currentReleaseDate')
    expect(source).toContain('更新于')
    expect(source).toContain('好的')
  })

  it('弹窗不发起任何网络请求，也不引用 GitHub / Releases', () => {
    const source = read('src/views/My/components/VersionModal.vue')
    for (const forbidden of ['fetch(', 'XMLHttpRequest', 'axios', 'https://', 'github.com']) {
      expect(source, `版本弹窗不该出现 ${forbidden}`).not.toContain(forbidden)
    }
  })
})
