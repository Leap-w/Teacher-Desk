<script setup lang="ts">
import { computed } from 'vue'
import {
  Armchair,
  CalendarClock,
  ClipboardList,
  Cloud,
  CloudOff,
  Database,
  Luggage,
  NotebookPen,
  Paintbrush,
  type LucideIcon,
} from 'lucide-vue-next'

import SettingsCell from './SettingsCell.vue'
import SettingsSection from './SettingsSection.vue'
import { useCloudSync } from '@/composables/useCloudSync'

/**
 * ControlCenter — 控制中心（V2.1.0-beta · Phase UI-5C）：
 * 第三层（核心）：数据与同步（真实同步状态）→ 工具箱独立入口卡 → 偏好设置
 * （各模块设置第二入口；原「功能设置」Tab 入口保留，双入口不迁移）。
 */
const emit = defineEmits<{
  /** 打开功能设置 Tab 的对应分组 */
  'open-settings': [group: 'work' | 'seats' | 'leave' | 'duty' | 'weekend' | 'time']
  'open-tools': []
}>()

const { enabled, statusView } = useCloudSync()

const syncBadgeVariant = computed(() => {
  const text = statusView.value.text
  if (text.includes('已同步')) return 'success'
  if (text.includes('失败') || text.includes('冲突')) return 'danger'
  return 'neutral'
})

interface PrefCell {
  key: string
  icon: LucideIcon
  title: string
  subtitle: string
  group: 'work' | 'seats' | 'leave' | 'duty' | 'weekend' | 'time'
}

const PREF_CELLS: PrefCell[] = [
  {
    key: 'work',
    icon: ClipboardList,
    title: '课程表设置',
    subtitle: '课程时间 · 默认视图',
    group: 'work',
  },
  {
    key: 'seats',
    icon: Armchair,
    title: '座位管理设置',
    subtitle: '教室布局 · 导出视角',
    group: 'seats',
  },
  {
    key: 'leave',
    icon: NotebookPen,
    title: '请假管理设置',
    subtitle: '默认返校时间 · 显示方式',
    group: 'leave',
  },
  {
    key: 'duty',
    icon: Paintbrush,
    title: '值日管理设置',
    subtitle: '轮换设置 · 默认分组',
    group: 'duty',
  },
  {
    key: 'weekend',
    icon: Luggage,
    title: '周末管理设置',
    subtitle: '默认返校提醒',
    group: 'weekend',
  },
  {
    key: 'time',
    icon: CalendarClock,
    title: '时间设置',
    subtitle: '首页倒计时 · Hero 背景',
    group: 'time',
  },
]
</script>

<template>
  <div class="control-center">
    <!-- 数据与同步（真实状态，操作在工具箱页） -->
    <SettingsSection title="数据与同步">
      <SettingsCell
        :icon="enabled ? Cloud : CloudOff"
        :title="enabled ? '云同步' : '本地模式'"
        subtitle="同步状态 · 登录 · 手动同步"
        :badge-text="statusView.text"
        :badge-variant="syncBadgeVariant"
        @click="emit('open-tools')"
      />
      <SettingsCell
        :icon="Database"
        icon-tone="neutral"
        title="数据管理"
        subtitle="导出 · 导入 · 重置（在工具箱中）"
        @click="emit('open-tools')"
      />
    </SettingsSection>

    <!-- 工具箱：独立入口卡（Hover 抬升 + 箭头） -->
    <button type="button" class="toolbox-card" @click="emit('open-tools')">
      <span class="toolbox-icon" aria-hidden="true"><Luggage :size="22" :stroke-width="2" /></span>
      <span class="toolbox-main">
        <span class="toolbox-title">工具箱</span>
        <span class="toolbox-sub">备份恢复 · 数据清空 · 合并 · 同步操作</span>
      </span>
      <span class="toolbox-arrow" aria-hidden="true">→</span>
    </button>

    <!-- 偏好设置（第二入口；原功能设置 Tab 保留） -->
    <SettingsSection title="偏好设置">
      <SettingsCell
        v-for="cell in PREF_CELLS"
        :key="cell.key"
        :icon="cell.icon"
        :title="cell.title"
        :subtitle="cell.subtitle"
        @click="emit('open-settings', cell.group)"
      />
    </SettingsSection>
  </div>
</template>

<style scoped>
.control-center {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* 工具箱独立入口卡 */
.toolbox-card {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border: var(--border-hairline-width) solid var(--color-border-light);
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, var(--color-primary-bg) 0%, var(--bg-card) 70%);
  box-shadow: var(--shadow-xs);
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  transition:
    transform var(--duration-base) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out),
    border-color var(--transition-fast);
}

.toolbox-card:hover {
  transform: translateY(-2px);
  border-color: var(--color-border-medium);
  box-shadow: var(--shadow-sm);
}

.toolbox-card:active {
  transform: scale(0.99);
}

.toolbox-card:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.toolbox-icon {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  background: var(--color-primary-bg);
  color: var(--color-primary-strong);
}

.toolbox-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.toolbox-title {
  font-size: var(--font-content);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.toolbox-sub {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.toolbox-arrow {
  flex-shrink: 0;
  color: var(--color-primary-strong);
  font-size: var(--text-lg);
  transition: transform var(--duration-base) var(--ease-out);
}

.toolbox-card:hover .toolbox-arrow {
  transform: translateX(3px);
}
</style>
