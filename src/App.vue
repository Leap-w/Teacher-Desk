<script setup lang="ts">
import AppHeader from '@/components/layout/AppHeader.vue'
import Sidebar from '@/components/layout/Sidebar.vue'
import { AppToast } from '@/components/ui'
</script>

<template>
  <div class="app-shell">
    <Sidebar />
    <div class="app-main">
      <AppHeader />
      <main class="app-content">
        <RouterView v-slot="{ Component }">
          <Transition name="page" mode="out-in">
            <component :is="Component" />
          </Transition>
        </RouterView>
      </main>
    </div>
    <AppToast />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  height: 100%;
}

.app-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.app-content {
  flex: 1;
  overflow-y: auto;
  /* 全应用唯一的滚动容器：左右 / 底部安全区都算进内边距，横屏时内容不贴刘海、滚到底不被 home 指示条压住 */
  padding: 28px calc(clamp(20px, 4vw, 44px) + env(safe-area-inset-right, 0px))
    calc(56px + env(safe-area-inset-bottom, 0px))
    calc(clamp(20px, 4vw, 44px) + env(safe-area-inset-left, 0px));
}

.page-enter-active,
.page-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.page-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.page-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
