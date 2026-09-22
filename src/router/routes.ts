/**
 * 全部路由表（独立成模块：导航 / 常驻测试都要直接读它——
 * router/index.ts 里的 createWebHistory 依赖 window，node 测试环境碰不得）。
 */
import type { RouteRecordRaw } from 'vue-router'

import { loadWorkTab } from '@/utils/workTab'

/**
 * 父级布局组件**必须懒加载**：routes.ts 会被 node 环境的常驻测试直接 import，
 * 静态 import .vue 会让 vitest 的 transform 直接报错（本仓库测试环境无 jsdom，见 §11.4）。
 */
const ModuleLayout = () => import('@/components/layout/ModuleLayout.vue')

/**
 * 旧入口兼容（v3.0.4-rc）：各模块页右上角 ⚙ 与旧书签带的 `?module=<id>`
 * → 对应的二级设置页。id 沿用 V1.3.2 定下的那套，URL 不失效。
 *
 * v3.2.0：`appearance`（深色模式）整条撤下——它没有二级页可去了，
 * 命中不到就按下面的兜底回「我的」页，开关就在那张卡里。
 */
const SETTINGS_MODULE_GROUP: Record<string, string> = {
  time: 'term',
  work: 'teaching',
  seats: 'teaching',
  leave: 'class',
  duty: 'class',
  weekend: 'class',
}

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
      {
        // v3.6.0：班费管理（班级电子流水账）。排在四个既有子模块之后——
        // 二级导航的顺序由本表决定，插在中间会让教师习惯的位置整体挪一格。
        path: 'fund',
        name: 'fund',
        component: () => import('@/views/Fund/index.vue'),
        meta: { title: '班费管理' },
      },
    ],
  },
  {
    path: '/work',
    component: ModuleLayout,
    meta: { title: '工作管理', subtitle: '课程安排与工作事项' },
    children: [
      /*
       * v3.1.0：默认进课程表（此前是工作清单），并**记住教师上次停留的那一页**——
       * 重定向写成函数，读 `utils/workTab.ts` 的记忆；没记过则是课程表。
       * 两个子页的顺序决定二级导航的先后，因此 schedule 排在 works 前面。
       */
      { path: '', redirect: () => loadWorkTab() },
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
  /**
   * 二级设置页（v3.0.4-rc）：设置从「就地展开」改成「一页一组」，
   * 「我的 → 设置」里的每一项都进这里的一页。
   *
   * `/my/settings` 本身保留为**兼容入口**：各模块页右上角的 ⚙ 与旧书签带
   * `?module=<id>` 进来时，按下面的对照表直接落到对应的二级页（URL 不失效）。
   */
  {
    path: '/my/settings',
    redirect: (to) => {
      const raw = Array.isArray(to.query.module) ? to.query.module[0] : to.query.module
      const group = typeof raw === 'string' ? SETTINGS_MODULE_GROUP[raw] : undefined
      return group ? { path: `/my/settings/${group}` } : { path: '/my' }
    },
  },
  /**
   * v3.2.0：`/my/settings/display` 这一页**删掉了**——深色模式改在「我的」页的
   * 系统设置卡里就地开关（`ProfileMenuCard` 的开关行），不再需要一个只放一个开关的页面。
   * 路径保留为重定向：旧书签与历史记录点进来还是回到能操作它的那一页，而不是 404。
   */
  { path: '/my/settings/display', redirect: '/my' },
  {
    path: '/my/settings/teaching',
    name: 'settings-teaching',
    component: () => import('@/views/My/settings/TeachingSettings.vue'),
    meta: { title: '教学设置', hidden: true },
  },
  {
    // v3.3.0：课程时间设置从「假按钮」补成真页面（教学设置的第一项进这里）
    path: '/my/settings/teaching/periods',
    name: 'settings-teaching-periods',
    component: () => import('@/views/My/settings/CourseTimeSettings.vue'),
    meta: { title: '课程时间', hidden: true },
  },
  {
    path: '/my/settings/class',
    name: 'settings-class',
    component: () => import('@/views/My/settings/ClassSettings.vue'),
    meta: { title: '班级设置', hidden: true },
  },
  {
    path: '/my/settings/term',
    name: 'settings-term',
    // v3.1.0：「学期与倒计时」改名「时光中心」，组件文件同步改名（路径不动，旧书签不失效）
    component: () => import('@/views/My/settings/TimeCenterSettings.vue'),
    meta: { title: '时光中心', hidden: true },
  },
  {
    path: '/my/tools',
    name: 'my-tools',
    component: () => import('@/views/Toolbox/index.vue'),
    meta: { title: '数据与同步', hidden: true },
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
