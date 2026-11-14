/**
 * 「我的」页版本信息弹窗（v3.7.7）自检。
 *
 * 这不是「真的检查更新」：不调 GitHub API、不请求远程版本、不接 Releases。
 * 测试要钉住三件事：
 *  ① 版本号来自 package.json，弹窗显示当前版本（v3.8.1 为 `V3.8.1`）；
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
  it('当前版本来自 package.json，弹窗显示口径为 V3.8.1', () => {
    expect(appConfig.version).toBe('3.8.1')
    expect(currentVersionLabel).toBe('V3.8.1')
  })

  it('当前版本在更新日志里有记录，且条目数在 2～4 条之间', () => {
    const note = RELEASE_NOTES.find((item) => item.version === appConfig.version)
    expect(note).toBeDefined()
    expect(note!.highlights.length).toBeGreaterThanOrEqual(2)
    expect(note!.highlights.length).toBeLessThanOrEqual(4)
    expect(currentReleaseHighlights()).toEqual(note!.highlights)
  })

  it('v3.8.1 的四条更新内容与实际交付一致（不宣称云端已验收）', () => {
    expect(currentReleaseDate()).toBe('2026-11-14')
    expect(currentReleaseHighlights()).toEqual([
      '「照片墙」改为班级管理中的独立页面，可按学生查看、上传照片、设置当前证件照和查看大图；照片仍默认保存在本机。',
      '新增「导出完整备份（含照片）」ZIP，可把文字数据与照片文件一起备份并在换设备后恢复；原来的 JSON 备份继续保留，但它只包含照片信息、不包含照片文件。',
      '学生档案新增宿舍管理：内置八项常用宿舍，也可输入任意自定义宿舍；支持批量修改和 Excel 导入，历史宿舍值会原样保留，修改性别不会影响宿舍。',
      '违纪管理改为更直接的事件记录：24 项系统预设、支持自定义事件与默认严重程度；取消类型分类，历史违纪记录、家长处理意见和个人违纪档案继续保留。',
    ])
    // 更新日志不能把尚未完成的云端真实链路写成已验收
    expect(currentReleaseHighlights().every((item) => !item.includes('云端已'))).toBe(true)
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
