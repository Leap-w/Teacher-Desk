<script setup lang="ts">
import { computed } from 'vue'

import { AppBadge, AppCard } from '@/components/ui'
import { familyScopeLabel, formatSeatLabel } from '@/utils/student'
import type { Student } from '@/types'
import StudentAvatar from './StudentAvatar.vue'

const props = defineProps<{
  student: Student
}>()

const scopeLabel = computed(() => familyScopeLabel(props.student.familyLocation))

const emit = defineEmits<{
  open: [student: Student]
}>()
</script>

<template>
  <AppCard
    class="student-card"
    role="button"
    tabindex="0"
    @click="emit('open', student)"
    @keydown.enter="emit('open', student)"
  >
    <div class="card-top">
      <StudentAvatar :name="student.name" />
      <div class="who">
        <h3 class="name">{{ student.name }}</h3>
        <p class="meta">{{ student.studentNo }} · {{ formatSeatLabel(student) }}</p>
      </div>
    </div>

    <p v-if="student.dormitory" class="dorm">宿舍 · {{ student.dormitory }}</p>

    <div v-if="scopeLabel || student.cadreRole || student.tags?.length" class="badges">
      <AppBadge v-if="scopeLabel" variant="neutral">{{ scopeLabel }}</AppBadge>
      <AppBadge v-if="student.cadreRole" variant="primary">{{ student.cadreRole }}</AppBadge>
      <AppBadge v-for="tag in student.tags ?? []" :key="tag" variant="neutral">{{ tag }}</AppBadge>
    </div>
  </AppCard>
</template>

<style scoped>
.student-card {
  cursor: pointer;
}

.card-top {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.name {
  font-size: var(--text-md);
  font-weight: 600;
}

.meta {
  margin-top: 2px;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.dorm {
  margin-top: var(--space-3);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
</style>
