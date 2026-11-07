/**
 * 「我的」页版本信息弹窗（v3.7.7）自检。
 *
 * 这不是「真的检查更新」：不调 GitHub API、不请求远程版本、不接 Releases。
 * 测试要钉住三件事：
 *  ① 版本号来自 package.json，弹窗显示 `V3.7.7`；
 *  ② 更新日志集中在 `config/releaseNotes.ts`，当前版本有 2～4 条、与版本号对齐；
 *  ③ 品牌卡片用「检查更新」替换了 GitHub 链接，弹窗复用 AppModal 且没有网络请求。
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { appConfig } from '@/config'
import { RELEASE_NOTES, currentReleaseHighlights, currentVersionLabel } from '@/config/releaseNotes'

const read = (path: string) => readFileSync(path, 'utf8')

describe('版本信息：当前版本与本地更新日志', () => {
  it('当前版本来自 package.json，弹窗显示口径为 V3.7.7', () => {
    expect(appConfig.version).toBe('3.7.7')
    expect(currentVersionLabel).toBe('V3.7.7')
  })

  it('当前版本在更新日志里有记录，且条目数在 2～4 条之间', () => {
    const note = RELEASE_NOTES.find((item) => item.version === appConfig.version)
    expect(note).toBeDefined()
    expect(note!.highlights.length).toBeGreaterThanOrEqual(2)
    expect(note!.highlights.length).toBeLessThanOrEqual(4)
    expect(currentReleaseHighlights()).toEqual(note!.highlights)
  })

  it('v3.7.7 的三条更新内容与需求方给定的文案一致', () => {
    expect(currentReleaseHighlights()).toEqual([
      '新增版本信息展示功能，可在「我的」页面查看当前版本及本次更新内容。',
      '优化座位图导出文件命名，支持使用座位方案名称作为文件名。',
      '优化部分界面交互及细节体验。',
    ])
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
    expect(source).toContain('好的')
  })

  it('弹窗不发起任何网络请求，也不引用 GitHub / Releases', () => {
    const source = read('src/views/My/components/VersionModal.vue')
    for (const forbidden of ['fetch(', 'XMLHttpRequest', 'axios', 'https://', 'github.com']) {
      expect(source, `版本弹窗不该出现 ${forbidden}`).not.toContain(forbidden)
    }
  })
})
