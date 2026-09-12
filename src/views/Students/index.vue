<script lang="ts">
/**
 * 列表的会话态（Phase 5B）——**整个页面会话共用，刷新即重置**。
 *
 * 刻意放在模块作用域而不是组件里：规格要求随机排序「当前会话保持结果」，
 * 教师去看一眼座位图再切回来时名单不该重新洗一遍。放组件里会在路由离开时随组件丢掉；
 * 放 localStorage 又违反「随机不落盘」——随机是此刻的观看顺序，记住它没有意义。
 *
 * 类型写成字面量联合而不是引 `StudentSortMode`：这里刻意不引入任何 import，
 * 少一个「`<script>` 与 `<script setup>` 两个块谁看得见谁」的问题。
 * 两侧若哪天分叉，`sessionSort = sortMode.value` 那行会直接编译不过。
 */
let sessionSort: 'default' | 'pinyin' | 'random' | null = null
let sessionRandomRanks: ReadonlyMap<string, number> = new Map()
</script>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { AppButton, AppCard, AppInput, AppModal, EmptyState } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { loadPinyinKey } from '@/services/pinyinSort'
import type { PinyinKey } from '@/services/pinyinSort'
import { useStudentStore } from '@/stores/student'
import { formatStudentShortName } from '@/utils/student'
import { buildRandomRanks } from '@/utils/studentQuery'
import type { StudentSortMode } from '@/utils/studentQuery'
import { loadStudentViewPrefs, saveStudentViewPrefs } from '@/utils/studentViewPrefs'
import type { Gender, Student, StudentInput } from '@/types'
import StudentBatchEditModal from './components/StudentBatchEditModal.vue'
import StudentCard from './components/StudentCard.vue'
import StudentDetailModal from './components/StudentDetailModal.vue'
import StudentFormModal from './components/StudentFormModal.vue'
import StudentImportModal from './components/StudentImportModal.vue'

type StudentFilter = 'all' | Gender | 'cadre'

const SORT_OPTIONS: { value: StudentSortMode; label: string }[] = [
  { value: 'default', label: '默认' },
  { value: 'pinyin', label: '首字母' },
  { value: 'random', label: '随机' },
]

const studentStore = useStudentStore()
const toast = useToast()

/** 搜索词与排序方式刷新后恢复（Phase 5B）；随机的次序不落盘，见 `sessionSort` 的说明 */
const viewPrefs = loadStudentViewPrefs()
const keyword = ref(viewPrefs.keyword)
const sortMode = ref<StudentSortMode>(sessionSort ?? viewPrefs.sort)
/** 拼音键提取器；词典是动态加载的，没就绪时为 null，此时排序退化为默认 */
const pinyinKey = ref<PinyinKey | null>(null)
const randomRanks = ref<ReadonlyMap<string, number>>(sessionRandomRanks)

const filter = ref<StudentFilter>('all')

const formOpen = ref(false)
const importOpen = ref(false)
const editingStudent = ref<Student | undefined>(undefined)
const detailOpen = ref(false)
const detailId = ref<string | undefined>(undefined)
const confirmOpen = ref(false)
/**
 * 待删除的学生。**确认后不清空**：弹窗关闭有淡出动画，动画期间它仍在渲染，
 * 清掉会让「确定从学生列表中移除 XXX 吗」先变成空名再消失（§9.8 记录项）。
 * 下次打开时由 askRemove 覆盖；学生对象在 store 里是整体替换的，不会被就地改写。
 */
const removingStudent = ref<Student | undefined>(undefined)

/** 批量管理模式（Phase 5B）：卡片变成可勾选，点卡片 = 勾选而不是打开详情 */
const batchMode = ref(false)
const batchOpen = ref(false)
/** 选中集合。整体替换而不是就地增删——与 store 侧「整体替换」同一哲学 */
const selectedIds = ref<Set<string>>(new Set())

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

/**
 * 列表的**唯一检索出口**（Phase 5B）：students → filter → sort → render 全在这一条 computed 上。
 * 过滤与排序的规则本身在 store → 纯函数 `queryStudents()` 里，这里只负责喂搜索词、筛选项与排序参数。
 */
const visibleStudents = computed(() =>
  studentStore.searchStudents(keyword.value, {
    gender: filter.value === 'male' || filter.value === 'female' ? filter.value : undefined,
    cadreOnly: filter.value === 'cadre' ? true : undefined,
    sort: sortMode.value,
    pinyinKey: pinyinKey.value ?? undefined,
    randomRanks: randomRanks.value,
  }),
)

const selectedStudents = computed(() =>
  activeStudents.value.filter((item) => selectedIds.value.has(item.id)),
)

const detailStudent = computed(() =>
  activeStudents.value.find((item) => item.id === detailId.value),
)

watch([keyword, sortMode], () => {
  sessionSort = sortMode.value
  saveStudentViewPrefs({
    keyword: keyword.value,
    // 「随机」不落盘：离开时是随机，刷新后回落到默认排序
    sort: sortMode.value === 'random' ? 'default' : sortMode.value,
  })
})

onMounted(() => {
  // 会话内切走再回来时排序方式仍在，拼音词典则要重新确保加载（模块级只加载一次，通常已就绪）
  if (sortMode.value === 'pinyin') void ensurePinyinKey()
})

/**
 * 确保拼音词典已加载。**失败时回落到默认排序并明说**——
 * 静默留在原样会让教师以为「首字母」这个词被点了没反应。
 */
async function ensurePinyinKey(): Promise<void> {
  if (pinyinKey.value) return
  const key = await loadPinyinKey()
  if (!key) {
    toast.warning('拼音排序加载失败，已按默认顺序排列')
    if (sortMode.value === 'pinyin') sortMode.value = 'default'
    return
  }
  pinyinKey.value = key
}

async function selectSort(mode: StudentSortMode) {
  sortMode.value = mode
  if (mode === 'random') {
    reshuffle()
    return
  }
  if (mode === 'pinyin') await ensurePinyinKey()
}

/** 重新洗牌。**每次点击都重洗**，包括「已经是随机时再点一次」（规格的「每次点击重新随机」） */
function reshuffle() {
  const ranks = buildRandomRanks(activeStudents.value.map((item) => item.id))
  sessionRandomRanks = ranks
  randomRanks.value = ranks
}

function toggleSelect(student: Student) {
  const next = new Set(selectedIds.value)
  if (next.has(student.id)) next.delete(student.id)
  else next.add(student.id)
  selectedIds.value = next
}

/** 全选 = 选中**当前可见**的全部学生：受搜索与筛选影响，「搜出走读生 → 全选 → 批量改宿舍」才连得起来 */
function selectAllVisible() {
  selectedIds.value = new Set(visibleStudents.value.map((item) => item.id))
}

function clearSelection() {
  selectedIds.value = new Set()
}

function exitBatch() {
  batchMode.value = false
  clearSelection()
}

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
    toast.success(`已新增学生 ${formatStudentShortName(saved)}`)
  }
}

function askRemove(student: Student) {
  removingStudent.value = student
  detailOpen.value = false
  confirmOpen.value = true
}

function confirmRemove() {
  const target = removingStudent.value
  confirmOpen.value = false
  if (!target) return
  if (!studentStore.removeStudent(target.id)) {
    toast.danger('删除失败：该学生记录不存在，请刷新后重试')
    return
  }
  // 同名学生在列表中常见，删除反馈用「姓名（学号后四位）」以便区分。
  // 不带座位号：档案从 Phase 5A 起已不维护它（§2.3）
  toast.success(`已从学生列表中移除 ${formatStudentShortName(target)}`)
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
      <div class="toolbar-actions">
        <template v-if="batchMode">
          <span class="batch-count">已选 {{ selectedIds.size }} 人</span>
          <AppButton variant="ghost" @click="selectAllVisible">全选</AppButton>
          <AppButton variant="ghost" :disabled="!selectedIds.size" @click="clearSelection">
            取消全选
          </AppButton>
          <AppButton :disabled="!selectedIds.size" @click="batchOpen = true">批量修改</AppButton>
          <AppButton variant="secondary" @click="exitBatch">退出批量管理</AppButton>
        </template>
        <template v-else>
          <AppButton variant="secondary" @click="importOpen = true">批量导入</AppButton>
          <AppButton @click="openCreate">＋ 新增学生</AppButton>
          <AppButton variant="secondary" @click="batchMode = true">批量管理</AppButton>
        </template>
      </div>
    </header>

    <div class="toolbar-row">
      <AppInput
        v-model="keyword"
        class="search-input"
        placeholder="搜索姓名、班委、宿舍或标签…"
        clearable
      />
      <div class="toolbar-filters">
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
        <div class="segmented" role="group" aria-label="排序方式">
          <button
            v-for="option in SORT_OPTIONS"
            :key="option.value"
            type="button"
            class="segmented-item"
            :class="{ 'is-active': sortMode === option.value }"
            @click="selectSort(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
    </div>

    <section v-if="visibleStudents.length" class="card-grid">
      <StudentCard
        v-for="student in visibleStudents"
        :key="student.id"
        :student="student"
        :selectable="batchMode"
        :selected="selectedIds.has(student.id)"
        @open="openDetail"
        @toggle="toggleSelect"
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
        description="已有 Excel 名单的话，用「批量导入」一次建档；也可以逐个新增。"
      >
        <div class="empty-actions">
          <AppButton size="sm" variant="secondary" @click="importOpen = true">批量导入</AppButton>
          <AppButton size="sm" @click="openCreate">新增学生</AppButton>
        </div>
      </EmptyState>
    </AppCard>

    <StudentFormModal v-model="formOpen" :student="editingStudent" @submit="handleFormSubmit" />

    <StudentImportModal v-model="importOpen" />

    <StudentBatchEditModal
      v-model="batchOpen"
      :students="selectedStudents"
      @applied="clearSelection"
    />

    <StudentDetailModal
      v-model="detailOpen"
      :student="detailStudent"
      @edit="openEdit"
      @remove="askRemove"
    />

    <AppModal v-model="confirmOpen" title="删除学生" :width="380">
      <p class="confirm-text">
        确定从学生列表中移除
        <strong>{{ removingStudent ? formatStudentShortName(removingStudent) : '' }}</strong>
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
  padding: 0 4px 14px;
  margin-bottom: var(--spacing-lg);
  border-bottom: 1px solid var(--color-border);
}

/* CDL 页面头：32px 特粗标题 + 底部细线（同 Profile / Home） */
.page-title {
  font-size: var(--font-page-title, 32px);
  font-weight: var(--font-weight-extrabold);
  letter-spacing: -0.01em;
  line-height: 1.2;
  color: var(--color-text-primary);
}

.page-subtitle {
  margin-top: 2px;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.batch-count {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-primary-strong);
}

/* EmptyState 的默认插槽是个裸 div，并排两个按钮会紧贴在一起 */
.empty-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.toolbar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
  margin-bottom: var(--space-5);
}

/* 筛选与排序两组分段控件：间距比组内的 2px 明显大一档，读起来才是两组而不是一组 */
.toolbar-filters {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
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
