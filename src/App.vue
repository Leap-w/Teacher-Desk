<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AppHeader from '@/components/layout/AppHeader.vue'
import LoginModal from '@/components/layout/LoginModal.vue'
import { AppToast } from '@/components/ui'
import { useAppSettingsStore } from '@/stores/appSettings'

/**
 * App Shell（v3.0.4-rc · 全宽版）：
 * 固定玻璃胶囊工具栏（品牌 + 一级导航 + 同步 / 头像）+ 统一内容容器（**1440px 居中**，
 * 左右 32px 留白，Hero 基本铺满屏幕）。
 *
 * **登录弹窗挂在壳层、全局唯一一份**（v3.0.3-rc 修复）：此前 Header 与工具箱页各挂了一份，
 * 两处都监听同一个 `useLoginModal`，同屏时会渲染出两个叠在一起的弹窗；
 * 头像点击也因此出现过「点了没反应」的观感。收敛到壳层后，
 * 任何入口（顶部头像 / 「我的」空状态 / 数据与同步页）唤起的是同一个实例。
 *
 * **底部状态栏已删除**（v3.0.4-rc）：那条「TeacherDesk v3.0.3-rc · GitHub · 检查更新 /
 * CDL v6.0 · UI-5B · 未登录」既重复了「关于」里的版本与 GitHub，又把本机状态摆在每一页底部，
 * 现在这些信息只在「我的 → 关于」里出现一次。
 *
 * **默认首页**（显示设置里可选）：只在**应用启动**且落在首页时按设置改道——
 * 之后教师自己点「首页」不会被弹走（App 只挂载一次，这里也就只判断一次）。
 *
 * 页面切换：进入 Fade + 轻微上滑，退出更轻。
 */
const route = useRoute()
const router = useRouter()
const appSettings = useAppSettingsStore()

onMounted(() => {
  const target = appSettings.settings.defaultHomeView
  if (route.path === '/' && target && target !== '/') {
    void router.replace(target)
  }
})
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

    <LoginModal />
    <AppToast />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

/* 统一容器：1440px 居中 + 32px 留白；顶部间距统一（胶囊 72 + 32），页面无需各自调 */
.app-content {
  flex: 1;
  width: 100%;
  max-width: var(--page-max-width);
  margin: 0 auto;
  padding: calc(var(--nav-height) + var(--page-top-gap) + env(safe-area-inset-top, 0px))
    var(--page-pad-x) var(--section-gap);
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
