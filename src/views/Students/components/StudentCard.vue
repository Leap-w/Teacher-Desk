<script setup lang="ts">
import { AppBadge, AppCard } from '@/components/ui'
import type { Student } from '@/types'
import StudentAvatar from './StudentAvatar.vue'

defineProps<{
  student: Student
}>()

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
        <!-- 学号自 Phase 5A 起可选，空值按 §2.3 显示占位符 -->
        <p class="meta">{{ student.studentNo || '—' }}</p>
      </div>
    </div>

    <!--
      顺序按「班主任日常要看的先后」排（Phase 5A）：班委先于标签，宿舍与电话垫底。
      返家范围从卡片上撤下——它是周末统计口径，日常不看，占的是最显眼的位置。
      不再显示座位号：档案已不维护它，摆在这里的是一个只读不写的值（§2.3）。
    -->
    <div v-if="student.cadreRole || student.tags?.length" class="badges">
      <AppBadge v-if="student.cadreRole" variant="primary">{{ student.cadreRole }}</AppBadge>
      <AppBadge v-for="tag in student.tags ?? []" :key="tag" variant="neutral">{{ tag }}</AppBadge>
    </div>

    <p v-if="student.dormitory" class="line">宿舍 · {{ student.dormitory }}</p>
    <p v-if="student.phone" class="line">电话 · {{ student.phone }}</p>
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

/* 标签多了会自动换行：`.badges` 已是 flex + wrap，无需为「多标签」单独写规则 */
.badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.line {
  margin-top: var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.badges + .line {
  margin-top: var(--space-3);
}
</style>
