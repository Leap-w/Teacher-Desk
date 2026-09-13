/**
 * 全部路由表（独立成模块：导航 / 常驻测试都要直接读它——
 * router/index.ts 里的 createWebHistory 依赖 window，node 测试环境碰不得）。
 */
import type { RouteRecordRaw } from 'vue-router'

/**
 * 父级布局组件**必须懒加载**：routes.ts 会被 node 环境的常驻测试直接 import，
 * 静态 import .vue 会让 vitest 的 transform 直接报错（本仓库测试环境无 jsdom，见 §11.4）。
 */
const ModuleLayout = () => import('@/components/layout/ModuleLayout.vue')

/** 一级导航项顺序由本表驱动：首页 / 学生档案 / 班级管理 / 工作管理 / 我的 */
export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/Home/index.vue'),
    meta: { title: '首页' },
  },
  {
    path: '/students',
    name: 'students',
    component: () => import('@/views/Students/index.vue'),
    // V1.3.0：学生档案从班级管理独立为一级导航（URL 未变）
    meta: { title: '学生档案' },
  },
  {
    path: '/class',
    component: ModuleLayout,
    // V1.3.0：父级 = 统一页面骨架（大标题 + 次级导航 + RouterView）
    meta: { title: '班级管理', subtitle: '班级事务与学生管理' },
    children: [
      // V1.3.0：一级菜单直接进入第一个子模块（座位管理），次级导航切换
      { path: '', redirect: '/class/seats' },
      {
        path: 'seats',
        name: 'seats',
        component: () => import('@/views/Seats/index.vue'),
        meta: { title: '座位管理' },
      },
      {
        path: 'leave',
        name: 'leave',
        component: () => import('@/views/Leave/index.vue'),
        meta: { title: '请假管理' },
      },
      {
        path: 'duty',
        name: 'duty',
        component: () => import('@/views/Duty/index.vue'),
        meta: { title: '值日管理' },
      },
      {
        path: 'weekend',
        name: 'weekend',
        component: () => import('@/views/Weekend/index.vue'),
        meta: { title: '周末管理' },
      },
    ],
  },
  {
    path: '/work',
    component: ModuleLayout,
    meta: { title: '工作管理', subtitle: '课程安排与工作事项' },
    children: [
      // V1.3.0：工作管理默认进入工作清单
      { path: '', redirect: '/work/works' },
      {
        path: 'schedule',
        name: 'schedule',
        component: () => import('@/views/Schedule/index.vue'),
        meta: { title: '课程表' },
      },
      {
        path: 'works',
        name: 'works',
        component: () => import('@/views/Works/index.vue'),
        meta: { title: '工作清单' },
      },
    ],
  },
  /* ---- 旧路径兼容（V1.1.5 前的稳定 URL）：重定向到班级管理层级，旧链接不失效 ---- */
  { path: '/seats', redirect: '/class/seats' },
  { path: '/leave', redirect: '/class/leave' },
  { path: '/duty', redirect: '/class/duty' },
  { path: '/weekend', redirect: '/class/weekend' },
  {
    // 「我的」个人中心；工具箱整页在 /my/tools，设置统一在 /my/settings
    path: '/my',
    name: 'my',
    component: () => import('@/views/My/index.vue'),
    meta: { title: '我的' },
  },
  {
    path: '/my/profile',
    redirect: '/my',
  },
  {
    path: '/my/settings',
    // V1.3.2：设置并入「我的」页功能设置 Tab（?module=xxx 直达对应分组，URL 兼容）
    redirect: (to) => ({ path: '/my', query: to.query }),
  },
  {
    path: '/my/tools',
    name: 'my-tools',
    component: () => import('@/views/Toolbox/index.vue'),
    meta: { title: '工具箱', hidden: true },
  },
  {
    // 课堂工具（Phase Classroom-1）：从「我的 → 工具箱」进入，也可直接开链接
    path: '/my/classroom',
    name: 'my-classroom',
    component: () => import('@/views/Classroom/ClassroomView.vue'),
    meta: { title: '课堂工具', hidden: true },
  },
  /* ---- 旧路径兼容（V1.1.6）：工具箱并入「我的」，旧链接自动跟过去 ---- */
  { path: '/toolbox', redirect: '/my/tools' },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]
