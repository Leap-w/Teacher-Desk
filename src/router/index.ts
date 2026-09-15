import { createRouter, createWebHistory } from 'vue-router'

import { routes } from './routes'

/** 全部路由；顶部一级导航由本表驱动（过滤 redirect 项）——定义见 ./routes.ts（可脱离 window 测试） */
export { routes } from './routes'

declare module 'vue-router' {
  interface RouteMeta {
    /** 页面标题 */
    title?: string
    /** 导航图标（占位 emoji，后续替换为 SVG 图标） */
    icon?: string
    /** 一级导航不渲染此路由（如 /my/tools、/my/classroom——「我的」下的二级页以功能项进入） */
    hidden?: boolean
  }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  /**
   * 页面切换回顶部（v3.0.3-rc 修复）。
   *
   * 此前返回 `{ el: 'main.app-content', top: 0 }`，注释写的是「window 自身不滚动」——
   * 实际相反：`.app-shell` 是 `min-height: 100%` 的普通流式容器，`main.app-content`
   * 既没有固定高度也没有 `overflow`，**不是滚动容器**，window 才是。
   * 于是那条规则等于空操作：从一个长页面切到另一个页面会保留原来的滚动位置
   * （在「我的」页拉到最底后点「学生档案」，新页面直接停在半腰）。
   * 浏览器前进 / 后退仍按 `savedPosition` 还原，与预期一致。
   */
  scrollBehavior: (_to, _from, savedPosition) => savedPosition ?? { top: 0 },
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · TeacherDesk` : 'TeacherDesk'
})

export default router
