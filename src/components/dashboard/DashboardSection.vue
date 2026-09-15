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

/*
  v3.3.1 §五：首页 Hero 以下整体放大一级（卡片标题 +2px、数字 +4px、副标题 +1px）。
  用 `calc(令牌 + Npx)` 而不是直接写死新数字——档位仍然只有一套（theme.css），
  这里的 `+2px` 就是「比 22px 那一档大一级」，将来调令牌时整条层级一起动。
  Hero（DashboardHero）刻意不在此列：需求明确「不改变 Hero 标题大小」。
*/
.dash-section__title {
  font-size: calc(var(--text-xl) + 2px);
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.01em;
  color: var(--color-text-primary);
}

/* 副标题 +1px */
.dash-section__subtitle {
  margin-top: 2px;
  font-size: calc(var(--font-secondary) + 1px);
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
