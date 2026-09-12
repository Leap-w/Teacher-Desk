<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Menu, RefreshCw, Search, X } from 'lucide-vue-next'

import { useCloudSync } from '@/composables/useCloudSync'
import { useToast } from '@/composables/useToast'
import { useUserStore } from '@/stores/user'

/**
 * 顶部工具栏（V2.0.1-alpha · Phase UI-2 App Shell）：
 * 72px 全宽毛玻璃（接近 macOS 工具栏）——左：Logo + TeacherDesk + 班主任工作台副标题；
 * 中：留白（预留搜索）；右：搜索（预留）/ 云同步 / 头像。
 * 滚动后背景透明度略增（.is-scrolled）。小屏出现汉堡按钮唤起侧栏抽屉。
 */
const router = useRouter()
const toast = useToast()
const userStore = useUserStore()
const { state, enabled, syncing, syncWithFeedback } = useCloudSync()

defineProps<{
  /** 小屏抽屉侧栏是否展开（仅移动端生效） */
  sidebarOpen: boolean
}>()

const emit = defineEmits<{
  'toggle-sidebar': []
}>()

/** 滚动后加深毛玻璃背景 */
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
const showSync = computed(() => enabled)

function onSearch(): void {
  // UI-2 预留位：全局搜索未实现，先给轻提示
  toast.info('全局搜索还在路上，先埋头干活。')
}

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
  <header class="app-header" :class="{ 'is-scrolled': scrolled }">
    <div class="app-header__inner">
      <div class="app-header__left">
        <button
          type="button"
          class="icon-btn app-header__menu-btn"
          :aria-label="sidebarOpen ? '关闭导航菜单' : '打开导航菜单'"
          @click="emit('toggle-sidebar')"
        >
          <X v-if="sidebarOpen" :size="20" :stroke-width="2" />
          <Menu v-else :size="20" :stroke-width="2" />
        </button>

        <RouterLink to="/" class="brand" aria-label="回到首页">
          <img class="brand__logo" src="/icons/icon-192.png" alt="" />
          <span class="brand__text">
            <span class="brand__name">TeacherDesk</span>
            <span class="brand__subtitle">班主任工作台</span>
          </span>
        </RouterLink>
      </div>

      <!-- 中间留白：为全局搜索预留 -->
      <div class="app-header__spacer" aria-hidden="true" />

      <div class="app-header__right">
        <button type="button" class="icon-btn" aria-label="搜索（即将上线）" @click="onSearch">
          <Search :size="18" :stroke-width="2" />
        </button>

        <button
          v-if="showSync"
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

        <RouterLink to="/my" class="avatar" aria-label="进入我的">
          <img v-if="profile.avatar" :src="profile.avatar" alt="" class="avatar__img" />
          <span v-else class="avatar__fallback" aria-hidden="true">{{ initial }}</span>
        </RouterLink>
      </div>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: var(--z-nav);
  /* UI-2：全宽毛玻璃工具栏，接近 macOS——半透明 + blur + 极弱底部分隔线 */
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
  justify-content: space-between;
  gap: var(--spacing-md);
}

.app-header__left {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.app-header__spacer {
  flex: 1;
}

.app-header__right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}

/* ---- 图标按钮（搜索 / 同步 / 汉堡）：柔和高亮，无按钮感 ---- */
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

.app-header__menu-btn {
  display: none;
}

/* ---- 品牌：36px Logo + 双行文字 ---- */
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

.brand__text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}

.brand__name {
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  letter-spacing: 0.2px;
  white-space: nowrap;
}

.brand__subtitle {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  white-space: nowrap;
}

/* ---- 头像 ---- */
.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
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
  color: #ffffff;
  font-size: 15px;
  font-weight: var(--font-weight-semibold);
}

@media (max-width: 1023px) {
  .app-header__menu-btn {
    display: flex;
  }
}

@media (max-width: 640px) {
  .brand__subtitle {
    display: none;
  }
}
</style>
