<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import AppFooter from '@/components/layout/AppFooter.vue'
import AppHeader from '@/components/layout/AppHeader.vue'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import { AppToast } from '@/components/ui'

/**
 * App Shell（V2.0.1-alpha · Phase UI-2）：
 * 72px 固定毛玻璃工具栏 + 左侧导航（桌面常驻 / 小屏抽屉）+ 统一内容容器 + 底部状态栏。
 * 页面切换：进入 Fade + 轻微上滑（200ms），退出更轻（150ms）。
 */
const route = useRoute()

const sidebarOpen = ref(false)
watch(
  () => route.fullPath,
  () => {
    sidebarOpen.value = false
  },
)
</script>

<template>
  <div class="app-shell">
    <AppHeader :sidebar-open="sidebarOpen" @toggle-sidebar="sidebarOpen = !sidebarOpen" />
    <AppSidebar :open="sidebarOpen" @navigate="sidebarOpen = false" />

    <div class="app-main">
      <main class="app-content">
        <RouterView v-slot="{ Component }">
          <Transition name="page" mode="out-in">
            <component :is="Component" />
          </Transition>
        </RouterView>
      </main>
      <AppFooter />
    </div>

    <AppToast />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

/* 桌面端：内容让开侧栏宽度，在剩余空间居中；小屏侧栏为抽屉、不占位 */
.app-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  width: 100%;
}

@media (min-width: 1024px) {
  .app-main {
    padding-left: var(--sidebar-width);
  }
}

/* 统一容器：1440px 居中 + 40px 留白；顶部间距统一（导航 72 + 32），页面无需各自调 */
.app-content {
  flex: 1;
  width: 100%;
  max-width: var(--page-max-width);
  margin: 0 auto;
  padding: calc(var(--nav-height) + var(--page-top-gap) + env(safe-area-inset-top, 0px))
    var(--page-pad-x) 0;
}

/* UI-2 页面切换：进入 Fade + 轻微上滑；退出更轻 */
.page-enter-active {
  transition:
    opacity var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}

.page-leave-active {
  transition:
    opacity var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.page-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.page-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
