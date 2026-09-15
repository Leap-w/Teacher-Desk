<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Database, LogOut, PencilLine, RefreshCw, User } from 'lucide-vue-next'

import { useCloudSync } from '@/composables/useCloudSync'
import { useLoginModal } from '@/composables/useLoginModal'
import { useToast } from '@/composables/useToast'
import { useUserStore } from '@/stores/user'

/**
 * AppHeader — 顶部玻璃胶囊导航（v3.0.3-rc · 对齐 Changdu-Memory `AppLayout.vue` 的 top-nav）。
 *
 * **DOM 与视觉层级与昌都记忆顶部导航一一对应**：
 * `header.top-nav > div.top-nav__capsule`（玻璃胶囊：品牌 + 一级导航 + 用户区）。
 * 只替换 TeacherDesk 自己的导航项与功能：
 * 一级导航 = 首页 / 学生档案 / 班级管理 / 工作管理 / 我的；右侧 = 同步按钮（登录后）+ 头像。
 * 左侧 Sidebar 与后台式抽屉导航一律没有。
 *
 * 头像行为（登录态驱动，登录弹窗是全局唯一实例，挂在 App.vue）：
 * - 未登录：默认头像 → 点击唤起登录弹窗
 * - 已登录：头像 → 个人菜单（编辑资料 / 数据同步 / 退出登录）
 */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const userStore = useUserStore()
const { signedIn, syncing, syncWithFeedback, signOut } = useCloudSync()
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

/**
 * 一级导航：与路由表的一级模块一一对应。
 *
 * **「工作管理」指向 `/work` 而不是 `/work/works`**（v3.3.0）：那个模块记住了教师上次停在哪一页
 * （课程表 / 工作清单，见 `router/routes.ts` 的 `loadWorkTab`），而写死的子路径正是绕过这条记忆的
 * 唯一一处——常用工作清单的老师每次点一级导航都会被**送回课程表**，而模块自己的「记住上次停留」
 * 在那一步完全不起作用。指向模块根路径，让路由表那一份记忆决定去哪（`isActive` 认前缀，高亮不受影响）。
 *
 * 「班级管理」仍写 `/class/seats`：`/class` 的重定向目标就是它，两条路等价，不另设一层。
 */
const NAV_ITEMS = [
  { label: '首页', to: '/' },
  { label: '学生档案', to: '/students' },
  { label: '班级管理', to: '/class/seats' },
  { label: '工作管理', to: '/work' },
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
  try {
    await signOut()
    toast.success('已退出登录，数据只保留在本机')
  } catch (error) {
    toast.danger(`退出登录没成功：${error instanceof Error ? error.message : '原因未知'}`)
  }
}

async function onSync(): Promise<void> {
  if (syncing.value) return
  await syncWithFeedback()
}
</script>

<template>
  <header class="top-nav" :class="{ 'is-scrolled': scrolled }">
    <div class="top-nav__capsule">
      <!-- 左侧：品牌标识 -->
      <RouterLink to="/" class="top-nav__brand" aria-label="回到首页">
        <img class="top-nav__logo" src="/icons/icon-192.png" alt="" />
        <span class="top-nav__brand-text">TeacherDesk</span>
      </RouterLink>

      <!-- 中间：一级导航 -->
      <nav class="top-nav__links" aria-label="一级导航">
        <RouterLink
          v-for="item in NAV_ITEMS"
          :key="item.to"
          :to="item.to"
          class="top-nav__link"
          :class="{ 'is-active': isActive(item.to) }"
        >
          {{ item.label }}
        </RouterLink>
      </nav>

      <!-- 右侧：同步（登录后）+ 头像 -->
      <div class="top-nav__user">
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

        <div class="avatar-wrap">
          <!-- 未登录时 title/aria 都明说是「登录」，点下去必有反应（弹窗是壳层那一份全局实例） -->
          <button
            type="button"
            class="avatar"
            :title="signedIn ? '账号' : '登录'"
            :aria-label="signedIn ? '账号菜单' : '登录'"
            @click="onAvatarClick"
          >
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
  </header>
</template>

<style scoped>
/* ==========================================
   顶部导航（对齐 Changdu-Memory .top-nav）
   ========================================== */
.top-nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: var(--z-nav);
  /* 左右留白与页面内容同一档（--page-pad-x），胶囊外缘因此与内容外缘对齐 */
  padding: calc(12px + env(safe-area-inset-top, 0px)) var(--page-pad-x) 12px;
  pointer-events: none; /* 允许点击穿透到下方，胶囊内部恢复 */
}

/* 玻璃胶囊：半透明 + blur + 全圆角 + 极轻阴影 */
.top-nav__capsule {
  max-width: var(--page-max-width);
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: 0 var(--space-5);
  height: 48px;
  background: var(--glass-bg);
  backdrop-filter: blur(var(--nav-blur)) saturate(150%);
  -webkit-backdrop-filter: blur(var(--nav-blur)) saturate(150%);
  border: var(--border-hairline-width) solid var(--glass-border);
  border-radius: var(--radius-full);
  box-shadow: var(--shadow-sm);
  pointer-events: auto;
  transition: box-shadow var(--duration-base) var(--ease-out);
}

.top-nav.is-scrolled .top-nav__capsule {
  box-shadow: var(--shadow-md);
}

/* ---- 品牌 ---- */
.top-nav__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  text-decoration: none;
  user-select: none;
}

.top-nav__logo {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: block;
  object-fit: cover;
  box-shadow: var(--shadow-xs);
  flex-shrink: 0;
}

.top-nav__brand-text {
  font-size: var(--font-content);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  letter-spacing: 0.5px;
  white-space: nowrap;
}

/* ---- 一级导航 ---- */
.top-nav__links {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.top-nav__links::-webkit-scrollbar {
  display: none;
}

.top-nav__link {
  padding: 6px 16px;
  border-radius: var(--radius-full);
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  text-decoration: none;
  white-space: nowrap;
  transition:
    color var(--transition-fast),
    background var(--transition-fast);
}

.top-nav__link:hover {
  color: var(--color-text-primary);
  background: var(--color-primary-bg);
}

.top-nav__link.is-active {
  background: var(--color-primary);
  color: var(--color-text-inverse);
  font-weight: var(--font-weight-semibold);
  box-shadow: var(--shadow-xs);
}

.top-nav__link.is-active:hover {
  background: var(--color-primary-dark);
  color: var(--color-text-inverse);
}

.top-nav__link:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

/* ---- 右侧 ---- */
.top-nav__user {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-shrink: 0;
}

.icon-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-text-secondary);
  text-decoration: none;
  cursor: pointer;
  transition:
    background var(--transition-fast),
    color var(--transition-fast);
}

.icon-btn:hover:not(:disabled) {
  background: var(--color-primary-bg);
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

/* ---- 头像与个人菜单 ---- */
.avatar-wrap {
  position: relative;
}

.avatar {
  width: 34px;
  height: 34px;
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

@media (hover: hover) {
  .avatar:hover {
    transform: scale(1.05);
  }
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
  font-size: var(--font-content);
  font-weight: var(--font-weight-semibold);
}

/* 未登录占位：默认头像（中性用户图标，不放假字母/假名字） */
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
  top: calc(100% + 10px);
  right: 0;
  min-width: 168px;
  padding: var(--space-2);
  background: var(--glass-bg-card);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  border: var(--border-hairline-width) solid var(--color-border-light);
  border-radius: var(--radius-lg);
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
  font-family: inherit;
  font-size: var(--font-secondary);
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

@media (max-width: 900px) {
  .top-nav__brand-text {
    display: none;
  }

  .top-nav__link {
    padding: 6px 12px;
  }
}
</style>
