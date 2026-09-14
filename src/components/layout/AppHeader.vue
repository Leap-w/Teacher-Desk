<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Database,
  GraduationCap,
  LogOut,
  PencilLine,
  RefreshCw,
  Search,
  User,
} from 'lucide-vue-next'

import LoginModal from '@/components/layout/LoginModal.vue'
import { useCloudSync } from '@/composables/useCloudSync'
import { useLoginModal } from '@/composables/useLoginModal'
import { useToast } from '@/composables/useToast'
import { useUserStore } from '@/stores/user'

/**
 * 顶部工具栏（v3.0.2-rc · 顶部导航版）：
 * 72px 全宽毛玻璃——左：Logo；中：一级导航（首页 / 学生档案 / 班级管理 / 工作管理 / 我的）；
 * 右：课堂工具 · 搜索 · 同步（登录后）· 头像。
 * 左侧 Sidebar 已移除（需求方拍板），一级导航收回顶部；模块内二级导航在 ModuleLayout。
 *
 * 头像行为（登录态驱动）：
 * - 未登录：点击 → 登录弹窗（`useLoginModal`）
 * - 已登录：点击 → 个人菜单（编辑资料 / 数据同步 / 退出登录）
 */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const userStore = useUserStore()
const { signedIn, syncing, syncWithFeedback } = useCloudSync()
const loginModal = useLoginModal()

const scrolled = ref(false)
function onScroll(): void {
  scrolled.value = window.scrollY > 8
}
onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
})
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))

const profile = computed(() => userStore.profile)
const initial = computed(() => userStore.initial)

/** 一级导航：与路由表的一级模块一一对应（班级 / 工作管理落到各自默认子页） */
const NAV_ITEMS = [
  { label: '首页', to: '/' },
  { label: '学生档案', to: '/students' },
  { label: '班级管理', to: '/class/seats' },
  { label: '工作管理', to: '/work/works' },
  { label: '我的', to: '/my' },
] as const

/** 当前激活的一级项（/class/leave 也算「班级管理」激活） */
function isActive(to: string): boolean {
  if (to === '/') return route.path === '/'
  return route.path === to || route.path.startsWith(`${to}/`)
}

const menuOpen = ref(false)

function onAvatarClick(): void {
  if (signedIn.value) menuOpen.value = !menuOpen.value
  else loginModal.show()
}

function closeMenu(): void {
  menuOpen.value = false
}

function goEditProfile(): void {
  closeMenu()
  router.push('/my')
}

function goDataSync(): void {
  closeMenu()
  router.push('/my/tools')
}

async function onSignOut(): Promise<void> {
  closeMenu()
  await syncWithFeedbackSignOut()
}

/** 退出登录：清云会话与同步记账；班级数据留在本机（Local First） */
async function syncWithFeedbackSignOut(): Promise<void> {
  const { signOut } = useCloudSync()
  try {
    await signOut()
    toast.success('已退出登录，数据只保留在本机')
  } catch (error) {
    toast.danger(`退出登录没成功：${error instanceof Error ? error.message : '原因未知'}`)
  }
}

function onSearch(): void {
  toast.info('全局搜索还在路上，先埋头干活。')
}

async function onSync(): Promise<void> {
  if (syncing.value) return
  await syncWithFeedback()
}
</script>

<template>
  <header class="app-header" :class="{ 'is-scrolled': scrolled }">
    <div class="app-header__inner">
      <RouterLink to="/" class="brand" aria-label="回到首页">
        <img class="brand__logo" src="/icons/icon-192.png" alt="" />
        <span class="brand__text">
          <span class="brand__name">TeacherDesk</span>
        </span>
      </RouterLink>

      <!-- 一级导航（左侧 Sidebar 移除后收回顶部） -->
      <nav class="top-nav" aria-label="一级导航">
        <RouterLink
          v-for="item in NAV_ITEMS"
          :key="item.to"
          :to="item.to"
          class="top-nav__item"
          :class="{ 'is-active': isActive(item.to) }"
        >
          {{ item.label }}
        </RouterLink>
      </nav>

      <div class="app-header__right">
        <RouterLink to="/my/classroom" class="icon-btn" aria-label="课堂工具">
          <GraduationCap :size="18" :stroke-width="2" aria-hidden="true" />
        </RouterLink>

        <button type="button" class="icon-btn" aria-label="搜索（即将上线）" @click="onSearch">
          <Search :size="18" :stroke-width="2" aria-hidden="true" />
        </button>

        <button
          v-if="signedIn"
          type="button"
          class="icon-btn"
          :disabled="syncing"
          :aria-label="syncing ? '同步中' : '同步数据'"
          @click="onSync"
        >
          <RefreshCw
            class="is-spinning-capable"
            :class="{ 'is-spinning': syncing }"
            :size="18"
            :stroke-width="2"
          />
        </button>

        <!-- 头像：未登录 → 登录弹窗；已登录 → 个人菜单 -->
        <div class="avatar-wrap">
          <button type="button" class="avatar" aria-label="账号" @click="onAvatarClick">
            <img
              v-if="signedIn && profile.avatar"
              :src="profile.avatar"
              alt=""
              class="avatar__img"
            />
            <span v-else-if="signedIn && initial" class="avatar__fallback" aria-hidden="true">{{
              initial
            }}</span>
            <User v-else class="avatar__guest" :size="20" :stroke-width="2" aria-hidden="true" />
          </button>

          <Transition name="menu">
            <div v-if="menuOpen && signedIn" class="avatar-menu" role="menu">
              <button
                type="button"
                class="avatar-menu__item"
                role="menuitem"
                @click="goEditProfile"
              >
                <PencilLine :size="15" :stroke-width="2" aria-hidden="true" />
                编辑资料
              </button>
              <button type="button" class="avatar-menu__item" role="menuitem" @click="goDataSync">
                <Database :size="15" :stroke-width="2" aria-hidden="true" />
                数据同步
              </button>
              <button
                type="button"
                class="avatar-menu__item avatar-menu__item--danger"
                role="menuitem"
                @click="onSignOut"
              >
                <LogOut :size="15" :stroke-width="2" aria-hidden="true" />
                退出登录
              </button>
            </div>
          </Transition>
        </div>
      </div>
    </div>

    <LoginModal />
  </header>
</template>

<style scoped>
.app-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: var(--z-nav);
  /* 全宽毛玻璃工具栏，接近 macOS——半透明 + blur + 极弱底部分隔线 */
  height: calc(var(--nav-height) + env(safe-area-inset-top, 0px));
  padding-top: env(safe-area-inset-top, 0px);
  background: var(--glass-bg);
  backdrop-filter: blur(var(--nav-blur)) saturate(150%);
  -webkit-backdrop-filter: blur(var(--nav-blur)) saturate(150%);
  border-bottom: 1px solid transparent;
  transition:
    background var(--duration-base) var(--ease-out),
    border-color var(--duration-base) var(--ease-out);
}

.app-header.is-scrolled {
  background: var(--glass-bg-scrolled);
  border-bottom-color: var(--color-border-light);
}

.app-header__inner {
  max-width: var(--page-max-width);
  height: var(--nav-height);
  margin: 0 auto;
  padding: 0 var(--page-pad-x);
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
}

/* ---- 一级导航 ---- */
.top-nav {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.top-nav::-webkit-scrollbar {
  display: none;
}

.top-nav__item {
  padding: 8px 14px;
  border-radius: var(--radius-sm);
  font-size: var(--text-md);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  text-decoration: none;
  white-space: nowrap;
  transition:
    color var(--transition-fast),
    background var(--transition-fast);
}

.top-nav__item:hover {
  color: var(--color-text-primary);
  background: var(--bg-hover);
}

.top-nav__item.is-active {
  color: var(--color-primary-dark);
  background: var(--color-primary-soft);
}

.top-nav__item:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

/* ---- 右侧 ---- */
.app-header__right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}

/* ---- 图标按钮：柔和高亮，无按钮感 ---- */
.icon-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  text-decoration: none;
  cursor: pointer;
  transition:
    background var(--transition-fast),
    color var(--transition-fast);
}

.icon-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--color-text-primary);
}

.icon-btn:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.icon-btn:disabled {
  cursor: default;
}

.is-spinning-capable.is-spinning {
  animation: header-spin 0.9s linear infinite;
}

@keyframes header-spin {
  to {
    transform: rotate(360deg);
  }
}

/* ---- 品牌 ---- */
.brand {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-shrink: 0;
  user-select: none;
}

.brand__logo {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-xs);
  object-fit: cover;
  display: block;
  box-shadow: var(--shadow-xs);
}

.brand__name {
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  letter-spacing: 0.2px;
  white-space: nowrap;
}

/* ---- 头像与个人菜单 ---- */
.avatar-wrap {
  position: relative;
}

.avatar {
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  cursor: pointer;
  background: transparent;
  box-shadow:
    0 0 0 2px var(--color-bg-white),
    0 0 0 4px var(--color-primary-bg);
  transition: transform var(--transition-fast);
}

.avatar:hover {
  transform: scale(1.05);
}

.avatar:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.avatar__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.avatar__fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--color-primary), var(--color-sky));
  color: var(--color-text-inverse);
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
}

/* 未登录占位：中性用户图标（不放假字母/假名字） */
.avatar__guest {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-sky-light);
  color: var(--color-text-tertiary);
}

.avatar-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 160px;
  padding: var(--space-2);
  background: var(--bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: var(--z-dropdown);
}

.avatar-menu__item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 10px var(--space-3);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  font-size: var(--text-md);
  color: var(--color-text-primary);
  text-align: left;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.avatar-menu__item:hover {
  background: var(--bg-hover);
}

.avatar-menu__item--danger {
  color: var(--color-danger);
}

.avatar-menu__item:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.menu-enter-active,
.menu-leave-active {
  transition:
    opacity var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.menu-enter-from,
.menu-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (max-width: 640px) {
  .brand__name {
    display: none;
  }
}
</style>
