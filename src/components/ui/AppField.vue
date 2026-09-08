<script setup lang="ts">
interface Props {
  /** 字段标签；传入时控件会被 <label> 包裹，点击标签即可聚焦控件 */
  label?: string
  required?: boolean
  /** 错误文案，非空时以危险色展示并提示辅助技术 */
  error?: string
  /** 辅助说明文案（无错误时展示） */
  hint?: string
}

withDefaults(defineProps<Props>(), {
  label: '',
  required: false,
  error: '',
  hint: '',
})
</script>

<template>
  <div class="app-field">
    <component :is="label ? 'label' : 'div'" class="field-shell">
      <span v-if="label" class="field-label">
        {{ label }}
        <span v-if="required" class="field-required" aria-hidden="true">*</span>
      </span>
      <slot />
    </component>
    <p v-if="error" class="field-message is-error" role="alert">{{ error }}</p>
    <p v-else-if="hint" class="field-message is-hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.app-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.field-shell {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  cursor: default;
}

.field-label {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
}

.field-required {
  margin-left: 2px;
  color: var(--color-danger);
}

.field-message {
  font-size: var(--text-xs);
  line-height: 1.5;
}

.is-error {
  color: var(--color-danger-strong);
}

.is-hint {
  color: var(--color-text-secondary);
}
</style>
