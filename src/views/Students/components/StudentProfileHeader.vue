<script setup lang="ts">
import { AppBadge } from '@/components/ui'
import type { Student } from '@/types'
import StudentAvatar from './StudentAvatar.vue'

/**
 * StudentProfileHeader — 学生详情头部（V2.0.3-alpha · Phase UI-4A 沉淀）：
 * 首字头像占位（学生无头像）+ 姓名 22px + 性别 / 班委 / 重名 / 标签徽章。
 * Apple Settings 风格的 Profile 区；详情弹窗与未来档案页共用。
 */
defineProps<{
  student: Student
  /** 同名学生数；>1 时显示重名徽章 */
  duplicateCount?: number
  /** 重名消歧文案（值日组或学号后四位），如「第3组」 */
  disambiguator?: string
}>()
</script>

<template>
  <header class="profile-head">
    <StudentAvatar :name="student.name" size="lg" />
    <div class="profile-intro">
      <h3 class="profile-name">
        {{ student.name
        }}<span v-if="disambiguator" class="profile-disamb">（{{ disambiguator }}）</span>
      </h3>
      <div class="profile-badges">
        <AppBadge :variant="student.gender === 'male' ? 'primary' : 'neutral'">
          {{ student.gender === 'male' ? '男' : '女' }}
        </AppBadge>
        <AppBadge v-if="student.cadreRole" variant="success">{{ student.cadreRole }}</AppBadge>
        <AppBadge v-if="duplicateCount && duplicateCount > 1" variant="warning">
          同名 {{ duplicateCount }} 人
        </AppBadge>
        <AppBadge v-for="tag in student.tags ?? []" :key="tag" variant="neutral">
          {{ tag }}
        </AppBadge>
      </div>
    </div>
  </header>
</template>

<style scoped>
.profile-head {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.profile-name {
  font-size: var(--text-xl);
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.01em;
  line-height: var(--leading-tight);
  color: var(--color-text-primary);
}

.profile-disamb {
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-tertiary);
}

.profile-badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
</style>
