<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'
import { useRouter } from 'vue-router'

/**
 * SettingsPage — 二级设置页的统一外壳（v3.0.4-rc）。
 *
 * 「我的 → 设置」的每一项都进入这样一页，版式对齐 Changdu-Memory 的 `page-settings`：
 * 大标题（32px + 底部细线）→ 设置分组卡（`SettingsSection` + `SettingsCell`）。
 * 顶部常驻返回入口：有站内来源就回退，直接开链接的兜底回「我的」。
 */
defineProps<{
  title: string
  subtitle?: string
}>()

const router = useRouter()

function goBack(): void {
  const back = router.options.history.state.back
  if (typeof back === 'string' && back) {
    router.back()
    return
  }
  void router.push('/my')
}
</script>

<template>
  <div class="settings-page">
    <header class="page-head">
      <button type="button" class="back-btn" @click="goBack">
        <ArrowLeft :size="18" :stroke-width="2" aria-hidden="true" />
        返回我的
      </button>
      <h1 class="page-head__title">{{ title }}</h1>
      <p v-if="subtitle" class="page-head__sub">{{ subtitle }}</p>
    </header>

    <div class="settings-page__body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  max-width: var(--page-max-width);
  margin: 0 auto;
}

.page-head {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: 0 4px var(--spacing-lg);
  border-bottom: var(--border-hairline-width) solid var(--color-border);
}

/* 返回入口：与课堂工具页同一套（工具用完 / 看完设置就回得去） */
.back-btn {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: var(--space-2);
  padding: 6px 14px 6px 10px;
  border: var(--border-hairline-width) solid var(--color-border-light);
  border-radius: var(--radius-full);
  background: var(--bg-card);
  font-family: inherit;
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background var(--transition-fast),
    color var(--transition-fast);
}

.back-btn:hover {
  background: var(--bg-hover);
  color: var(--color-text-primary);
}

.back-btn:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.page-head__title {
  font-size: var(--font-page-title);
  font-weight: var(--font-weight-bold);
  line-height: var(--leading-tight);
  letter-spacing: -0.02em;
  color: var(--color-text-primary);
}

.page-head__sub {
  font-size: var(--font-content);
  color: var(--color-text-secondary);
}

/* 设置栈：分组之间统一留白（昌都记忆 Settings 列表间距） */
.settings-page__body {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
  margin-top: var(--spacing-xl);
}
</style>
