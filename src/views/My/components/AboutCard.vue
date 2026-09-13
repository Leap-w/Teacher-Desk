<script setup lang="ts">
import { Github } from 'lucide-vue-next'

/**
 * AboutCard — 关于（V2.1.0-beta · Phase UI-5C）：
 * Control Center 第五层。版本号 = __APP_VERSION__（vite define，package.json
 * 单一来源，禁止硬编码）；CDL 设计语言 + GitHub + 检查更新（逻辑保留在页面）。
 */
const emit = defineEmits<{
  'check-update': []
}>()

const CDL_TAG = 'CDL v6.0'
const appVersion = import.meta.env.APP_VERSION
</script>

<template>
  <section class="about-card">
    <img class="about-card__logo" src="/icons/icon-192.png" alt="TeacherDesk" />
    <div class="about-card__info">
      <h3 class="about-card__name">TeacherDesk</h3>
      <p class="about-card__desc">班主任工作台 · 高中班级管理工作台</p>
    </div>

    <div class="about-meta">
      <span class="meta-chip">{{ appVersion }}</span>
      <span class="meta-chip">{{ CDL_TAG }}</span>
      <span class="meta-chip">V2.1 Beta</span>
    </div>

    <div class="about-card__foot">
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
    </div>
  </section>
</template>

<style scoped>
.about-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-5);
  border: var(--border-hairline-width) solid var(--color-border-light);
  border-radius: var(--radius-xl);
  background: var(--bg-card);
  box-shadow: var(--shadow-xs);
  text-align: center;
  transition:
    transform var(--duration-base) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out);
}

.about-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-sm);
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
}

.about-card__name {
  margin: 0;
  font-size: var(--font-card-title);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.about-card__desc {
  margin: 2px 0 0;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.about-meta {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
  justify-content: center;
}

.meta-chip {
  padding: 3px 10px;
  border-radius: var(--radius-full);
  background: var(--color-fill-disabled);
  font-size: var(--font-caption);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}

.about-card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding-top: var(--space-3);
  border-top: var(--border-hairline-width) solid var(--color-border-light);
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
