<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { RefreshCw } from 'lucide-vue-next'

import { routes } from '@/router'
import { useCloudSync } from '@/composables/useCloudSync'
import { useToast } from '@/composables/useToast'
import { useUserStore } from '@/stores/user'

/**
 * 顶部悬浮胶囊导航（V1.3.0，昌都记忆 AppLayout 同款）：
 * Logo + 一级导航（首页｜学生档案｜班级管理｜工作管理｜我的）+ 昵称/头像/同步。
 * 取消后台式侧栏；当前页面用主色胶囊高亮。
 */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const userStore = useUserStore()
const { state, enabled, syncing, syncWithFeedback } = useCloudSync()

/** 一级导航：顶层非 hidden 路由，顺序即路由表顺序 */
const navItems = computed(() =>
  routes
    .filter((r) => !r.redirect && !r.meta?.hidden)
    .map((r) => ({ path: r.path, label: r.meta?.title ?? r.path })),
)

function isActive(path: string): boolean {
  if (path === '/') return route.path === '/'
  return route.path === path || route.path.startsWith(path + '/')
}

const profile = computed(() => userStore.profile)
const initial = computed(() => userStore.initial)
const showSync = computed(() => enabled)

async function onSync(): Promise<void> {
  // 有等教师裁决的冲突（Phase 9C）：去工具箱处理
  if (state.value.conflicts.length > 0) {
    toast.info('有模块本机与云端都有数据，需要确认保留哪一份，去工具箱处理。')
    await router.push('/my/tools')
    return
  }
  if (state.value.checked && state.value.status === 'signedOut') {
    toast.info('还没登录，先到工具箱登录一次。')
    await router.push('/my/tools')
    return
  }
  await syncWithFeedback()
}
</script>

<template>
  <header class="capsule-nav">
    <div class="capsule-nav__bar">
      <RouterLink to="/" class="brand" aria-label="回到首页">
        <img class="brand__logo" src="/icons/icon-192.png" alt="" />
        <span class="brand__name">TeacherDesk</span>
      </RouterLink>

      <nav class="capsule-nav__links" aria-label="主导航">
        <RouterLink
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="capsule-nav__link"
          :class="{ 'is-active': isActive(item.path) }"
          :aria-current="isActive(item.path) ? 'page' : undefined"
        >
          {{ item.label }}
        </RouterLink>
      </nav>

      <div class="capsule-nav__user">
        <span class="capsule-nav__nickname">{{ profile.nickname }}</span>
        <RouterLink to="/my" class="avatar" aria-label="进入我的">
          <img v-if="profile.avatar" :src="profile.avatar" alt="" class="avatar__img" />
          <span v-else class="avatar__fallback" aria-hidden="true">{{ initial }}</span>
        </RouterLink>
        <button
          v-if="showSync"
          type="button"
          class="sync-btn"
          :disabled="syncing"
          :aria-label="syncing ? '同步中' : '同步数据'"
          @click="onSync"
        >
          <RefreshCw class="sync-btn__icon" :class="{ 'is-spinning': syncing }" :size="18" />
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.capsule-nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 200;
  padding: calc(12px + env(safe-area-inset-top, 0px)) 32px 12px;
  pointer-events: none;
}

.capsule-nav__bar {
  max-width: var(--page-max-width);
  margin: 0 auto;
  height: var(--nav-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  padding: 0 12px 0 20px;
  background: var(--glass-bg);
  backdrop-filter: blur(var(--nav-blur));
  -webkit-backdrop-filter: blur(var(--nav-blur));
  border: 1px solid var(--glass-border);
  border-radius: var(--nav-radius);
  box-shadow: var(--shadow-sm);
  pointer-events: auto;
}

/* ---- 品牌标识 ---- */
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  user-select: none;
}

.brand__logo {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  object-fit: cover;
  display: block;
  box-shadow: var(--shadow-xs);
}

.brand__name {
  font-size: var(--font-content);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
  letter-spacing: 0.3px;
  white-space: nowrap;
}

/* ---- 一级导航链接 ---- */
.capsule-nav__links {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.capsule-nav__links::-webkit-scrollbar {
  display: none;
}

.capsule-nav__link {
  padding: 8px 18px;
  border-radius: var(--radius-full);
  color: var(--color-text-secondary);
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
  transition: all var(--transition-fast);
}

.capsule-nav__link:hover:not(.is-active) {
  color: var(--color-text-primary);
  background: var(--color-primary-bg);
}

/* 当前页面：主色胶囊高亮 */
.capsule-nav__link.is-active {
  background: var(--color-primary);
  color: #ffffff;
  font-weight: var(--font-weight-semibold);
  box-shadow: var(--shadow-xs);
}

.capsule-nav__link:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

/* ---- 用户区：昵称 + 头像 + 同步 ---- */
.capsule-nav__user {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.capsule-nav__nickname {
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  white-space: nowrap;
}

.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  /* CDL 渐变头像环 */
  box-shadow:
    0 0 0 2px var(--color-bg-white),
    0 0 0 4px var(--color-primary-bg);
  transition: transform var(--transition-fast);
}

.avatar:hover {
  transform: scale(1.05);
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
  color: #ffffff;
  font-size: 15px;
  font-weight: var(--font-weight-bold);
}

.sync-btn {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: var(--color-primary-bg);
  color: var(--color-primary-dark);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.sync-btn:hover:not(:disabled) {
  background: var(--color-primary-bg-hover);
}

.sync-btn:disabled {
  cursor: default;
}

.sync-btn__icon.is-spinning {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 900px) {
  .capsule-nav__links,
  .capsule-nav__nickname {
    display: none;
  }
}
</style>
