<script setup lang="ts">
import { computed } from 'vue'
import { Github } from 'lucide-vue-next'

import { useCloudSync } from '@/composables/useCloudSync'

/**
 * 底部状态栏（V2.0.1-alpha · Phase UI-2）：
 * 左：TeacherDesk · 当前版本；右：GitHub（预留）/ 云同步状态 / 构建信息。
 * 轻量、不抢视觉——hairline 上边框 + 辅助文字色。
 * 版本号来自 vite define（import.meta.env.APP_VERSION ← package.json），单一来源。
 */
const APP_VERSION = import.meta.env.APP_VERSION
const BUILD_TAG = 'CDL v6.0 · UI-5B'

const { enabled, statusView } = useCloudSync()

const syncText = computed(() => (enabled.value ? statusView.value.text : '本地模式'))
</script>

<template>
  <footer class="app-footer">
    <div class="app-footer__inner">
      <div class="app-footer__left">
        <span class="app-footer__brand">TeacherDesk</span>
        <span class="app-footer__dot" aria-hidden="true">·</span>
        <span>{{ APP_VERSION }}</span>
      </div>

      <div class="app-footer__right">
        <span class="app-footer__build">{{ BUILD_TAG }}</span>
        <span class="app-footer__dot" aria-hidden="true">·</span>
        <span class="app-footer__sync">{{ syncText }}</span>
        <a
          class="app-footer__link"
          href="https://github.com/Leap-w/Teacher-Desk"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub 仓库"
        >
          <Github :size="14" :stroke-width="2" />
        </a>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.app-footer {
  margin-top: var(--spacing-xl);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  border-top: var(--border-hairline-width) solid var(--color-border-light);
}

.app-footer__inner {
  max-width: var(--page-max-width);
  margin: 0 auto;
  padding: var(--space-4) var(--page-pad-x) var(--space-5);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  user-select: none;
}

.app-footer__left,
.app-footer__right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.app-footer__brand {
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
}

.app-footer__dot {
  opacity: 0.6;
}

.app-footer__build {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.app-footer__sync {
  white-space: nowrap;
}

.app-footer__link {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-xs);
  color: var(--color-text-tertiary);
  transition:
    color var(--transition-fast),
    background var(--transition-fast);
}

.app-footer__link:hover {
  color: var(--color-text-primary);
  background: var(--bg-hover);
}

.app-footer__link:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

@media (max-width: 640px) {
  .app-footer__build {
    display: none;
  }
}
</style>
