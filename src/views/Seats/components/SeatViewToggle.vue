<script setup lang="ts">
import { computed } from 'vue'

/**
 * SeatViewToggle — 教师 / 学生视角切换（V2.0.4-alpha · Phase UI-4B）：
 * iOS Segmented Control——胶囊背景 + 滑块 200ms 平移；全站教室场景统一复用。
 * 纯展示组件：视角语义（teacher/student）由父级定义。
 */
const props = defineProps<{
  modelValue: 'teacher' | 'student'
  /** 左 / 右两项文案 */
  teacherLabel?: string
  studentLabel?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [view: 'teacher' | 'student']
}>()

const isTeacher = computed(() => props.modelValue === 'teacher')
</script>

<template>
  <div class="view-toggle" :class="{ 'is-disabled': disabled }" role="group" aria-label="教室视角">
    <span class="view-toggle__thumb" :class="{ 'is-right': !isTeacher }" aria-hidden="true" />
    <button
      type="button"
      class="view-toggle__item"
      :class="{ 'is-active': isTeacher }"
      :aria-pressed="isTeacher ? 'true' : 'false'"
      :disabled="disabled"
      @click="emit('update:modelValue', 'teacher')"
    >
      {{ teacherLabel ?? '老师视角' }}
    </button>
    <button
      type="button"
      class="view-toggle__item"
      :class="{ 'is-active': !isTeacher }"
      :aria-pressed="!isTeacher ? 'true' : 'false'"
      :disabled="disabled"
      @click="emit('update:modelValue', 'student')"
    >
      {{ studentLabel ?? '学生视角' }}
    </button>
  </div>
</template>

<style scoped>
.view-toggle {
  position: relative;
  display: inline-flex;
  padding: 3px;
  background: var(--color-fill-disabled);
  border-radius: var(--radius-full);
  isolation: isolate;
}

.view-toggle.is-disabled {
  opacity: 0.55;
  pointer-events: none;
}

/* 滑块：200ms 平移（UI-4B 统一动效） */
.view-toggle__thumb {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 3px;
  width: calc(50% - 3px);
  border-radius: var(--radius-full);
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
  transition: transform var(--duration-base) var(--ease-out);
}

.view-toggle__thumb.is-right {
  transform: translateX(100%);
}

.view-toggle__item {
  position: relative;
  z-index: 1;
  min-width: 88px;
  height: 30px;
  padding: 0 var(--space-4);
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
  transition: color var(--duration-base) var(--ease-out);
}

.view-toggle__item.is-active {
  color: var(--color-text-primary);
  font-weight: var(--font-weight-semibold);
}

.view-toggle__item:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}
</style>
