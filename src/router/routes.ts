/**
 * 全部路由表（独立成模块：侧边栏 / 常驻测试都要直接读它——
 * router/index.ts 里的 createWebHistory 依赖 window，node 测试环境碰不得）。
 */
import { RouterView } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

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
    // V1.2.1 IA 重构：侧边栏只留 4 个全局入口，学生档案降级为
    // 班级管理枢纽页的入口卡（/students URL 保持可直接访问）
    meta: { title: '学生档案', icon: '🎓', hidden: true },
  },
  {
    // 「班级管理」父级只负责布局出口：直接复用 vue-router 的 RouterView 组件
    // （**不能用** `{ template: '<router-view />' }`——本项目 Vue 构建不含运行时模板编译器，
    //  内联 template 会整页空白且无报错弹窗，V1.1.3 真机验收时才暴露）
    path: '/class',
    component: RouterView,
    meta: { title: '班级管理', icon: '🎒' },
    children: [
      {
        // V1.2.1 导航 IA 重构：/class 本身是枢纽页（卡片式二级入口），
        // 不再 redirect 到 /class/seats；子路由原样保留，旧 URL 全部可访问
        path: '',
        name: 'class-hub',
        component: () => import('@/views/Class/index.vue'),
        meta: { title: '班级管理', icon: '🎒' },
      },
      {
        path: 'seats',
        name: 'seats',
        component: () => import('@/views/Seats/index.vue'),
        meta: { title: '座位管理', icon: '🪑' },
      },
      {
        path: 'leave',
        name: 'leave',
        component: () => import('@/views/Leave/index.vue'),
        meta: { title: '请假管理', icon: '📝' },
      },
      {
        path: 'duty',
        name: 'duty',
        component: () => import('@/views/Duty/index.vue'),
        meta: { title: '值日管理', icon: '🧹' },
      },
      {
        path: 'weekend',
        name: 'weekend',
        component: () => import('@/views/Weekend/index.vue'),
        meta: { title: '周末管理', icon: '🧳' },
      },
    ],
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
        // V1.2.1：/work 本身是枢纽页（卡片式二级入口），不再 redirect 到 /work/schedule
        path: '',
        name: 'work-hub',
        component: () => import('@/views/Work/index.vue'),
        meta: { title: '工作管理', icon: '📋' },
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
  /* ---- 旧路径兼容（V1.1.5 前的稳定 URL）：重定向到班级管理层级，旧链接不失效 ---- */
  { path: '/seats', redirect: '/class/seats' },
  { path: '/leave', redirect: '/class/leave' },
  { path: '/duty', redirect: '/class/duty' },
  { path: '/weekend', redirect: '/class/weekend' },
  {
    // 「我的」个人中心（V1.1.6）：取代「工具箱」成为侧边栏入口；
    // 工具箱整页迁到 /my/tools（组件原样复用，功能不变），各功能页右上角的 ⚙
    // 也统一跳到 /my/settings——设置页面只有一套，入口可以多个。
    path: '/my',
    name: 'my',
    component: () => import('@/views/My/index.vue'),
    meta: { title: '我的', icon: '👤' },
  },
  {
    path: '/my/profile',
    redirect: '/my',
  },
  {
    path: '/my/settings',
    name: 'my-settings',
    component: () => import('@/views/My/Settings.vue'),
    meta: { title: '设置', icon: '⚙️', hidden: true },
  },
  {
    path: '/my/tools',
    name: 'my-tools',
    component: () => import('@/views/Toolbox/index.vue'),
    meta: { title: '工具箱', icon: '🧰', hidden: true },
  },
  /* ---- 旧路径兼容（V1.1.6）：工具箱并入「我的」，旧链接自动跟过去 ---- */
  { path: '/toolbox', redirect: '/my/tools' },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]
