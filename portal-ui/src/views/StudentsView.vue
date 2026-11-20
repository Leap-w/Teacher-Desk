<script setup lang="ts">
import { computed, ref } from 'vue'
import { portalData } from '../data'
import type { Student } from '../data'
import Icon from '../components/Icon.vue'
import StudentSheet from '../components/StudentSheet.vue'

const keyword = ref('')
const gender = ref<'全部' | '男' | '女'>('全部')
const dorm = ref('全部')
const selected = ref<Student | null>(null)

const dorms = [
  ...new Set(portalData.students.map((student) => student.dorm).filter(Boolean)),
].sort()
const hasGender = portalData.students.some((student) => student.gender)
const hasDorm = dorms.length > 0

const filtered = computed(() => {
  const query = keyword.value.trim()
  return portalData.students.filter((student) => {
    if (query && !student.name.includes(query)) return false
    if (gender.value !== '全部' && student.gender !== gender.value) return false
    if (dorm.value !== '全部' && student.dorm !== dorm.value) return false
    return true
  })
})

function clearFilters() {
  keyword.value = ''
  gender.value = '全部'
  dorm.value = '全部'
}
</script>

<template>
  <div class="page students">
    <header class="page-head">
      <h1>学生档案</h1>
      <p class="muted">
        {{ portalData.students.length }} 位同学 ·
        {{ portalData.mode === 'demo' ? '虚构演示信息' : '只读信息' }}
      </p>
    </header>

    <div class="search-box">
      <Icon name="search" :size="18" />
      <input v-model="keyword" type="search" placeholder="搜索姓名" aria-label="搜索姓名" />
      <button v-if="keyword" type="button" aria-label="清空搜索" @click="keyword = ''">
        <Icon name="close" :size="16" />
      </button>
    </div>

    <div v-if="hasGender || hasDorm" class="filters">
      <div v-if="hasGender" class="segment" role="group" aria-label="按性别筛选">
        <button
          v-for="option in ['全部', '男', '女'] as const"
          :key="option"
          type="button"
          :class="{ active: gender === option }"
          @click="gender = option"
        >
          {{ option }}
        </button>
      </div>
      <label v-if="hasDorm" class="dorm-select">
        <Icon name="filter" :size="16" />
        <select v-model="dorm" aria-label="按宿舍筛选">
          <option value="全部">全部宿舍</option>
          <option v-for="item in dorms" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
    </div>

    <div class="result-line muted">
      找到 <strong>{{ filtered.length }}</strong> 位同学
    </div>

    <div v-if="filtered.length" class="student-grid">
      <button
        v-for="student in filtered"
        :key="student.id"
        type="button"
        class="student-card card"
        @click="selected = student"
      >
        <span class="avatar" :style="{ background: student.color || 'var(--primary)' }">{{
          student.name.slice(0, 1)
        }}</span>
        <span class="info">
          <strong>{{ student.name }}</strong>
          <span v-if="student.dorm" class="muted">{{ student.dorm }}</span>
        </span>
        <span v-if="student.duty" class="duty">{{ student.duty }}</span>
      </button>
    </div>

    <div v-else class="empty card">
      <Icon name="users" :size="28" />
      <p>没有找到符合条件的同学</p>
      <button type="button" class="reset" @click="clearFilters">清除筛选</button>
    </div>

    <StudentSheet :student="selected" @close="selected = null" />
  </div>
</template>

<style scoped>
.page-head {
  padding-top: var(--space-2);
}

.page-head h1 {
  font-size: 26px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.page-head p {
  margin-top: 4px;
  font-size: 13px;
}

.search-box {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 48px;
  margin-top: var(--space-5);
  padding: 0 var(--space-3);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-sub);
}

.search-box:focus-within {
  border-color: var(--primary-ring);
}

.search-box input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  font-size: 14px;
}

.search-box input::placeholder {
  color: var(--text-sub);
}

.search-box button {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 0;
  background: transparent;
  color: var(--text-sub);
}

.filters {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.segment {
  display: flex;
  flex: 1;
  gap: 2px;
  padding: 3px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.segment button {
  flex: 1;
  min-height: 38px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--text-sub);
  font-size: 13px;
}

.segment button.active {
  background: var(--primary-soft);
  color: var(--primary);
  font-weight: 600;
}

.dorm-select {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  padding: 0 var(--space-2);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-sub);
}

.dorm-select select {
  flex: 1;
  min-width: 0;
  height: 44px;
  border: 0;
  outline: 0;
  background: transparent;
  font-size: 13px;
  color: var(--text-main);
  appearance: none;
}

.result-line {
  margin: var(--space-5) 0 var(--space-3);
  font-size: 12px;
}

.result-line strong {
  color: var(--text-main);
}

.student-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
}

.student-card {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  min-height: 72px;
  padding: var(--space-3);
  text-align: left;
}

.avatar {
  flex: none;
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  color: #fff;
  font-size: 15px;
  font-weight: 600;
}

.info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.info strong {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.info > span {
  font-size: 11px;
}

.duty {
  flex: none;
  margin-left: auto;
  padding: 2px 6px;
  border-radius: var(--radius-pill);
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 10px;
}

@media (max-width: 360px) {
  .duty {
    display: none;
  }
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: var(--space-10) var(--space-4);
  color: var(--primary);
}

.empty p {
  margin-top: var(--space-2);
  color: var(--text-main);
  font-weight: 600;
}

.reset {
  min-height: 44px;
  margin-top: var(--space-2);
  padding: 0 var(--space-4);
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--primary-soft);
  color: var(--primary);
  font-weight: 500;
}

@media (min-width: 768px) {
  .student-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
