/**
 * Phase 2 UI 接线自检（v3.8.0）。
 *
 * node 环境没有 DOM，组件渲染不在这里跑；本文件负责两件在 node 里能可靠断言的事：
 * 1. 路由 / 入口真的接上了（违纪管理在班级管理子路由里、且追加在最后）；
 * 2. 新增 UI **只通过 Store / 纯逻辑工具**读写数据：不直接碰 localStorage、IndexedDB、
 *    CloudBase SDK，也不自己再实现一套图片压缩 / 云端上传 / 统计。
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { routes } from '@/router/routes'

function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

const UI_FILES = {
  violationsPage: 'src/views/Violations/index.vue',
  formModal: 'src/views/Violations/components/ViolationFormModal.vue',
  picker: 'src/views/Violations/components/ViolationStudentPicker.vue',
  profileModal: 'src/views/Violations/components/ViolationProfileModal.vue',
  detailModal: 'src/views/Violations/components/ViolationEventDetailModal.vue',
  overviewPanel: 'src/views/Violations/components/ViolationOverviewPanel.vue',
  photoWall: 'src/views/Photos/index.vue',
  photoManager: 'src/views/Students/components/StudentPhotoManager.vue',
  photoViewer: 'src/views/Students/components/StudentPhotoViewer.vue',
  studentDetail: 'src/views/Students/components/StudentDetailModal.vue',
  studentsPage: 'src/views/Students/index.vue',
  toolbox: 'src/views/Toolbox/index.vue',
} as const

const sources = Object.fromEntries(
  Object.entries(UI_FILES).map(([key, path]) => [key, readSource(path)]),
) as Record<keyof typeof UI_FILES, string>

/* ==================== 路由与入口 ==================== */

describe('路由与导航入口', () => {
  const classRoute = routes.find((route) => route.path === '/class')

  it('违纪管理与照片墙依次追加在班级管理最后（不挪动既有二级导航位置）', () => {
    const children = (classRoute?.children ?? []).filter(
      (child) => child.path !== '' && !child.redirect,
    )
    const paths = children.map((child) => child.path)
    // v3.8.0 追加违纪管理、v3.8.1 追加照片墙：前六个位置不动
    expect(paths.slice(0, 6)).toEqual(['seats', 'leave', 'duty', 'holiday', 'fund', 'violations'])
    expect(paths[paths.length - 1]).toBe('photos')
    const photos = children[paths.length - 1]
    expect(photos).toMatchObject({ name: 'photos' })
    expect(photos?.meta?.title).toBe('照片墙')
    const violations = children[paths.length - 2]
    expect(violations).toMatchObject({ name: 'violations' })
    expect(violations?.meta?.title).toBe('违纪管理')
  })

  it('违纪页组件真实存在（懒加载路径不是空指针）', () => {
    expect(existsSync(resolve(process.cwd(), 'src/views/Violations/index.vue'))).toBe(true)
    expect(readFileSync(resolve(process.cwd(), 'src/router/routes.ts'), 'utf8')).toContain(
      '@/views/Violations/index.vue',
    )
  })

  it('违纪页通过 store 读取，不在页面里直接拼数据', () => {
    expect(sources.violationsPage).toContain('useViolationStore()')
    expect(sources.violationsPage).toContain('listEvents(')
    expect(sources.violationsPage).toContain('removeViolation(')
  })

  it('学生管理接入了照片墙 / 学生照片入口（照片墙改为独立页面跳转）', () => {
    // v3.8.1：不再 import 弹窗组件，改为路由跳转；单名学生照片管理仍复用既有弹窗
    expect(sources.studentsPage).toContain("name: 'photos'")
    expect(sources.studentsPage).toContain('openPhotoWall')
    expect(sources.studentsPage).toContain('StudentPhotoManager')
    expect(sources.studentsPage).not.toContain('StudentPhotoWallModal')
    expect(sources.studentDetail).toContain('openViolationProfile')
    expect(sources.studentDetail).toContain('openPhotos')
  })

  it('照片墙是独立页面：不再用 AppModal 承载整个照片墙，且复用既有 Store / 管理器', () => {
    // 页面只承载集体视图；单名学生照片管理用既有 StudentPhotoManager，不重写一套
    expect(sources.photoWall).not.toContain('<AppModal')
    expect(sources.photoWall).toContain('buildClassPhotoWall')
    expect(sources.photoWall).toContain('useStudentPhotoStore()')
    expect(sources.photoWall).toContain('StudentPhotoManager')
    expect(sources.photoWall).toContain('usePhotoThumbUrls')
    // 路由表里真实挂了懒加载页面（不是只写了一个名字）
    expect(readFileSync(resolve(process.cwd(), 'src/router/routes.ts'), 'utf8')).toContain(
      '@/views/Photos/index.vue',
    )
  })

  it('学生详情的「违纪档案」跳转到违纪页并带 student 查询参数（不复制一套编辑弹窗）', () => {
    expect(sources.studentsPage).toContain("name: 'violations'")
    expect(sources.studentsPage).toContain('query: { student: student.id }')
    // 违纪页消费深链，并根据 student 打开个人档案
    expect(sources.violationsPage).toContain('route.query.student')
    expect(sources.violationsPage).toContain('openProfileFromQuery')
  })
})

/* ==================== 数据访问边界 ==================== */

describe('UI 不绕过数据层', () => {
  it('任何新增 UI 文件都不直接 import CloudBase / IndexedDB / 图片处理实现', () => {
    const forbidden = [
      '@/services/cloudbase',
      '@/services/photoCloud',
      '@/services/mediaStore',
      '@/services/imagePipeline',
      '@/services/photoOutbox',
      '@cloudbase',
    ]
    for (const [key, source] of Object.entries(sources)) {
      for (const needle of forbidden) {
        expect(source, `${key} 不应直接引用 ${needle}`).not.toContain(needle)
      }
    }
  })

  it('UI 不直接读写 localStorage / IndexedDB（注释里提及不算，实际调用才算）', () => {
    const forbiddenCalls = [
      'window.localStorage',
      'localStorage.getItem',
      'localStorage.setItem',
      'localStorage.removeItem',
      'indexedDB.open',
      'window.indexedDB',
    ]
    for (const [key, source] of Object.entries(sources)) {
      for (const needle of forbiddenCalls) {
        expect(source, `${key} 不应直接调用 ${needle}`).not.toContain(needle)
      }
    }
  })

  it('违纪 UI 使用数据层预设与统计，不硬编码行为清单（v3.8.1 取消分类）', () => {
    expect(sources.formModal).toContain('buildViolationEventOptions')
    expect(sources.formModal).toContain('resolveForSave')
    expect(sources.formModal).toContain('updateDefaultSeverity')
    expect(sources.formModal).toContain('addViolationsForStudents')
    expect(sources.formModal).toContain('updateViolation')
    expect(sources.formModal).not.toContain('迟到')
    expect(sources.formModal).not.toContain('VIOLATION_CATEGORY')
    // 统计全部来自 Store 的派生值；分类统计已被「按事件统计」替代
    expect(sources.violationsPage).toContain('violationStore.overview')
    expect(sources.violationsPage).toContain('violationStore.ranking')
    expect(sources.violationsPage).toContain('violationStore.frequentStudents')
    expect(sources.violationsPage).toContain('violationStore.severeEvents')
    expect(sources.violationsPage).toContain('behaviorCounts')
  })

  it('违纪界面已移除分类，且自定义事件 / 显式更新入口已接线（v3.8.1 Phase 3）', () => {
    expect(sources.formModal).not.toContain('VIOLATION_CATEGORY')
    expect(sources.formModal).toContain('VIOLATION_CUSTOM_EVENT_SENTINEL')
    expect(sources.formModal).toContain('customBehavior')
    expect(sources.formModal).toContain('updatePresetDefault')
    expect(sources.formModal).toContain('同时更新')
    // 防双击重复提交：成功关闭期间保持 saving，下一次打开才复位
    expect(sources.formModal).toContain('let succeeded')
    expect(sources.formModal).toContain('if (!succeeded) saving.value = false')
    expect(sources.violationsPage).not.toContain('VIOLATION_CATEGORY_OPTIONS')
    expect(sources.violationsPage).not.toContain('categoryFilterOptions')
    expect(sources.detailModal).not.toContain('分类')
    expect(sources.overviewPanel).not.toContain('按违纪类型统计')
    expect(sources.overviewPanel).not.toContain('categoryCounts')
    expect(sources.profileModal).not.toContain('categories')
  })

  it('Phase 4 验收修复：违纪空状态操作按钮走 EmptyState 默认插槽；照片墙有空状态引导', () => {
    expect(sources.violationsPage).not.toContain('#actions')
    expect(sources.violationsPage).toContain('新增第一条违纪记录')
    const photosPage = readFileSync(resolve(process.cwd(), 'src/views/Photos/index.vue'), 'utf8')
    expect(photosPage).toContain('还没有学生设置证件照')
    const toolbox = readFileSync(resolve(process.cwd(), 'src/views/Toolbox/index.vue'), 'utf8')
    expect(toolbox).toContain('不包含照片文件')
    expect(toolbox).toContain('importJsonPhotoNote')
  })

  it('照片 UI 使用 Phase 1B Store 的上传 / 删除 / 当前证件照 / 读取能力', () => {
    expect(sources.photoManager).toContain('useStudentPhotoStore()')
    expect(sources.photoManager).toContain('runPhotoUploadBatch')
    expect(sources.photoManager).toContain('addPhoto(')
    expect(sources.photoManager).toContain('setCurrentIdPhoto(')
    expect(sources.photoManager).toContain('removePhoto(')
    expect(sources.photoManager).toContain('usePhotoThumbUrls')
    // v3.8.1 Phase 1.1：恢复出的「仅本机」照片必须有可点的上传入口（复用既有队列）
    expect(sources.photoManager).toContain('canUploadLocalPhoto')
    expect(sources.photoManager).toContain('queuePhotoUpload')
    expect(sources.photoManager).toContain('上传到云端')
    expect(sources.photoViewer).toContain('getPhotoBlob(')
    expect(sources.photoWall).toContain('buildClassPhotoWall')
    expect(sources.photoWall).toContain('activeStudents')
  })

  it('家长处理意见与教师备注在详情里分开显示，空值显示「暂未填写」', () => {
    expect(sources.detailModal).toContain('教师备注')
    expect(sources.detailModal).toContain('家长处理意见')
    expect(sources.detailModal).toContain('暂未填写')
  })

  it('照片 UI 不自行签发 / 持久化签名 URL（取图统一走 Store 的 Blob 能力）', () => {
    for (const key of ['photoManager', 'photoViewer', 'photoWall'] as const) {
      expect(sources[key], `${key} 不应自己签 URL`).not.toContain('getPhotoSignedUrl')
      expect(sources[key], `${key} 不应自己签 URL`).not.toContain('createSignedUrl')
      expect(sources[key], `${key} 不应拼云端地址`).not.toContain('tcb.qcloud.la')
    }
    expect(sources.photoViewer).toContain('getPhotoBlob(')
  })

  it('上传成功文案只承诺"保存到本机"，不谎称云端已验证', () => {
    expect(sources.photoManager).toContain('已保存')
    expect(sources.photoManager).toContain('到本机')
    expect(sources.photoManager).toContain('云端补传会自动进行')
  })

  it('照片管理展示备份提示（不暗示完整备份）', () => {
    expect(sources.photoManager).toContain('PHOTO_BACKUP_NOTICE')
    expect(sources.photoWall).toContain('PHOTO_BACKUP_NOTICE')
  })

  it('数据与同步页同时保留 JSON 备份并接入 ZIP 完整备份（两种格式分开）', () => {
    // 旧 JSON 入口与导入路径继续存在
    expect(sources.toolbox).toContain('exportBackup')
    expect(sources.toolbox).toContain('onFilePicked')
    expect(sources.toolbox).toContain('parseBackup')
    // 新 ZIP 完整备份入口：走 usePhotoArchive，不在页面里自己拼 zip / 读 IndexedDB
    expect(sources.toolbox).toContain('usePhotoArchive')
    expect(sources.toolbox).toContain('exportArchiveBackup')
    expect(sources.toolbox).toContain('parseArchiveFile')
    expect(sources.toolbox).toContain('restoreFullBackup')
    expect(sources.toolbox).toContain('accept=".json,.zip')
    // 页面不直接碰照片底层服务（与既有边界一致）
    expect(sources.toolbox).not.toContain('@/services/mediaStore')
    expect(sources.toolbox).not.toContain('@/services/photoCloud')
  })
})
