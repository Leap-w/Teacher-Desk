/**
 * 单文件导出的安全回归（v3.9.1）。
 *
 * 这里断言的是**真实产物**：真实快照投影 + 真实固化 UI 资源（PORTAL_JS / PORTAL_CSS），
 * 不是桩字符串。目标是四件事：
 * ① 不含 CloudBase 凭据与会话痕迹（token / session / Authorization / 签名参数）；
 * ② 不含 `cloud://` 之类的存储标识、fileId、storagePath；
 * ③ 不依赖任何外部 CSS / JS / 字体 / 图片（断网 `file://` 必须能看）；
 * ④ 照片只以最终内联的 data URL 存在；
 * ⑤ 班主任内部备注（remark）与家庭信息不随快照外泄。
 */
import { describe, expect, it } from 'vitest'

import { buildPortalSnapshot } from '@/utils/portalHtml/portalSnapshot'
import { buildPortalHtml } from '@/utils/portalHtml/buildPortalHtml'
import { PORTAL_CSS, PORTAL_JS } from '@/utils/portalHtml/portalAssets'
import type { Student } from '@/types'
import type { Seat } from '@/types/seat'
import type { Lesson } from '@/types/timetable'

function student(overrides: Partial<Student> = {}): Student {
  return {
    id: 's1',
    name: '张三',
    studentNo: '1',
    gender: 'male',
    ...overrides,
  }
}

function lesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    id: 'l1',
    weekday: 1,
    periodId: 'morning',
    subject: '语文',
    classId: '',
    className: '高一9班',
    teacher: '陈老师',
    type: 'normal',
    ...overrides,
  }
}

function seat(row: number, col: number, studentId?: string): Seat {
  return { id: `r${row}c${col}`, row, col, block: 'left', ...(studentId ? { studentId } : {}) }
}

const DATA_URL_A = `data:image/jpeg;base64,${Buffer.from('PHOTO-A-BYTES').toString('base64')}`
const DATA_URL_B = `data:image/jpeg;base64,${Buffer.from('PHOTO-B-BYTES').toString('base64')}`

/** 真实项目里出现过的敏感值：备注、手机号、家庭地址、身份证尾号。 */
const SECRET_REMARK = '单亲，父亲长期在外，情绪不稳，注意家长沟通'
const SECRET_PHONE = '13900001111'
const SECRET_ADDRESS = '西藏自治区昌都市卡若区某某乡某某村 12 号'
const SECRET_ID_SUFFIX = '8821'

function buildRealHtml(): string {
  const data = buildPortalSnapshot({
    students: [
      student({
        id: 's1',
        name: '张三',
        cadreRole: '班长',
        remark: SECRET_REMARK,
        phone: SECRET_PHONE,
        familyAddress: SECRET_ADDRESS,
        idCardSuffix: SECRET_ID_SUFFIX,
        dormitory: '301',
      }),
      student({ id: 's2', name: '李四', gender: 'female' }),
    ],
    lessons: [lesson({})],
    seats: [seat(1, 1, 's1'), seat(1, 2, 's2')],
    photos: [
      {
        photoId: 'p1',
        studentId: 's1',
        studentName: '张三',
        category: 'id-photo',
        dataUrl: DATA_URL_A,
      },
      {
        photoId: 'p2',
        studentId: 's2',
        studentName: '李四',
        category: 'life-photo',
        dataUrl: DATA_URL_B,
      },
    ],
    className: '高一9班',
    generatedAt: new Date(2026, 10, 20, 9, 5),
  })
  return buildPortalHtml({ data, js: PORTAL_JS, css: PORTAL_CSS })
}

describe('单文件导出 · 安全回归（真实产物）', () => {
  it('不含任何 CloudBase 会话 / Token / 认证凭据痕迹', () => {
    const html = buildRealHtml()
    for (const banned of [
      'access_token',
      'refresh_token',
      'Authorization',
      'Bearer ',
      'signedUrl',
      'Signature=',
      'x-cos-security-token',
      'credential',
      'sessionStorage',
      'localStorage',
    ]) {
      expect(html, `导出 HTML 不应包含 ${banned}`).not.toContain(banned)
    }
  })

  it('不含 cloud:// 存储标识、fileId 与 storagePath', () => {
    const html = buildRealHtml()
    expect(html).not.toContain('cloud://')
    expect(html).not.toContain('fileId')
    expect(html).not.toContain('storagePath')
    // 元数据里的对象路径前缀也不该出现（学生照片路径形如 student-photos/<id>/<photoId>.jpg）
    expect(html).not.toContain('student-photos/')
  })

  it('不含临时签名下载 URL（含 COS 域名与签名参数）', () => {
    const html = buildRealHtml()
    for (const banned of [
      'myqcloud.com',
      'tcb.qcloud.la',
      'tcloudbaseapp.com',
      '?sign=',
      '&sign=',
      'q-sign-algorithm',
      'q-ak=',
    ]) {
      expect(html, `导出 HTML 不应包含签名地址片段 ${banned}`).not.toContain(banned)
    }
  })

  it('不依赖外部 CSS / JS / 字体 / 图片资源', () => {
    const html = buildRealHtml()
    expect(html).not.toMatch(/<script[^>]+\bsrc=/i)
    expect(html).not.toMatch(/<link[^>]+rel=["']?stylesheet/i)
    expect(html).not.toMatch(/@import\s+(url\()?["']?https?:/i)
    expect(html).not.toMatch(/url\(\s*["']?https?:/i)
    expect(html).not.toMatch(/<img[^>]+src=["']https?:/i)
    expect(html).not.toMatch(/(src|href)=["']\/\//i)
    // 唯一允许的外部字样是 SVG 命名空间等标识符，不是资源请求
    expect(html).toContain('<style>')
    expect(html).toContain('window.__PORTAL_SNAPSHOT__ =')
  })

  it('照片只以最终内联的 data URL 存在（快照里没有别的 URL 形态）', () => {
    const html = buildRealHtml()
    const snapshotPart = html.slice(
      html.indexOf('window.__PORTAL_SNAPSHOT__ ='),
      html.indexOf('</script>', html.indexOf('window.__PORTAL_SNAPSHOT__ =')),
    )
    const photoUrlMatches = [...snapshotPart.matchAll(/"url":"([^"]*)"/g)].map((m) => m[1]!)
    expect(photoUrlMatches).toHaveLength(2)
    for (const url of photoUrlMatches) {
      expect(url.startsWith('data:image/')).toBe(true)
    }
    // 两张照片的实际字节都在产物里，不是占位
    expect(html).toContain(Buffer.from('PHOTO-A-BYTES').toString('base64'))
    expect(html).toContain(Buffer.from('PHOTO-B-BYTES').toString('base64'))
  })

  it('班主任内部备注与家庭信息不进入导出 HTML', () => {
    const html = buildRealHtml()
    for (const secret of [SECRET_REMARK, SECRET_PHONE, SECRET_ADDRESS, SECRET_ID_SUFFIX]) {
      expect(html, '导出 HTML 不应包含内部信息').not.toContain(secret)
    }
  })
})
