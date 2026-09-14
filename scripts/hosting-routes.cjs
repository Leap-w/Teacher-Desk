#!/usr/bin/env node
/**
 * 生成 SPA 路由占位 —— CloudBase 静态托管的 history 模式回退（v3.0.1）。
 *
 * 背景：托管服务未配置「错误文档 → index.html」，直接访问或刷新
 * `/students` 这类子路由会拿到 404；更糟的是历史上手工上传的占位文件
 * 是某次构建的 index.html 快照，会让子路由加载**旧版**应用（线上实测：
 * /students 指向旧 chunk index-BRWp0FcT.js，只有首页是新的）。
 *
 * 做法：把 dist/index.html 复制为 `<路由>/index.html`（目录索引回退），
 * 挂在 `npm run build` 末尾 —— 每次构建占位内容随之刷新，永不过期。
 *
 * 路径来源：解析 src/router/routes.ts 的静态路径（**含重定向路由**——
 * 书签里的旧链接也要能打开）；动态段（/:xxx）与根路径（/）跳过。
 * 常驻测试 src/__tests__/hostingRoutes.test.ts 用真正的路由表交叉验证
 * 本脚本的解析结果：路由表变了而脚本解析跟不上时，测试会红。
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const ROUTES_TS = path.join(ROOT, 'src', 'router', 'routes.ts')

/**
 * 从 routes.ts 文本解析「可被直接访问的静态路径」。
 * 只认行首的 `path: '...'` 声明——两种书写形式都要命中：多行对象的
 * `path: 'seats',` 与单行的 `{ path: '/seats', redirect: ... }`；而函数体
 * 里的 `({ path: '/my', ... })` 行首是 `redirect:`，不会误匹配。
 * 以 `/` 开头的是顶级路径（更新前缀），否则拼到最近的顶级前缀后面。
 */
function parseStaticPaths(source) {
  const paths = new Set()
  let base = ''
  for (const line of source.split('\n')) {
    const match = line.match(/^\s*\{?\s*path:\s*'([^']*)'/)
    if (!match) continue
    const segment = match[1]
    if (segment === '' || segment.includes(':')) continue
    if (segment.startsWith('/')) {
      base = segment.replace(/\/+$/, '')
      if (base !== '') paths.add(base)
    } else {
      paths.add(`${base}/${segment}`)
    }
  }
  return [...paths].sort()
}

/** 在 dist 里为每条路由生成 index.html 副本，返回生成的路由列表 */
function generateStubs(distDir) {
  const indexHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8')
  const source = fs.readFileSync(ROUTES_TS, 'utf8')
  const routes = parseStaticPaths(source)
  for (const route of routes) {
    const dir = path.join(distDir, route)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'index.html'), indexHtml)
  }
  return routes
}

module.exports = { parseStaticPaths, generateStubs, ROUTES_TS }

if (require.main === module) {
  const distDir = process.argv[2] ?? path.join(ROOT, 'dist')
  const routes = generateStubs(distDir)
  console.log(`[hosting-routes] 已生成 ${routes.length} 个路由占位（<路由>/index.html）`)
  for (const route of routes) console.log(`  ${route}/index.html`)
}
