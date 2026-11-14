/**
 * TeacherDesk · 导航回退（自管，替代 Workbox 的 `navigateFallback`）
 *
 * 为什么不用 Workbox 自带的导航回退（v3.7.8 修复，2026-11-13）：
 *
 * CloudBase 默认域名（`*.tcloudbaseapp.com`）有一条平台策略——网关对
 * **非导航请求**（`Sec-Fetch-Mode` 不是 `navigate`）一律追加
 * `Content-Disposition: attachment`，只对浏览器导航请求返回「访问提示」中间页。
 * 官方说明：<https://docs.cloudbase.net/service/alias>（实测连不存在的对象
 * 的 404 页都带这个头，所以它来自网关，不是对象元数据，部署脚本改不动它）。
 *
 * 而 Workbox 预缓存 `index.html` 用的正是**非导航请求**。于是只要预缓存发生的
 * 那一刻没有「确定访问」的 Cookie（Cookie 有效期由平台动态调整），缓存里那份
 * `index.html` 就会带上 `attachment`；导航回退再把它原样交给浏览器，Chrome 就
 * **把首页当成附件下载**（中文界面里落盘名是「下载.html」），页面一片空白。
 * 实测复现：把带 `attachment` 的 `index.html` 写进预缓存后刷新，Chrome 立即
 * 触发下载且不渲染。
 *
 * 修法：不再让 Workbox 注册导航路由，改由本文件接管——命中缓存或走网络都行，
 * 但**返回给浏览器之前一律摘掉 `content-disposition`**。这样：
 *   ① 新用户不会再被污染；
 *   ② 已经中毒的缓存也能正常渲染（自愈，不用让教师去注销 Service Worker）；
 *   ③ 离线启动照旧（导航仍然优先吃预缓存里的 `index.html`）。
 *
 * 顺序：workbox-build 把 `importScripts` 放在 `precacheAndRoute` 之前，所以本
 * 监听器先注册；即使某条导航同时命中 Workbox 的预缓存路由，也是本监听器的
 * 响应生效。
 */

/** 预缓存里 SPA 入口的键（相对作用域根，等于 `dist/index.html`） */
const TD_ENTRY_URL = '/index.html'

/**
 * 复制一份响应并摘掉 `content-disposition`。
 * 没有这个头就原样返回——不做无谓的流复制。
 */
function withoutAttachment(response) {
  if (!response || !response.headers.has('content-disposition')) return response
  const headers = new Headers(response.headers)
  headers.delete('content-disposition')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  // 只管「打开页面」这一类请求：子资源带 attachment 不会被当成下载，不用管
  if (request.mode !== 'navigate') return
  if (request.method !== 'GET') return

  event.respondWith(
    (async () => {
      // 先吃预缓存（离线可用）；ignoreSearch 让带查询串的深链也走同一条回退
      let cached = null
      try {
        cached = await caches.match(TD_ENTRY_URL, { ignoreSearch: true })
      } catch {
        cached = null
      }
      if (cached) return withoutAttachment(cached)

      try {
        return withoutAttachment(await fetch(request))
      } catch {
        return Response.error()
      }
    })(),
  )
})
