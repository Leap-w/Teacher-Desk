<script setup lang="ts">
import { useRouter } from 'vue-router'

import { AppButton } from '@/components/ui'

/**
 * 「设置」入口按钮（V1.1.6 双入口机制的功能页一侧）：
 * 各功能页右上角的 ⚙，点击统一跳到 `/my/settings?module=<id>`——**设置只有一套**。
 *
 * v3.0.4-rc：设置拆成二级页后，`/my/settings` 按 `?module=` 直接落到对应的二级设置页
 * （对照表在 `router/routes.ts` 的 `SETTINGS_MODULE_GROUP`），因此各功能页的 ⚙ 仍然直达。
 */
interface Props {
  /** 目标模块 id（work / seats / leave / duty / weekend / time） */
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
