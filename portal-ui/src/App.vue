<script setup lang="ts">
import { computed, ref } from 'vue'
import BottomNav from './components/BottomNav.vue'
import type { TabId } from './components/nav'
import HomeView from './views/HomeView.vue'
import ScheduleView from './views/ScheduleView.vue'
import StudentsView from './views/StudentsView.vue'
import SeatsView from './views/SeatsView.vue'
import PhotosView from './views/PhotosView.vue'

/**
 * 合并前这里还有 AuthGate / DataGate 两层壳：独立部署时负责登录与 /api 拉取。
 * 并入 TeacherDesk 后只做导出快照渲染（数据已在生成时内联），两层壳是透明 slot，
 * 去掉后 DOM 与交互完全一致，同时不再打包任何登录 / 网络代码。
 */
const tabs = [
  { id: 'home' as const, component: HomeView },
  { id: 'schedule' as const, component: ScheduleView },
  { id: 'students' as const, component: StudentsView },
  { id: 'seats' as const, component: SeatsView },
  { id: 'photos' as const, component: PhotosView },
]

const active = ref<TabId>('home')
const current = computed(() => tabs.find((tab) => tab.id === active.value)?.component ?? HomeView)

function change(id: TabId) {
  active.value = id
  window.scrollTo({ top: 0, behavior: 'instant' })
}
</script>

<template>
  <KeepAlive>
    <component :is="current" :key="active" @navigate="change" />
  </KeepAlive>
  <BottomNav :active="active" @change="change" />
</template>
