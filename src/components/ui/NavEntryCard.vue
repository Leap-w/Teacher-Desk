<script setup lang="ts">
/**
 * NavEntryCard — 页内功能导航入口卡（V1.2.1 导航 IA 重构）
 *
 * 侧边栏收敛为全局导航后，二级功能入口由各枢纽页（/class、/work）的卡片承担：
 * 白色卡片 + 24px 大圆角 + Hover 上浮 2px + Press scale(0.98)，CDL spring 节奏。
 * 只负责跳转导航，不含任何业务逻辑。
 */
interface Props {
  icon: string
  title: string
  description: string
}

defineProps<Props>()

const emit = defineEmits<{
  open: []
}>()
</script>

<template>
  <button type="button" class="nav-entry" @click="emit('open')">
    <span class="nav-entry__icon" aria-hidden="true">{{ icon }}</span>
    <span class="nav-entry__main">
      <span class="nav-entry__title">{{ title }}</span>
      <span class="nav-entry__desc">{{ description }}</span>
    </span>
    <span class="nav-entry__chevron" aria-hidden="true">›</span>
  </button>
</template>

<style scoped>
.nav-entry {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--spacing-card);
  padding: var(--spacing-lg);
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  text-align: left;
  cursor: pointer;
  transition:
    transform var(--transition-spring),
    box-shadow var(--transition-spring),
    border-color var(--transition-spring);
}

/* CDL：Hover 上浮 2px，Press scale(0.98) */
@media (hover: hover) {
  .nav-entry:hover {
    transform: translateY(-2px);
    border-color: transparent;
    box-shadow: var(--shadow-hover);
  }
}

.nav-entry:active {
  transform: scale(0.98);
}

.nav-entry:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.nav-entry__icon {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  background: var(--color-primary-bg);
  font-size: 20px;
}

.nav-entry__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-entry__title {
  font-size: var(--font-card-title, 18px);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.nav-entry__desc {
  font-size: var(--text-sm);
  color: var(--color-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-entry__chevron {
  flex-shrink: 0;
  font-size: var(--text-lg);
  line-height: 1;
  color: var(--color-text-tertiary);
  opacity: 0.4;
}
</style>
