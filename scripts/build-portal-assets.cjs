#!/usr/bin/env node
/**
 * 从 TeacherDesk 内置的班级门户 UI 源码（portal-ui/）重新生成单文件 HTML 导出用的
 * 静态资源（v3.9.0 起，Portal 已正式并入主项目）。
 *
 * 用法（修改 portal-ui/ 下的页面后执行）：
 *   node scripts/build-portal-assets.cjs
 *
 * 流程：用主项目已安装的 Vite 构建 portal-ui/ → 读取自包含 JS + CSS →
 * 固化为 src/utils/portalHtml/portalAssets.ts 的两个字符串常量。
 * 整条链只依赖本仓库；不再读取任何外部 Portal 目录，也不需要额外安装依赖。
 * JS 必须是自包含单 chunk（无动态 import / 外部资源引用），否则内联后会失败；
 * 生成后请跑一次真实导出并用浏览器打开验证。
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const PORTAL_UI = path.join(ROOT, 'portal-ui')
const OUT_DIR = path.join(PORTAL_UI, '.build')
const OUT = path.join(ROOT, 'src', 'utils', 'portalHtml', 'portalAssets.ts')

/** 转义为可安全放进反引号模板字符串的内容。 */
function esc(value) {
  return value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
}

async function main() {
  if (!fs.existsSync(path.join(PORTAL_UI, 'src', 'main.ts'))) {
    throw new Error(`找不到内置门户 UI 源码：${PORTAL_UI}`)
  }

  // Vite 7 是 ESM-only：CJS 脚本里用动态 import 调它的 JS API，避免 spawn 子进程。
  const { build } = await import('vite')
  await build({
    configFile: path.join(PORTAL_UI, 'vite.config.ts'),
    logLevel: 'warn',
  })

  const files = fs.readdirSync(OUT_DIR)
  const jsFile = files.filter((name) => name.endsWith('.js'))
  const cssFile = files.filter((name) => name.endsWith('.css'))
  if (jsFile.length !== 1 || cssFile.length !== 1) {
    throw new Error(
      `期望构建产物恰好 1 个 JS + 1 个 CSS，实际 ${jsFile.length} / ${cssFile.length}：${files.join(', ')}`,
    )
  }
  const js = fs.readFileSync(path.join(OUT_DIR, jsFile[0]), 'utf8')
  const css = fs.readFileSync(path.join(OUT_DIR, cssFile[0]), 'utf8')

  if (/\bimport\s*\(/.test(js)) {
    throw new Error('门户 UI JS 含动态 import，无法内联为单文件')
  }

  const body = `/**
 * TeacherDesk 班级门户展示页的静态 UI 资源（单文件 HTML 导出）。
 *
 * 源码在仓库内 portal-ui/（v3.9.0 起 Class Portal 已正式并入 TeacherDesk），
 * 由 scripts/build-portal-assets.cjs 构建后固化到本文件：
 * - PORTAL_JS：自包含 bundle（Vue 运行时 + 五个页面 + 组件），只通过
 *   window.__PORTAL_SNAPSHOT__ 读取静态数据，无网络请求 / 鉴权 / 演示数据。
 * - PORTAL_CSS：设计令牌 + 基础样式 + 组件作用域样式（编译合并后的结果）。
 *
 * 两个字符串是构建期固化的 UI，不是运行时从磁盘读取；不要手工编辑。
 * 修改 portal-ui/ 源码后执行 \`node scripts/build-portal-assets.cjs\` 重新生成。
 */
export const PORTAL_JS = \`${esc(js)}\`

export const PORTAL_CSS = \`${esc(css)}\`
`
  fs.writeFileSync(OUT, body)
  // 构建中间产物不入库；下次构建会重新生成
  fs.rmSync(OUT_DIR, { recursive: true, force: true })
  console.log(`已生成 ${path.relative(ROOT, OUT)}（JS ${js.length} 字节，CSS ${css.length} 字节）`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
