import { createRouter, createWebHistory } from 'vue-router'

import { routes } from './routes'

/** 全部路由；侧边导航由本表驱动（过滤 redirect 项）——定义见 ./routes.ts（可脱离 window 测试） */
export { routes } from './routes'

declare module 'vue-router' {
  interface RouteMeta {
    /** 页面标题 */
    title?: string
    /** 导航图标（占位 emoji，后续替换为 SVG 图标） */
    icon?: string
    /** 侧边栏不渲染此路由（如 /my/settings——「我的」下的二级页以功能项进入） */
    hidden?: boolean
  }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  // 页面滚动容器是 App.vue 中的 main.app-content（window 自身不滚动），需显式指定
  scrollBehavior: () => ({ el: 'main.app-content', top: 0 }),
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · TeacherDesk` : 'TeacherDesk'
})

export default router
