<script setup lang="ts">
import AppHeader from '@/components/layout/AppHeader.vue'
import { AppToast } from '@/components/ui'
</script>

<template>
  <div class="app-shell">
    <AppHeader />
    <main class="app-content">
      <RouterView v-slot="{ Component }">
        <Transition name="page" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>
    <AppToast />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

/* V1.3.0：内容流布局——1440px 居中 + 40px 左右留白；
   顶部给固定胶囊导航（64px）让位 */
.app-content {
  flex: 1;
  width: 100%;
  max-width: var(--page-max-width);
  margin: 0 auto;
  padding: calc(var(--nav-height) + 28px + env(safe-area-inset-top, 0px)) var(--page-pad-x)
    calc(64px + env(safe-area-inset-bottom, 0px));
}

.page-enter-active,
.page-leave-active {
  /* CDL 页面切换：spring 曲线（唯一动效体系） */
  transition:
    opacity 0.25s ease,
    transform 0.3s var(--ease-spring);
}

.page-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.page-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
