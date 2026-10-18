<script setup lang="ts">
import WidgetBridgeCard from './components/WidgetBridgeCard.vue'
import SettingsPage from '../components/SettingsPage.vue'

/**
 * 桌面小组件设置（v3.7.6）。
 *
 * 原先放在课程表页底部的 macOS 小组件卡片整体移到这里：连接目录、状态展示、
 * 同步与刷新、下载快照、复制路径都还是同一套组件与同一套桥接逻辑，没有另做一份。
 * 课程表页因此只保留课表本身；需要配置小组件时从「我的 → 设置 → 教学设置」进入。
 */
</script>

<template>
  <SettingsPage title="桌面小组件" subtitle="把课程表写成 macOS 桌面小组件能读的只读快照">
    <p class="widget-intro">
      这里管理课程表与桌面小组件之间的快照：首次连接只需做一次，之后课表改动会自动同步。
      课程表本身仍在「工作 → 课程表」里编辑。
    </p>
    <WidgetBridgeCard />
  </SettingsPage>
</template>

<style scoped>
.widget-intro {
  padding: 0 4px;
  font-size: var(--font-secondary);
  line-height: 1.7;
  color: var(--color-text-secondary);
}
</style>
