<script setup lang="ts">
import { computed } from 'vue'

import { AppBadge, AppButton, AppModal } from '@/components/ui'
import {
  familyScopeLabel,
  formatBoardingLabel,
  formatSeatLabel,
  formatStudentDisplayName,
} from '@/utils/student'
import type { Student } from '@/types'
import StudentAvatar from './StudentAvatar.vue'

interface Props {
  modelValue: boolean
  student?: Student
}

const props = withDefaults(defineProps<Props>(), {
  student: undefined,
})

/** 所在地文案：地区 · 县区；信息缺失显示 — */
const locationText = computed(() => {
  const location = props.student?.familyLocation
  const parts = [location?.prefecture, location?.county].filter((part): part is string =>
    Boolean(part),
  )
  return parts.length > 0 ? parts.join(' · ') : '—'
})

const scopeText = computed(() => familyScopeLabel(props.student?.familyLocation) ?? '—')

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  edit: [student: Student]
  remove: [student: Student]
}>()

function close() {
  emit('update:modelValue', false)
}

function onEdit() {
  if (props.student) emit('edit', props.student)
}

function onRemove() {
  if (props.student) emit('remove', props.student)
}
</script>

<template>
  <AppModal :model-value="modelValue" title="学生详情" :width="520" @update:model-value="close">
    <div v-if="student" class="detail">
      <header class="detail-head">
        <StudentAvatar :name="student.name" size="lg" />
        <div class="detail-intro">
          <h3 class="detail-name">{{ formatStudentDisplayName(student) }}</h3>
          <div class="detail-badges">
            <AppBadge v-if="student.cadreRole" variant="primary">{{ student.cadreRole }}</AppBadge>
            <AppBadge variant="neutral">{{ student.gender === 'male' ? '男' : '女' }}</AppBadge>
            <AppBadge v-for="tag in student.tags ?? []" :key="tag" variant="neutral">
              {{ tag }}
            </AppBadge>
          </div>
        </div>
      </header>

      <dl class="detail-list">
        <div class="detail-item">
          <dt>学号</dt>
          <dd>{{ student.studentNo }}</dd>
        </div>
        <div class="detail-item">
          <dt>座位</dt>
          <dd>{{ formatSeatLabel(student) }}</dd>
        </div>
        <div class="detail-item">
          <dt>住宿</dt>
          <dd>{{ formatBoardingLabel(student) }}</dd>
        </div>
        <div class="detail-item">
          <dt>联系电话</dt>
          <dd>{{ student.phone || '—' }}</dd>
        </div>
        <div class="detail-item detail-item--full">
          <dt>备注</dt>
          <dd>{{ student.remark || '—' }}</dd>
        </div>

        <div class="detail-section-title">家庭信息</div>
        <div class="detail-item detail-item--full">
          <dt>家庭地址</dt>
          <dd>{{ student.familyAddress || '—' }}</dd>
        </div>
        <div class="detail-item">
          <dt>所在地</dt>
          <dd>{{ locationText }}</dd>
        </div>
        <div class="detail-item">
          <dt>返家范围</dt>
          <dd>{{ scopeText }}</dd>
        </div>
      </dl>
    </div>

    <template #footer>
      <AppButton variant="danger" :disabled="!student" @click="onRemove">删除</AppButton>
      <AppButton :disabled="!student" @click="onEdit">编辑</AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.detail-head {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.detail-name {
  font-size: var(--text-lg);
  font-weight: 700;
  letter-spacing: -0.2px;
}

.detail-badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.detail-list {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4) var(--space-5);
  margin-top: var(--space-5);
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.detail-item--full {
  grid-column: 1 / -1;
}

.detail-item dt {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.detail-item dd {
  font-size: var(--text-sm);
  color: var(--color-text);
  line-height: 1.6;
}

.detail-section-title {
  grid-column: 1 / -1;
  margin-top: var(--space-2);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-text-secondary);
}
</style>
