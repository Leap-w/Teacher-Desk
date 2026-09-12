<script setup lang="ts">
/**
 * AppSection — 统一内容区块组件（直接复用自 Changdu Memory v5.1.4）
 *
 * 提供一致的标题 + 右侧辅助文字/操作 + 内容区域布局。
 * 支持可选的底部细线分隔。
 *
 * 用法：
 *   <AppSection title="今日状态" action-label="查看全部" @action="goAll">
 *     <SomeContent />
 *   </AppSection>
 */
withDefaults(
  defineProps<{
    /** 区块标题 */
    title?: string
    /** 副标题（显示在标题下方） */
    subtitle?: string
    /** 右侧操作文字（点击触发 action 事件） */
    actionLabel?: string
    /** 是否显示底部分隔线 */
    bordered?: boolean
    /** 移除内边距 */
    noPadding?: boolean
    /** 标题字号：'section' | 'page' */
    titleSize?: 'section' | 'page'
  }>(),
  {
    title: undefined,
    subtitle: undefined,
    actionLabel: undefined,
    bordered: false,
    noPadding: false,
    titleSize: 'section',
  },
)

const emit = defineEmits<{
  action: []
}>()
</script>

<template>
  <section
    class="app-section"
    :class="{
      'app-section--no-pad': noPadding,
      'app-section--bordered': bordered,
    }"
  >
    <div v-if="title || subtitle || actionLabel || $slots.header" class="app-section__header">
      <div class="app-section__titles">
        <h2
          v-if="title"
          class="app-section__title"
          :class="{
            'app-section__title--page': titleSize === 'page',
          }"
        >
          {{ title }}
        </h2>
        <span v-if="subtitle" class="app-section__subtitle">{{ subtitle }}</span>
      </div>
      <div v-if="actionLabel || $slots.header" class="app-section__header-slot">
        <slot name="header">
          <button v-if="actionLabel" class="app-section__action" @click="emit('action')">
            {{ actionLabel }}
          </button>
        </slot>
      </div>
    </div>

    <div class="app-section__body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.app-section {
  margin-bottom: var(--spacing-xl);
}

.app-section--no-pad {
  margin-bottom: 0;
}

.app-section--bordered {
  padding-bottom: var(--spacing-lg);
  border-bottom: 1px solid var(--color-border-light);
}

.app-section__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: var(--spacing-md);
  gap: var(--spacing-sm);
}

.app-section__titles {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.app-section__title {
  font-size: var(--font-section-title, 20px);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
  margin: 0;
  line-height: var(--leading-tight);
}

.app-section__title--page {
  font-size: var(--font-page-title, 32px);
}

.app-section__subtitle {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.app-section__header-slot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.app-section__action {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--color-primary);
  font-size: var(--font-secondary);
  font-family: inherit;
  font-weight: var(--font-weight-semibold);
  cursor: pointer;
  transition: opacity var(--transition-fast);
  white-space: nowrap;
}

.app-section__action:hover {
  opacity: 0.8;
}

.app-section__body {
  /* slot 内容自行决定布局 */
}
</style>
