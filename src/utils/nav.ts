/**
 * 一级导航激活判定（v3.8.2 · Phase 3）。
 *
 * 从 `AppHeader.vue` 抽出成纯函数，只为能在 node 测试里逐路由验证——
 * 判定逻辑一行未改，仍是「根路径精确匹配、其余按 `${to}/` 前缀匹配」。
 *
 * 为什么这条前缀判定对「班级管理」至关重要：一级导航的 `to` 必须是**模块根**
 * `/class`，才能让 `/class/seats` / `/class/photos` / `/class/leave` / `/class/fund`
 * 等所有二级页都高亮。若写成某个子路径（如 `/class/seats`），其余二级页就都不命中
 * （Phase 3 修的就是这个）。「工作管理」同理指向 `/work` 而非 `/work/works`。
 *
 * 边界：`to='/'` 只精确匹配首页，`startsWith('/')` 会让所有路由都高亮首页，故单独处理。
 */
export function isNavActive(to: string, pathname: string): boolean {
  if (to === '/') return pathname === '/'
  return pathname === to || pathname.startsWith(`${to}/`)
}
