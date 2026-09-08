<script setup lang="ts">
import { computed, ref } from 'vue'

import { AppButton, AppCard, AppInput, AppModal, EmptyState } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useStudentStore } from '@/stores/student'
import { formatStudentDisplayName } from '@/utils/student'
import type { Gender, Student, StudentInput } from '@/types'
import StudentCard from './components/StudentCard.vue'
import StudentDetailModal from './components/StudentDetailModal.vue'
import StudentFormModal from './components/StudentFormModal.vue'

type StudentFilter = 'all' | Gender | 'cadre'

const studentStore = useStudentStore()
const toast = useToast()

const keyword = ref('')
const filter = ref<StudentFilter>('all')

const formOpen = ref(false)
const editingStudent = ref<Student | undefined>(undefined)
const detailOpen = ref(false)
const detailId = ref<string | undefined>(undefined)
const confirmOpen = ref(false)
const removingStudent = ref<Student | undefined>(undefined)

const activeStudents = computed(() => studentStore.activeStudents)

const filterOptions = computed(() => [
  { value: 'all' as const, label: '全部', count: activeStudents.value.length },
  {
    value: 'male' as const,
    label: '男生',
    count: activeStudents.value.filter((item) => item.gender === 'male').length,
  },
  {
    value: 'female' as const,
    label: '女生',
    count: activeStudents.value.filter((item) => item.gender === 'female').length,
  },
  {
    value: 'cadre' as const,
    label: '班委',
    count: activeStudents.value.filter((item) => Boolean(item.cadreRole)).length,
  },
])

const filteredStudents = computed(() => {
  const options: { gender?: Gender; cadreOnly?: boolean } = {}
  if (filter.value === 'male' || filter.value === 'female') options.gender = filter.value
  if (filter.value === 'cadre') options.cadreOnly = true
  return studentStore.searchStudents(keyword.value, options)
})

const detailStudent = computed(() =>
  activeStudents.value.find((item) => item.id === detailId.value),
)

function openCreate() {
  editingStudent.value = undefined
  formOpen.value = true
}

function openDetail(student: Student) {
  detailId.value = student.id
  detailOpen.value = true
}

function openEdit(student: Student) {
  detailOpen.value = false
  editingStudent.value = student
  formOpen.value = true
}

function handleFormSubmit(payload: StudentInput) {
  if (editingStudent.value) {
    const saved = studentStore.updateStudent(editingStudent.value.id, payload)
    if (!saved) {
      toast.danger('保存失败：该学生记录不存在，请刷新后重试')
      return
    }
    toast.success('学生信息已更新')
  } else {
    const saved = studentStore.addStudent(payload)
    if (!saved) {
      // Store 已做学号唯一性兜底（表单之外的其他写入入口也能被拦截）
      toast.danger('新增失败：该学号已存在')
      return
    }
    toast.success(`已新增学生 ${formatStudentDisplayName(saved)}`)
  }
}

function askRemove(student: Student) {
  removingStudent.value = student
  detailOpen.value = false
  confirmOpen.value = true
}

function confirmRemove() {
  const target = removingStudent.value
  removingStudent.value = undefined
  confirmOpen.value = false
  if (!target) return
  if (!studentStore.removeStudent(target.id)) {
    toast.danger('删除失败：该学生记录不存在，请刷新后重试')
    return
  }
  // 同名学生在列表中常见，删除反馈用「姓名（学号后四位｜座位号）」以便区分
  toast.success(`已从学生列表中移除 ${formatStudentDisplayName(target)}`)
}

function clearFilters() {
  keyword.value = ''
  filter.value = 'all'
}
</script>

<template>
  <div class="students-page">
    <header class="page-toolbar">
      <div>
        <h1 class="page-title">学生档案</h1>
        <p class="page-subtitle">共 {{ activeStudents.length }} 名学生</p>
      </div>
      <AppButton @click="openCreate">＋ 新增学生</AppButton>
    </header>

    <div class="toolbar-row">
      <AppInput
        v-model="keyword"
        class="search-input"
        placeholder="搜索姓名、学号或宿舍"
        clearable
      />
      <div class="segmented" role="group" aria-label="学生筛选">
        <button
          v-for="option in filterOptions"
          :key="option.value"
          type="button"
          class="segmented-item"
          :class="{ 'is-active': filter === option.value }"
          @click="filter = option.value"
        >
          {{ option.label }}
          <span class="segmented-count">{{ option.count }}</span>
        </button>
      </div>
    </div>

    <section v-if="filteredStudents.length" class="card-grid">
      <StudentCard
        v-for="student in filteredStudents"
        :key="student.id"
        :student="student"
        @open="openDetail"
      />
    </section>

    <AppCard v-else padding="none" class="empty-card">
      <EmptyState
        v-if="activeStudents.length"
        icon="🔍"
        title="未找到匹配的学生"
        description="换个关键词，或清除筛选条件再试试。"
      >
        <AppButton size="sm" variant="secondary" @click="clearFilters">清除筛选</AppButton>
      </EmptyState>
      <EmptyState
        v-else
        icon="🎓"
        title="暂无学生"
        description="点击右上角「新增学生」，创建第一名学生档案。"
      >
        <AppButton size="sm" @click="openCreate">新增学生</AppButton>
      </EmptyState>
    </AppCard>

    <StudentFormModal v-model="formOpen" :student="editingStudent" @submit="handleFormSubmit" />

    <StudentDetailModal
      v-model="detailOpen"
      :student="detailStudent"
      @edit="openEdit"
      @remove="askRemove"
    />

    <AppModal v-model="confirmOpen" title="删除学生" :width="380">
      <p class="confirm-text">
        确定从学生列表中移除
        <strong>{{ removingStudent ? formatStudentDisplayName(removingStudent) : '' }}</strong>
        吗？此操作无法撤销。
      </p>
      <template #footer>
        <AppButton variant="ghost" @click="confirmOpen = false">取消</AppButton>
        <AppButton variant="danger" @click="confirmRemove">从学生列表中移除</AppButton>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.students-page {
  max-width: 1200px;
}

.page-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-5);
}

.page-title {
  font-size: var(--text-xl);
  font-weight: 700;
  letter-spacing: -0.3px;
}

.page-subtitle {
  margin-top: var(--space-1);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.toolbar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
  margin-bottom: var(--space-5);
}

.search-input {
  width: 280px;
  max-width: 100%;
}

.segmented {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  background: var(--color-fill-disabled);
  border-radius: var(--radius-md);
}

.segmented-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  padding: 6px 14px;
  border-radius: 9px;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background var(--transition-fast),
    color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.segmented-item.is-active {
  background: var(--color-surface);
  color: var(--color-text);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}

.segmented-count {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: var(--space-4);
}

.empty-card {
  padding: var(--space-6);
}

.confirm-text {
  font-size: var(--text-sm);
  line-height: 1.7;
  color: var(--color-text-secondary);
}

.confirm-text strong {
  color: var(--color-text);
}
</style>
