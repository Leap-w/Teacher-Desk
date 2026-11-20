/**
 * 把 Portal 数据快照 + 固化的 UI 资源拼成单个可离线打开的 HTML（v3.9.0）。
 *
 * 纯函数：输入快照数据与资源字符串，输出完整 HTML 文本。不读 store / 不碰 DOM。
 * 产物里 CSS、JS、数据（含照片 data URL）全部内联，无任何外部请求：
 * - <style> 注入 PORTAL_CSS；
 * - window.__PORTAL_SNAPSHOT__ = <数据>，Portal 的 data/index.ts 读取它并以只读模式渲染；
 * - <script> 注入 PORTAL_JS（自包含 bundle，挂载 Vue 应用到 #app）。
 */
import type { PortalSnapshotData } from './portalSnapshot'

export interface BuildPortalHtmlInput {
  data: PortalSnapshotData
  js: string
  css: string
}

/**
 * 把数据序列化为可安全内联进 <script> 的 JSON 字面量。
 * 关键：转义 `<`，避免数据里出现 `</script>` 提前闭合脚本标签（学生姓名/备注等是教师输入）。
 * 用 \u003c 等价替换，JSON.parse 后语义不变。
 */
export function serializeSnapshot(data: PortalSnapshotData): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}

export function buildPortalHtml(input: BuildPortalHtmlInput): string {
  const snapshotLiteral = serializeSnapshot(input.data)
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#F8FAFB" />
    <meta name="description" content="TeacherDesk 班级门户 · 本地导出快照" />
    <link
      rel="icon"
      type="image/svg+xml"
      href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%232F8F83'/%3E%3Ctext x='32' y='44' text-anchor='middle' font-family='sans-serif' font-size='34' fill='%23fff'%3E9%3C/text%3E%3C/svg%3E"
    />
    <title>${input.data.classInfo.name} · 班级门户</title>
    <style>${input.css}</style>
  </head>
  <body>
    <div id="app"></div>
    <script>window.__PORTAL_SNAPSHOT__ = ${snapshotLiteral};</script>
    <script>${input.js}</script>
  </body>
</html>
`
}
