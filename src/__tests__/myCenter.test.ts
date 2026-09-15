/**
 * V1.1.6「我的」个人中心自检：路由结构 + 个人资料 store。
 *
 * 路由：/my 三个页面、/toolbox → /my/tools 重定向、/my/profile → /my。
 * 资料：字段编辑落盘、头像设置 / 删除、非法头像拒绝、昵称必填、
 *       业务数据独立（profile 键与学生 / 课表键互不相干）。
 */
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { installFakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import { routes } from '@/router/routes'
import { BACKUP_MODULES } from '@/utils/backup'
import { DEFAULT_USER_PROFILE, identityLineOf, useUserStore } from '@/stores/user'

const prefix = appConfig.storageKeyPrefix
const PROFILE_KEY = `${prefix}:profile`

/* ========== 路由结构 ========== */

describe('「我的」路由（V1.1.6）', () => {
  const byPath = (path: string) => routes.find((route) => route.path === path)

  it('「我的」入口存在（侧边栏由此渲染）', () => {
    const my = byPath('/my')
    expect(my).toBeDefined()
    expect(my?.meta?.title).toBe('我的')
  })

  it('设置入口 /my/settings 重定向到「我的」并保留 ?module= 直达分组（V1.3.2 设置并入我的页）', () => {
    const settings = byPath('/my/settings')
    expect(settings).toBeDefined()
    expect(String(settings?.redirect)).toContain('/my')
  })

  it('工具箱整页迁到 /my/tools（复用原组件），且不在侧边栏', () => {
    const tools = byPath('/my/tools')
    expect(tools).toBeDefined()
    expect(String(tools?.component)).toContain('Toolbox')
    expect(tools?.meta?.hidden).toBe(true)
  })

  it('/toolbox 自动跳转到 /my/tools（旧链接不失效）', () => {
    expect(byPath('/toolbox')).toMatchObject({ redirect: '/my/tools' })
  })

  it('/my/profile 回到 /my', () => {
    expect(byPath('/my/profile')).toMatchObject({ redirect: '/my' })
  })

  it('个人资料进备份模块（BACKUP_MODULES 第 10 块，备份 / 恢复覆盖它）', () => {
    const hit = BACKUP_MODULES.find((module) => module.key === `${prefix}:profile`)
    expect(hit).toMatchObject({ label: '个人资料', unit: '份' })
  })

  it('侧边栏只应出现「我的」一个入口（settings/tools 均 hidden）', () => {
    const navTopLevel = routes.filter((route) => !route.redirect && !route.meta?.hidden)
    const myEntries = navTopLevel.filter(
      (route) => route.path === '/my' || route.path.startsWith('/my/'),
    )
    expect(myEntries).toHaveLength(1)
    expect(myEntries[0]?.path).toBe('/my')
  })
})

/* ========== 个人资料 store ========== */

describe('useUserStore：个人资料（与业务数据独立）', () => {
  beforeEach(() => {
    installFakeBrowser()
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('默认资料全空（不臆造身份）；首启不写盘；UI 据此显示引导', () => {
    const store = useUserStore()
    // 默认值不再携带任何假身份（旧默认昵称是需求文档示例值「Gile Thomas」）
    expect(store.profile).toMatchObject({
      nickname: '',
      className: '',
      subject: '',
      school: '',
    })
    expect(store.profile.avatar).toBeUndefined()
    // 首次启动不写盘：键不存在 → 内存空资料，教师改过资料才落盘
    expect(window.localStorage.getItem(PROFILE_KEY)).toBeNull()
    // 空资料状态（组件据此显示「尚未设置资料」+ 用户图标，而不是假名字/假字母）
    expect(store.isProfileSet).toBe(false)
    expect(store.initial).toBe('')
    expect(identityLineOf(store.profile)).toBe(' 班主任 · 教师')
  })

  it('编辑昵称 / 学校 / 班级 / 学科 → 落盘', async () => {
    const store = useUserStore()
    const outcome = store.updateProfile({
      nickname: '王老师',
      school: '第二中学',
      className: '高一3班',
      subject: '语文',
    })
    expect(outcome.ok).toBe(true)
    await nextTick()
    const stored = JSON.parse(window.localStorage.getItem(PROFILE_KEY) ?? 'null')
    const saved = Array.isArray(stored) ? stored[0] : stored
    expect(saved).toMatchObject({ nickname: '王老师', school: '第二中学', subject: '语文' })
  })

  it('昵称为空 → 拒绝且不写盘', () => {
    const store = useUserStore()
    const outcome = store.updateProfile({ ...DEFAULT_USER_PROFILE, nickname: '   ' })
    expect(outcome.ok).toBe(false)
    expect(window.localStorage.getItem(PROFILE_KEY)).toBeNull()
  })

  it('设置头像（合法图片 dataURL）→ 落盘；删除头像 → 移除', async () => {
    const store = useUserStore()
    const avatar = 'data:image/png;base64,iVBORw0KGgo='
    expect(store.setAvatar(avatar).ok).toBe(true)
    await nextTick()
    let stored = JSON.parse(window.localStorage.getItem(PROFILE_KEY) ?? 'null')
    expect((Array.isArray(stored) ? stored[0] : stored).avatar).toBe(avatar)

    store.removeAvatar()
    await nextTick()
    stored = JSON.parse(window.localStorage.getItem(PROFILE_KEY) ?? 'null')
    expect((Array.isArray(stored) ? stored[0] : stored).avatar).toBeUndefined()
  })

  it('非法头像（非图片 dataURL）→ 拒绝', () => {
    const store = useUserStore()
    const outcome = store.setAvatar('data:text/plain;base64,SGVsbG8=')
    expect(outcome.ok).toBe(false)
    expect(store.profile.avatar).toBeUndefined()
  })

  it('超大头像 → 拒绝（保护 localStorage 配额）', () => {
    const store = useUserStore()
    const huge = `data:image/png;base64,${'A'.repeat(1024 * 1024 + 1)}`
    const outcome = store.setAvatar(huge)
    expect(outcome.ok).toBe(false)
    expect(store.profile.avatar).toBeUndefined()
  })

  it('业务数据独立：profile 写盘不碰 students / timetable 键', async () => {
    const store = useUserStore()
    store.updateProfile({
      nickname: '李老师',
      school: '一中',
      className: '高二1班',
      subject: '英语',
    })
    await nextTick()
    expect(window.localStorage.getItem(`${prefix}:students`)).toBeNull()
    expect(window.localStorage.getItem(`${prefix}:timetable`)).toBeNull()
    expect(window.localStorage.getItem(PROFILE_KEY)).not.toBeNull()
  })

  it('历史写法（直接存对象而非数组）也能读回', () => {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify({ nickname: '赵老师' }))
    const store = useUserStore()
    expect(store.profile.nickname).toBe('赵老师')
    // 缺字段回默认值
    expect(store.profile.className).toBe(DEFAULT_USER_PROFILE.className)
  })
})
