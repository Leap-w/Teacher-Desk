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
  padding: 28px clamp(20px, 4vw, 44px) 56px;
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
