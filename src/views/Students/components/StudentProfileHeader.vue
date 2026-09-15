<script setup lang="ts">
import { AppBadge } from '@/components/ui'
import type { Student } from '@/types'
import StudentAvatar from './StudentAvatar.vue'

/**
 * StudentProfileHeader — 学生详情头部（V2.0.3-alpha · Phase UI-4A 沉淀）：
 * 首字头像占位（学生无头像）+ 姓名 22px + 性别 / 班委 / 标签徽章。
 * Apple Settings 风格的 Profile 区；详情弹窗与未来档案页共用。
 *
 * v3.3.1：撤掉「同名 N 人」徽章——消歧的答案就是姓名后面那个身份证尾号，
 * 再挂一个「同名 2 人」只是把同一个事实说了两遍，还占掉一行徽章的位置。
 */
defineProps<{
  student: Student
  /** 重名消歧文案（身份证尾号，如「3287」）；不重名 / 未填尾号时为 undefined */
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
