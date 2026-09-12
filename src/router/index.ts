import { RouterView, createRouter, createWebHistory } from 'vue-router'
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
    path: '/work',
    // 「工作管理」父级只负责布局出口：直接复用 vue-router 的 RouterView 组件
    // （**不能用** `{ template: '<router-view />' }`——本项目 Vue 构建不含运行时模板编译器，
    //  内联 template 会整页空白且无报错弹窗，真机验收时才暴露）
    component: RouterView,
    meta: { title: '工作管理', icon: '📋' },
    children: [
      {
        path: '',
        redirect: '/work/schedule',
      },
      {
        path: 'schedule',
        name: 'schedule',
        component: () => import('@/views/Schedule/index.vue'),
        meta: { title: '课程表', icon: '📅' },
      },
      {
        path: 'works',
        name: 'works',
        component: () => import('@/views/Works/index.vue'),
        meta: { title: '工作清单', icon: '✅' },
      },
    ],
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
    path: '/weekend',
    name: 'weekend',
    component: () => import('@/views/Weekend/index.vue'),
    meta: { title: '周末管理', icon: '🧳' },
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
