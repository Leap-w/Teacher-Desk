<script setup lang="ts">
import { computed } from 'vue'

import { AppButton, AppModal } from '@/components/ui'
import { familyScopeLabel, formatStudentShortName } from '@/utils/student'
import type { Student } from '@/types'
import StudentProfileHeader from './StudentProfileHeader.vue'

interface Props {
  modelValue: boolean
  student?: Student
  /** 同名学生数（重名徽章） */
  duplicateCount?: number
  /** 重名消歧文案（值日组优先，回落学号后四位） */
  disambiguator?: string
}

const props = withDefaults(defineProps<Props>(), {
  student: undefined,
  duplicateCount: undefined,
  disambiguator: undefined,
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
      <!-- Profile 头：姓名 + 性别 / 班委 / 重名 / 标签 -->
      <StudentProfileHeader
        :student="student"
        :duplicate-count="duplicateCount"
        :disambiguator="disambiguator"
      />
      <p class="detail-formal">档案名 · {{ formatStudentShortName(student) }}</p>

      <!-- 信息分组：每组独立 Card Section（Apple Settings 风） -->
      <section class="detail-card">
        <h4 class="detail-card__title">基本信息</h4>
        <dl class="detail-list">
          <div class="detail-item">
            <dt>学号</dt>
            <dd>{{ student.studentNo || '—' }}</dd>
          </div>
          <div class="detail-item">
            <dt>宿舍</dt>
            <dd>{{ student.dormitory || '—' }}</dd>
          </div>
          <div class="detail-item">
            <dt>联系电话</dt>
            <dd>{{ student.phone || '—' }}</dd>
          </div>
        </dl>
      </section>

      <section class="detail-card">
        <h4 class="detail-card__title">家庭信息</h4>
        <dl class="detail-list">
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
      </section>

      <section class="detail-card">
        <h4 class="detail-card__title">班级信息</h4>
        <dl class="detail-list">
          <div class="detail-item">
            <dt>班委职务</dt>
            <dd>{{ student.cadreRole || '—' }}</dd>
          </div>
          <div class="detail-item">
            <dt>标签</dt>
            <dd>{{ student.tags?.length ? student.tags.join(' · ') : '—' }}</dd>
          </div>
          <div class="detail-item detail-item--full">
            <dt>备注</dt>
            <dd>{{ student.remark || '—' }}</dd>
          </div>
        </dl>
      </section>
    </div>

    <template #footer>
      <AppButton variant="danger" :disabled="!student" @click="onRemove">删除</AppButton>
      <AppButton :disabled="!student" @click="onEdit">编辑</AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.detail-formal {
  margin-top: var(--space-2);
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

/* 信息分组卡：浅底圆角（同 Profile 卡做法），与头部留一行呼吸 */
.detail-card {
  margin-top: var(--spacing-card);
  padding: var(--spacing-card);
  background: var(--color-bg-subtle);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
}

.detail-card__title {
  margin: 0 0 var(--space-3);
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.detail-list {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4) var(--space-5);
  margin: 0;
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
  color: var(--color-text-tertiary);
}

.detail-item dd {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-primary);
  line-height: 1.6;
}
</style>
