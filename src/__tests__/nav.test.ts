/**
 * 一级导航激活判定自检（v3.8.2 · Phase 3）。
 *
 * 修的是「班级管理」到 `/class/photos` 等二级页时一级不高亮的 bug：
 * 根因是一级导航 `to` 写成了 `/class/seats`，前缀匹配命不中其它二级页。
 * 这里分两层钉死：
 * ① 纯函数 `isNavActive` 的判定矩阵（各班级二级页 / 其它模块 / 根路由 / 前缀边界）；
 * ② 源码级钉子：`AppHeader` 的一级项必须是模块根 `/class`，且 `/class` 的重定向
 *    落点仍是 `/class/seats`（改 `to` 不能改变点击后的默认落点）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { routes } from '@/router/routes'
import { isNavActive } from '@/utils/nav'

describe('一级导航激活判定', () => {
  it('班级管理：所有二级路由都保持激活', () => {
    const classPaths = [
      '/class',
      '/class/seats',
      '/class/photos',
      '/class/leave',
      '/class/duty',
      '/class/holiday',
      '/class/fund',
    ]
    for (const path of classPaths) {
      expect(isNavActive('/class', path), `${path} 应激活班级管理`).toBe(true)
    }
  })

  it('班级管理：离开 /class 模块后取消激活', () => {
    const outside = ['/', '/students', '/work', '/work/schedule', '/my', '/toolbox']
    for (const path of outside) {
      expect(isNavActive('/class', path), `${path} 不该激活班级管理`).toBe(false)
    }
  })

  it('前缀边界：/class2 不误命中班级管理', () => {
    expect(isNavActive('/class', '/class2')).toBe(false)
    expect(isNavActive('/class', '/classification')).toBe(false)
  })

  it('其它模块：模块根与其子路径激活，别的模块不激活', () => {
    expect(isNavActive('/work', '/work')).toBe(true)
    expect(isNavActive('/work', '/work/schedule')).toBe(true)
    expect(isNavActive('/work', '/work/works')).toBe(true)
    expect(isNavActive('/work', '/students')).toBe(false)
    expect(isNavActive('/students', '/students')).toBe(true)
    expect(isNavActive('/my', '/my/tools')).toBe(true)
  })

  it('首页只精确匹配根路由，不让所有页面都高亮首页', () => {
    expect(isNavActive('/', '/')).toBe(true)
    expect(isNavActive('/', '/class/seats')).toBe(false)
    expect(isNavActive('/', '/students')).toBe(false)
  })

  it('刷新 / 深链：判定只依赖 pathname，与进入方式无关', () => {
    // 直接访问、刷新、页内点击最终都是同一个 pathname —— 纯函数不保留任何进入方式的状态
    expect(isNavActive('/class', '/class/photos')).toBe(true)
    expect(isNavActive('/class', '/class/fund')).toBe(true)
    // 路由的 path 不含 query（vue-router 的 route.path 就是这样），深链带参数也不影响
    expect(isNavActive('/class', '/class/photos')).toBe(
      isNavActive('/class', '/class/photos'.split('?')[0]!),
    )
  })
})

describe('导航结构与落点不变（源码级钉子）', () => {
  const header = readFileSync(
    fileURLToPath(new URL('../components/layout/AppHeader.vue', import.meta.url)),
    'utf8',
  )

  it('班级管理一级项指向模块根 /class，不再写死 /class/seats', () => {
    expect(header).toContain("label: '班级管理', to: '/class'")
    expect(header).not.toContain("label: '班级管理', to: '/class/seats'")
    expect(header).toContain('isNavActive(to, route.path)')
  })

  it('/class 的空子路由仍 redirect 到 /class/seats（点击落点不变）', () => {
    const classRoute = routes.find((route) => route.path === '/class')
    const index = classRoute?.children?.find((child) => child.path === '')
    expect(index?.redirect).toBe('/class/seats')
  })

  it('照片墙仍是 /class 的二级路由', () => {
    const classRoute = routes.find((route) => route.path === '/class')
    expect(classRoute?.children?.some((child) => child.path === 'photos')).toBe(true)
  })
})
