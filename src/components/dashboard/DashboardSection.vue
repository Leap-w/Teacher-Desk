<script setup lang="ts">
/**
 * DashboardSection — Dashboard 通用分区（V2.0.2-alpha · Phase UI-3 沉淀）：
 * 标题 + 副标题（可选）+ 右侧动作链接（可选）+ 默认插槽。
 * 学生档案 / 请假 / 值日等模块页可直接复用；标题层级走 UI-1 语义令牌。
 */
defineProps<{
  title: string
  subtitle?: string
  /** 右侧动作文案；提供 to 则渲染为 RouterLink */
  actionLabel?: string
  actionTo?: string
}>()
</script>

<template>
  <section class="dash-section">
    <header class="dash-section__head">
      <div class="dash-section__heading">
        <h2 class="dash-section__title">{{ title }}</h2>
        <p v-if="subtitle" class="dash-section__subtitle">{{ subtitle }}</p>
      </div>
      <RouterLink v-if="actionLabel && actionTo" :to="actionTo" class="dash-section__action">
        {{ actionLabel }}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </RouterLink>
    </header>
    <div class="dash-section__body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.dash-section {
  margin-bottom: var(--section-gap);
}

.dash-section__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--spacing-md);
}

.dash-section__title {
  font-size: var(--text-xl);
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.01em;
  color: var(--color-text-primary);
}

.dash-section__subtitle {
  margin-top: 2px;
  font-size: var(--font-secondary);
  color: var(--color-text-tertiary);
}

.dash-section__action {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  transition:
    background var(--transition-fast),
    color var(--transition-fast);
}

.dash-section__action svg {
  width: 14px;
  height: 14px;
}

.dash-section__action:hover {
  background: var(--bg-hover);
  color: var(--color-primary-dark);
}

.dash-section__action:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}
</style>
