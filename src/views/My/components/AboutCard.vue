<script setup lang="ts">
import { ref } from 'vue'

import VersionModal from './VersionModal.vue'

/**
 * AboutCard — 关于（v3.0.3-rc · 对齐 Changdu-Memory `Profile.vue` 的 `profile__about-card`）。
 *
 * 位置：「我的」页最底部。**与昌都记忆同一排布**：品牌 Logo → 名称 + 一句话说明
 * → 底部一行（左：当前版本；右：检查更新）。
 * 版本号 = `import.meta.env.APP_VERSION`（vite define，package.json 单一来源，禁止硬编码）。
 *
 * **v3.3.0 曾删掉「检查更新」按钮**：那一版它只弹一句「已是最新版本」，既没有版本比对
 * 也没有网络请求，结论是凭空断言的。**v3.7.7 按需求方要求恢复这个入口，但换了语义**——
 * 它不再假装做过远端检查，而是一个正式的「版本信息窗口」：当前版本 + 本地维护的本次
 * 更新内容；不调 GitHub API、不请求远程版本、不接 Releases、不下载更新。
 * 右下角的 GitHub 仓库链接随之撤下，弹窗里的更新日志见 `config/releaseNotes.ts`。
 */
const appVersion = import.meta.env.APP_VERSION
const versionOpen = ref(false)
</script>

<template>
  <section class="about-card">
    <img class="about-card__logo" src="/icons/icon-192.png" alt="TeacherDesk" />
    <div class="about-card__info">
      <h3 class="about-card__name">TeacherDesk</h3>
      <p class="about-card__desc">班主任工作台 · 高中班级管理工作台</p>
    </div>

    <div class="about-card__foot">
      <span class="about-card__version">当前版本 {{ appVersion }}</span>
      <button
        type="button"
        class="about-update"
        aria-haspopup="dialog"
        :aria-expanded="versionOpen ? 'true' : 'false'"
        @click="versionOpen = true"
      >
        检查更新
      </button>
    </div>

    <VersionModal v-model="versionOpen" />
  </section>
</template>

<style scoped>
.about-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: var(--spacing-lg);
  border: var(--border-hairline-width) solid var(--color-border-light);
  border-radius: var(--radius-card);
  background: var(--glass-bg-card);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: var(--shadow-card);
  text-align: center;
}

.about-card__logo {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-md);
  display: block;
  object-fit: cover;
  box-shadow: var(--shadow-sm);
}

.about-card__info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.about-card__name {
  margin: 0;
  font-size: var(--font-content);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.about-card__desc {
  margin: 0;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.about-card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  width: 100%;
  padding-top: 14px;
  border-top: var(--border-hairline-width) solid var(--color-border-light);
  font-size: var(--font-caption);
}

.about-card__version {
  color: var(--color-text-tertiary);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
}

.about-update {
  border: none;
  background: transparent;
  padding: 0;
  font-family: inherit;
  font-size: var(--font-caption);
  font-weight: var(--font-weight-semibold);
  color: var(--color-primary-strong);
  cursor: pointer;
  transition: opacity var(--transition-fast);
}

.about-update:hover {
  opacity: 0.8;
}

.about-update:focus-visible {
  outline: none;
  border-radius: var(--radius-xs);
  box-shadow: var(--ring-focus);
}
</style>
