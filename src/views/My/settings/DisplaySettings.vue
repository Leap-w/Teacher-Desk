<script setup lang="ts">
import { computed } from 'vue'
import { Monitor, Moon, Sun } from 'lucide-vue-next'

import { AppSegmented, AppSelect } from '@/components/ui'
import { useTheme } from '@/composables/useTheme'
import { HOME_VIEW_OPTIONS } from '@/types/appSettings'
import { useAppSettingsStore } from '@/stores/appSettings'
import SettingsPage from '../components/SettingsPage.vue'
import SettingsSection from '../components/SettingsSection.vue'
import SettingsField from '../components/SettingsField.vue'

/**
 * 显示设置（v3.0.4-rc · 二级页）。
 *
 * 管两件与「看起来怎么样、打开落在哪」有关的事：**深色模式**与**默认首页**。
 * 版式对齐 Changdu-Memory 的设置页（大标题 + 分组卡 + 一行一控件）。
 */
const { theme, effective, setTheme } = useTheme()
const appSettings = useAppSettingsStore()

const THEME_OPTIONS = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
] as const

const themeIcon = computed(() =>
  theme.value === 'dark' ? Moon : theme.value === 'light' ? Sun : Monitor,
)

const themeHint = computed(() =>
  theme.value === 'system'
    ? `跟随系统：系统切换深浅时应用实时跟随（当前${effective.value === 'dark' ? '深色' : '浅色'}）`
    : `已固定为${theme.value === 'dark' ? '深色' : '浅色'}主题，无需刷新`,
)

function setDefaultHomeView(value: string): void {
  appSettings.update({ defaultHomeView: value })
}
</script>

<template>
  <SettingsPage title="显示设置" subtitle="外观，以及打开应用时落在哪一页">
    <SettingsSection title="外观">
      <SettingsField label="深色模式">
        <template #control>
          <!-- 不用 v-model：显式走 setTheme（落盘 + 应用一次完成） -->
          <AppSegmented
            :model-value="theme"
            :options="[...THEME_OPTIONS]"
            label="深色模式偏好"
            @update:model-value="setTheme($event)"
          />
        </template>
        <p class="hint">
          <component :is="themeIcon" :size="14" :stroke-width="2" aria-hidden="true" />
          <span>{{ themeHint }}</span>
        </p>
      </SettingsField>
    </SettingsSection>

    <SettingsSection title="默认首页">
      <SettingsField
        label="打开应用时进入"
        hint="选好之后，下次打开应用直接落在这里；选「首页」即回到默认行为。"
      >
        <template #control>
          <AppSelect
            :model-value="appSettings.settings.defaultHomeView"
            :options="HOME_VIEW_OPTIONS"
            @update:model-value="setDefaultHomeView(String($event))"
          />
        </template>
      </SettingsField>
    </SettingsSection>
  </SettingsPage>
</template>

<style scoped>
.hint {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: var(--space-2) 0 0;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.hint svg {
  flex-shrink: 0;
}
</style>
