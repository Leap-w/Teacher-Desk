<script setup lang="ts">
import { useRouter } from 'vue-router'

import { AppButton } from '@/components/ui'

/**
 * 「设置」入口按钮（V1.1.6 双入口机制的功能页一侧）：
 * 各功能页右上角的 ⚙，点击统一跳到 `/my/settings?module=<id>`——
 * **设置页面只有一套**（views/My/Settings.vue），这里只是入口。
 * Settings.vue 会按 query 里的 module 滚动定位并高亮对应分组。
 */
interface Props {
  /** 目标模块 id（settings 分组的 id：work / seats / leave / duty / weekend） */
  module: string
}

const props = defineProps<Props>()
const router = useRouter()
</script>

<template>
  <AppButton
    variant="secondary"
    title="设置（进入 我的 → 设置）"
    @click="router.push({ path: '/my/settings', query: { module: props.module } })"
  >
    ⚙ 设置
  </AppButton>
</template>
