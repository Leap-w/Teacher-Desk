/**
 * 「我的」页版本信息弹窗（v3.7.7）自检。
 *
 * 这不是「真的检查更新」：不调 GitHub API、不请求远程版本、不接 Releases。
 * 测试要钉住三件事：
 *  ① 版本号来自 package.json，弹窗显示当前版本（v3.9.0 为 `V3.9.0`）；
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
  it('当前版本来自 package.json，弹窗显示口径为 V3.9.0', () => {
    expect(appConfig.version).toBe('3.9.0')
    expect(currentVersionLabel).toBe('V3.9.0')
  })

  it('当前版本在更新日志里有记录，且条目数在 2～4 条之间', () => {
    const note = RELEASE_NOTES.find((item) => item.version === appConfig.version)
    expect(note).toBeDefined()
    expect(note!.highlights.length).toBeGreaterThanOrEqual(2)
    expect(note!.highlights.length).toBeLessThanOrEqual(4)
    expect(currentReleaseHighlights()).toEqual(note!.highlights)
  })

  it('v3.9.0 的更新内容与实际交付一致（不夸大能力）', () => {
    expect(currentReleaseDate()).toBe('2026-11-20')
    const highlights = currentReleaseHighlights()
    expect(highlights).toEqual([
      '新增「导出单文件网页」：在「我的 → 数据与同步」一键生成一个 HTML 文件，用手机浏览器直接打开就能看班级展示页——课表、学生、座位和证件照都在里面，无需安装、无需登录、无需联网。',
      '导出的是当前数据的一份静态快照：生成后无论 TeacherDesk 里的数据怎么变、是否在线，这个 HTML 打开始终是导出那一刻的内容；想更新就重新导出一次。',
      'HTML 不依赖任何网络服务，样式、脚本与照片都打包在同一个文件里，可随意复制、发送与保存。',
      '班级门户已并入 TeacherDesk：展示页源码现在随主项目一起维护，导出不再需要另一个项目；页面内容、操作与外观保持不变。',
    ])
    // 更新日志不能把尚未完成的云端真实链路写成已验收
    expect(highlights.every((item) => !item.includes('云端已'))).toBe(true)
    // 不能声称身份证已核验 / 解决了跨设备并发覆盖 / 做了照片去重
    const all = highlights.join('')
    expect(all).not.toContain('已核验')
    expect(all).not.toContain('已解决')
    expect(all).not.toContain('去重')
    // 不能把离线静态快照写成云端同步 / 人脸识别之类的能力
    expect(all).not.toContain('人脸')
    expect(all).not.toContain('自动定位')
    expect(all).not.toContain('自动识别')
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
