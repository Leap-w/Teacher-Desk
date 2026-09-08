<script setup lang="ts">
import { AppCard, EmptyState } from '@/components/ui'

interface Props {
  title: string
  description?: string
}

withDefaults(defineProps<Props>(), {
  description: '',
})
</script>

<template>
  <div class="page-placeholder">
    <AppCard>
      <header>
        <h1 class="page-title">{{ title }}</h1>
        <p v-if="description" class="page-description">{{ description }}</p>
      </header>
      <EmptyState
        icon="🚧"
        title="功能建设中"
        description="该模块为 Phase 0 占位页，业务功能将在后续阶段落地。"
      />
    </AppCard>
  </div>
</template>

<style scoped>
.page-placeholder {
  max-width: 960px;
}

.page-title {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.2px;
}

.page-description {
  margin-top: 6px;
  font-size: 13px;
  color: var(--color-text-secondary);
}
</style>
