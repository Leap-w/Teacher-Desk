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
import { GraduationCap, Search, SlidersHorizontal } from 'lucide-vue-next'

import { AppButton, AppCard, AppModal, EmptyState } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { loadPinyinKey } from '@/services/pinyinSort'
import type { PinyinKey } from '@/services/pinyinSort'
import { useDutyStore } from '@/stores/duty'
import { useLeaveStore } from '@/stores/leave'
import { useStudentStore } from '@/stores/student'
import {
  buildNameCounts,
  buildDutyGroupNameById,
  disambiguatorOf as disambiguatorOfShared,
  formatStudentShortName,
} from '@/utils/student'
import { buildRandomRanks } from '@/utils/studentQuery'
import type { StudentSortMode } from '@/utils/studentQuery'
import { loadStudentViewPrefs, saveStudentViewPrefs } from '@/utils/studentViewPrefs'
import { isLeaveToday } from '@/utils/leave'
import type { Student, StudentInput } from '@/types'
import StudentBatchEditModal from './components/StudentBatchEditModal.vue'
import StudentCard from './components/StudentCard.vue'
import StudentDetailModal from './components/StudentDetailModal.vue'
import StudentFormModal from './components/StudentFormModal.vue'
import StudentHubSidebar from './components/StudentHubSidebar.vue'
import type { StudentFilterKey } from './components/StudentFilterChips.vue'
import StudentImportModal from './components/StudentImportModal.vue'

const studentStore = useStudentStore()
const dutyStore = useDutyStore()
const leaveStore = useLeaveStore()
const toast = useToast()

/** 搜索词与排序方式刷新后恢复（Phase 5B）；随机的次序不落盘，见 `sessionSort` 的说明 */
const viewPrefs = loadStudentViewPrefs()
const keyword = ref(viewPrefs.keyword)
const sortMode = ref<StudentSortMode>(sessionSort ?? viewPrefs.sort)
/** 拼音键提取器；词典是动态加载的，没就绪时为 null，此时排序退化为默认 */
const pinyinKey = ref<PinyinKey | null>(null)
const randomRanks = ref<ReadonlyMap<string, number>>(sessionRandomRanks)

const filter = ref<StudentFilterKey>('all')
const sidebarOpen = ref(false)

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

/* ---- 真实数据派生：今日在假 / 重名 / 值日组 / 家庭地区 ---- */

/** 今日在假的学生 id（请假 Store，只读） */
const onLeaveIds = computed(() => {
  const ids = new Set<string>()
  for (const record of leaveStore.leaves) {
    if (isLeaveToday(record, dutyStore.todayKey)) ids.add(record.studentId)
  }
  return ids
})

/** 同名计数：姓名 → 出现次数（重名徽章与消歧用）——公共件（`utils/student.ts`） */
const nameCounts = computed(() => buildNameCounts(activeStudents.value))

/** 学生 id → 值日组名（值日 Store 只读派生；一名学生只归一组，取首个命中） */
const dutyGroupNameById = computed(() => buildDutyGroupNameById(dutyStore.groups))

function regionOf(student: Student): string | undefined {
  const location = student.familyLocation
  if (!location) return undefined
  return location.county || location.prefecture || undefined
}

/** 重名消歧：公共件（`utils/student.ts`）——课堂工具随机点名共用同一份规则 */
function disambiguatorOf(student: Student): string | undefined {
  return disambiguatorOfShared(student, nameCounts.value, dutyGroupNameById.value)
}

const chipOptions = computed(() => [
  { key: 'all' as const, label: '全部', count: activeStudents.value.length },
  {
    key: 'male' as const,
    label: '男生',
    count: activeStudents.value.filter((item) => item.gender === 'male').length,
  },
  {
    key: 'female' as const,
    label: '女生',
    count: activeStudents.value.filter((item) => item.gender === 'female').length,
  },
  {
    key: 'cadre' as const,
    label: '班委',
    count: activeStudents.value.filter((item) => Boolean(item.cadreRole)).length,
  },
  { key: 'onleave' as const, label: '已请假', count: onLeaveIds.value.size },
  {
    key: 'remarked' as const,
    label: '有备注',
    count: activeStudents.value.filter((item) => Boolean(item.remark?.trim())).length,
  },
])

const summary = computed(() => ({
  total: activeStudents.value.length,
  male: activeStudents.value.filter((item) => item.gender === 'male').length,
  female: activeStudents.value.filter((item) => item.gender === 'female').length,
  cadre: activeStudents.value.filter((item) => Boolean(item.cadreRole)).length,
}))

/**
 * 列表的**唯一检索出口**（Phase 5B）：students → filter → sort → render 全在这一条 computed 上。
 * 过滤与排序的规则本身在 store → 纯函数 `queryStudents()` 里；「已请假 / 有备注」是
 * UI-4A 新增的真实数据筛选，在检索出口后做只读二次过滤——不改 store 检索逻辑。
 */
const searchedStudents = computed(() =>
  studentStore.searchStudents(keyword.value, {
    gender: filter.value === 'male' || filter.value === 'female' ? filter.value : undefined,
    cadreOnly: filter.value === 'cadre' ? true : undefined,
    sort: sortMode.value,
    pinyinKey: pinyinKey.value ?? undefined,
    randomRanks: randomRanks.value,
  }),
)

const visibleStudents = computed(() => {
  if (filter.value === 'onleave') {
    return searchedStudents.value.filter((item) => onLeaveIds.value.has(item.id))
  }
  if (filter.value === 'remarked') {
    return searchedStudents.value.filter((item) => Boolean(item.remark?.trim()))
  }
  return searchedStudents.value
})

const selectedStudents = computed(() =>
  activeStudents.value.filter((item) => selectedIds.value.has(item.id)),
)

const detailStudent = computed(() =>
  activeStudents.value.find((item) => item.id === detailId.value),
)

const activeFilterCount = computed(() => (filter.value === 'all' ? 0 : 1) + (keyword.value ? 1 : 0))

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

    <!-- 小屏：筛选入口按钮（桌面隐藏） -->
    <div class="mobile-filter-row">
      <AppButton variant="secondary" size="sm" @click="sidebarOpen = true">
        <SlidersHorizontal :size="16" :stroke-width="2" aria-hidden="true" />
        筛选与排序
        <span v-if="activeFilterCount" class="filter-badge">{{ activeFilterCount }}</span>
      </AppButton>
    </div>

    <div class="hub-layout">
      <StudentHubSidebar
        v-model:keyword="keyword"
        v-model:filter="filter"
        :sort-mode="sortMode"
        :chip-options="chipOptions"
        :summary="summary"
        :open="sidebarOpen"
        :show-empty-guide="activeStudents.length === 0"
        @update:sort-mode="selectSort($event)"
        @close="sidebarOpen = false"
      >
        <template v-if="activeStudents.length === 0" #guideActions>
          <AppButton size="sm" variant="secondary" @click="importOpen = true">批量导入</AppButton>
          <AppButton size="sm" @click="openCreate">新增学生</AppButton>
        </template>
      </StudentHubSidebar>

      <div class="hub-main">
        <section v-if="visibleStudents.length" class="card-grid">
          <StudentCard
            v-for="student in visibleStudents"
            :key="student.id"
            :student="student"
            :selectable="batchMode"
            :selected="selectedIds.has(student.id)"
            :duplicate-count="nameCounts.get(student.name)"
            :disambiguator="disambiguatorOf(student)"
            :region="regionOf(student)"
            :duty-group="dutyGroupNameById.get(student.id)"
            @open="openDetail"
            @toggle="toggleSelect"
          />
        </section>

        <AppCard v-else padding="none" class="empty-card">
          <EmptyState
            v-if="activeStudents.length"
            :icon="Search"
            title="未找到匹配的学生"
            description="换个关键词，或清除筛选条件再试试。"
          >
            <AppButton size="sm" variant="secondary" @click="clearFilters">清除筛选</AppButton>
          </EmptyState>
          <EmptyState
            v-else
            :icon="GraduationCap"
            title="暂无学生"
            description="已有 Excel 名单的话，用「批量导入」一次建档；也可以逐个新增。"
          >
            <div class="empty-actions">
              <AppButton size="sm" variant="secondary" @click="importOpen = true">
                批量导入
              </AppButton>
              <AppButton size="sm" @click="openCreate">新增学生</AppButton>
            </div>
          </EmptyState>
        </AppCard>
      </div>
    </div>

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
      :duplicate-count="detailStudent ? nameCounts.get(detailStudent.name) : undefined"
      :disambiguator="detailStudent ? disambiguatorOf(detailStudent) : undefined"
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

/* CDL 页面头：语义层级令牌（UI-1） */
.page-title {
  font-size: var(--font-h1);
  font-weight: var(--font-weight-semibold);
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
  font-weight: var(--font-weight-semibold);
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

/* 小屏筛选入口（桌面隐藏） */
.mobile-filter-row {
  margin-bottom: var(--space-4);
}

.mobile-filter-row :deep(.app-button) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.filter-badge {
  min-width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  color: var(--color-text-inverse);
  font-size: var(--font-caption);
  font-weight: var(--font-weight-semibold);
}

/* Hub 骨架：桌面 280px 侧栏 + 卡片流；<1024px 单列（侧栏变抽屉） */
.hub-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--spacing-lg);
  align-items: start;
}

@media (min-width: 1024px) {
  .hub-layout {
    grid-template-columns: 280px minmax(0, 1fr);
    gap: var(--spacing-xl);
  }

  .mobile-filter-row {
    display: none;
  }
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
