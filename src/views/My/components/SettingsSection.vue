<script setup lang="ts">
/**
 * SettingsSection — Apple Settings 风格分组卡（V2.1.0-beta · Phase UI-5C 沉淀）：
 * 可选标题 + Cell 流（内嵌 SettingsCell）。以后所有设置页复用。
 */
defineProps<{
  title?: string
}>()
</script>

<template>
  <section class="settings-section">
    <h3 v-if="title" class="section-title">{{ title }}</h3>
    <div class="section-card">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.settings-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.section-title {
  margin: 0 0 2px 4px;
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-tertiary);
}

.section-card {
  background: var(--bg-card);
  border: var(--border-hairline-width) solid var(--color-border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  overflow: hidden;
}
</style>
