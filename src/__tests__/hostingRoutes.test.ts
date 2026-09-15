import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RouteRecordRaw } from 'vue-router'

import { routes as appRoutes } from '@/router/routes'

/**
 * 部署占位守护（v3.0.1）：CloudBase 静态托管没有 SPA 回退，直接访问或刷新
 * 子路由要靠 `<路由>/index.html` 占位文件（scripts/hosting-routes.cjs 在
 * `npm run build` 末尾生成）。这里用**真正的路由表**交叉验证脚本的解析：
 * 路由表新增了路由而脚本解析跟不上时，本文件会红。
 */
const require = createRequire(import.meta.url)
const hostingRoutes = require('../../scripts/hosting-routes.cjs') as {
  parseStaticPaths(source: string): string[]
  generateStubs(distDir: string): string[]
}

/** 把路由表拍平成「可直接访问的静态路径」——与脚本的文本解析同一口径 */
function flatten(records: readonly RouteRecordRaw[], base = ''): string[] {
  const out = new Set<string>()
  for (const record of records) {
    const segment = record.path
    if (segment === '') continue // 空子路径 = 父级自身，已由父级覆盖
    const full = segment.startsWith('/') ? segment : `${base}/${segment}`
    if (full.includes(':') || full === '/') continue // 动态段 / 根路径（index.html 本身）
    out.add(full)
    if (record.children) for (const child of flatten(record.children, full)) out.add(child)
  }
  return [...out].sort()
}

describe('hosting routes（SPA 深链占位）', () => {
  it('脚本解析结果与真实路由表拍平结果一致（防新增路由漏占位）', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/router/routes.ts'), 'utf8')
    expect(hostingRoutes.parseStaticPaths(source)).toEqual(flatten(appRoutes))
  })

  it('解析覆盖全部 23 条静态路径（快照锚定，防解析意外放宽/收窄）', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/router/routes.ts'), 'utf8')
    expect(hostingRoutes.parseStaticPaths(source)).toEqual([
      '/class',
      '/class/duty',
      '/class/leave',
      '/class/seats',
      '/class/weekend',
      '/duty',
      '/leave',
      '/my',
      '/my/classroom',
      '/my/profile',
      '/my/settings',
      '/my/settings/class',
      '/my/settings/display',
      '/my/settings/teaching',
      '/my/settings/term',
      '/my/tools',
      '/seats',
      '/students',
      '/toolbox',
      '/weekend',
      '/work',
      '/work/schedule',
      '/work/works',
    ])
  })

  it('跳过空段、动态段与根路径；函数体里的 path: 不误匹配', () => {
    const source = [
      'export const routes = [',
      "  { path: '/', component: Home },",
      "  { path: '/a', component: A, children: [",
      "    { path: '', redirect: '/a/b' },",
      "    { path: ':id', component: Detail },",
      "    { path: 'b', component: B },",
      '  ]},',
      "  { path: '/:pathMatch(.*)*', redirect: '/' },",
      "  { path: '/old', redirect: (to) => ({ path: '/a', query: to.query }) },",
      ']',
    ].join('\n')
    expect(hostingRoutes.parseStaticPaths(source)).toEqual(['/a', '/a/b', '/old'])
  })

  it('generateStubs 为每条路由生成 index.html 副本，内容与 dist/index.html 一致', () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'td-stubs-'))
    try {
      const stub = '<!doctype html><html lang="zh-CN">stub</html>'
      writeFileSync(path.join(tmp, 'index.html'), stub)
      const generated = hostingRoutes.generateStubs(tmp)
      expect(generated).toEqual(flatten(appRoutes))
      for (const route of generated) {
        expect(readFileSync(path.join(tmp, route, 'index.html'), 'utf8')).toBe(stub)
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
