import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    /** 页面标题 */
    title?: string
    /** 导航图标（占位 emoji，后续替换为 SVG 图标） */
    icon?: string
  }
}

/** 全部路由；侧边导航由本表驱动（过滤 redirect 项） */
export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/Home/index.vue'),
    meta: { title: '首页', icon: '🏠' },
  },
  {
    path: '/students',
    name: 'students',
    component: () => import('@/views/Students/index.vue'),
    meta: { title: '学生档案', icon: '🎓' },
  },
  {
    path: '/seats',
    name: 'seats',
    component: () => import('@/views/Seats/index.vue'),
    meta: { title: '座位管理', icon: '🪑' },
  },
  {
    path: '/schedule',
    name: 'schedule',
    component: () => import('@/views/Schedule/index.vue'),
    meta: { title: '课程表', icon: '📅' },
  },
  {
    path: '/leave',
    name: 'leave',
    component: () => import('@/views/Leave/index.vue'),
    meta: { title: '请假管理', icon: '📝' },
  },
  {
    path: '/duty',
    name: 'duty',
    component: () => import('@/views/Duty/index.vue'),
    meta: { title: '值日管理', icon: '🧹' },
  },
  {
    path: '/toolbox',
    name: 'toolbox',
    component: () => import('@/views/Toolbox/index.vue'),
    meta: { title: '工具箱', icon: '🧰' },
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

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
