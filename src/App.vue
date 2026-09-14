<script setup lang="ts">
import AppFooter from '@/components/layout/AppFooter.vue'
import AppHeader from '@/components/layout/AppHeader.vue'
import { AppToast } from '@/components/ui'

/**
 * App Shell（v3.0.2-rc · 顶部导航版）：
 * 72px 固定毛玻璃工具栏（Logo + 一级导航 + 头像）+ 统一内容容器（960px 居中）+ 底部状态栏。
 * 左侧 Sidebar 按需求方拍板移除——一级导航收回顶部，模块内二级导航保留在 ModuleLayout。
 * 页面切换：进入 Fade + 轻微上滑，退出更轻。
 */
</script>

<template>
  <div class="app-shell">
    <AppHeader />

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

/* 统一容器：960px 居中 + 留白；顶部间距统一（导航 72 + 32），页面无需各自调 */
.app-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  width: 100%;
}

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
