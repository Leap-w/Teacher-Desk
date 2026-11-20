<script setup lang="ts">
import type { SeatView } from '../utils/seatView'

defineProps<{ modelValue: SeatView }>()
const emit = defineEmits<{ 'update:modelValue': [value: SeatView] }>()

const options: Array<{ value: SeatView; label: string }> = [
  { value: 'teacher', label: '教师视角' },
  { value: 'student', label: '学生视角' },
]
</script>

<template>
  <div class="view-toggle" role="group" aria-label="座位图视角">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      :class="{ active: modelValue === option.value }"
      :aria-pressed="modelValue === option.value"
      :data-view-option="option.value"
      @click="emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.view-toggle {
  display: flex;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
}

.view-toggle button {
  min-width: 72px;
  min-height: 44px;
  padding: 0 var(--space-3);
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--text-sub);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

.view-toggle button.active {
  background: var(--primary);
  color: var(--text-inverse);
}
</style>
