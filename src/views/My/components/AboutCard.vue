<script setup lang="ts">
import { Github } from 'lucide-vue-next'

/**
 * AboutCard — 关于（v3.0.3-rc · 对齐 Changdu-Memory `Profile.vue` 的 `profile__about-card`）。
 *
 * 位置：「我的」页最底部。**与昌都记忆同一排布**：品牌 Logo → 名称 + 一句话说明
 * → 底部一行（左：当前版本；右：检查更新），GitHub 入口保留在底部一行内。
 * 版本号 = `import.meta.env.APP_VERSION`（vite define，package.json 单一来源，禁止硬编码）。
 */
const emit = defineEmits<{
  'check-update': []
}>()

const appVersion = import.meta.env.APP_VERSION
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
      <span class="about-card__links">
        <a
          class="about-link"
          href="https://github.com/Leap-w/Teacher-Desk"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Github :size="14" :stroke-width="2" aria-hidden="true" />
          GitHub
        </a>
        <button type="button" class="about-update" @click="emit('check-update')">检查更新</button>
      </span>
    </div>
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

.about-card__links {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
}

.about-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--font-caption);
  color: var(--color-text-secondary);
  text-decoration: none;
  transition: color var(--transition-fast);
}

.about-link:hover {
  color: var(--color-text-primary);
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
</style>
