<script setup lang="ts">
/**
 * 学生个人违纪档案。
 *
 * - 每名学生（含已软删除学生）都按稳定 `studentId` 查看全部历史违纪事件；
 * - 统计与事件列表全部来自 Phase 1A 的数据层，不在组件里另算；
 * - 事件按时间倒序，可查看详情 / 编辑 / 删除；
 * - 可跳到该学生的照片管理（已退档学生也能看历史照片）。
 */
import { computed, ref } from 'vue'

import { AppBadge, AppButton, AppModal, AppSegmented } from '@/components/ui'
import { useStudentStore } from '@/stores/student'
import { useViolationStore } from '@/stores/violation'
import { formatStudentShortName } from '@/utils/student'
import { VIOLATION_SEVERITY_LABELS } from '@/utils/violation'
import { severityBadgeVariant } from '@/utils/violationUi'
import ViolationEventItem from './ViolationEventItem.vue'
import type { ViolationEvent, ViolationSeverity } from '@/types/violation'

const props = withDefaults(defineProps<{ modelValue: boolean; studentId?: string }>(), {
  studentId: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  view: [event: ViolationEvent]
  edit: [event: ViolationEvent]
  remove: [event: ViolationEvent]
  openPhotos: [studentId: string]
}>()

const studentStore = useStudentStore()
const violationStore = useViolationStore()

type SeverityFilter = ViolationSeverity | 'all'
const severityFilter = ref<SeverityFilter>('all')

const student = computed(() =>
  props.studentId ? studentStore.students.find((item) => item.id === props.studentId) : undefined,
)

const stats = computed(() =>
  props.studentId
    ? violationStore.statsOfStudent(props.studentId)
    : {
        total: 0,
        severity: { minor: 0, moderate: 0, severe: 0 },
        behaviors: [],
        studentName: '',
        lastDate: null,
      },
)

const allEvents = computed(() =>
  props.studentId ? violationStore.eventsOfStudent(props.studentId) : [],
)

const filteredEvents = computed(() =>
  severityFilter.value === 'all'
    ? allEvents.value
    : allEvents.value.filter((event) => event.severity === severityFilter.value),
)

const displayName = computed(() => {
  if (student.value) {
    return formatStudentShortName(student.value, studentStore.nameCounts)
  }
  return stats.value.studentName || '未知学生'
})

const severitySummary = computed(() => [
  {
    key: 'minor',
    label: '一般违纪',
    count: stats.value.severity.minor,
    severity: 'minor' as const,
  },
  {
    key: 'moderate',
    label: '较严重违纪',
    count: stats.value.severity.moderate,
    severity: 'moderate' as const,
  },
  {
    key: 'severe',
    label: '严重违纪',
    count: stats.value.severity.severe,
    severity: 'severe' as const,
  },
])

const behaviorRows = computed(() => stats.value.behaviors.slice(0, 12))

function close(): void {
  emit('update:modelValue', false)
}
</script>

<template>
  <AppModal :model-value="modelValue" title="学生违纪档案" :width="760" @update:model-value="close">
    <div v-if="studentId" class="profile">
      <header class="profile-head">
        <div class="profile-head__main">
          <p class="profile-name">{{ displayName }}</p>
          <p class="profile-sub">
            <template v-if="student?.deletedAt">已退档学生 · 历史记录仍保留</template>
            <template v-else>在读学生</template>
            <template v-if="stats.lastDate"> · 最近一次：{{ stats.lastDate }}</template>
          </p>
        </div>
        <AppBadge variant="primary">累计 {{ stats.total }} 次</AppBadge>
      </header>

      <!-- 三级统计 + 按事件统计 -->
      <section class="profile-section">
        <h3 class="profile-section__title">违纪统计</h3>
        <div class="severity-grid">
          <div v-for="item in severitySummary" :key="item.key" class="severity-card">
            <AppBadge :variant="severityBadgeVariant(item.severity)">
              {{ VIOLATION_SEVERITY_LABELS[item.severity] }}
            </AppBadge>
            <p class="severity-count">{{ item.count }} 次</p>
          </div>
        </div>

        <div v-if="stats.behaviors.length" class="behavior-list">
          <p class="behavior-title">按违纪行为统计</p>
          <ul class="behavior-rows">
            <li v-for="row in behaviorRows" :key="row.behaviorLabel" class="behavior-row">
              <span class="behavior-label">{{ row.behaviorLabel }}</span>
              <span class="behavior-count">{{ row.count }} 次</span>
            </li>
          </ul>
        </div>
        <p v-else class="profile-empty">暂无违纪行为记录。</p>
      </section>

      <!-- 历史事件 -->
      <section class="profile-section">
        <div class="history-head">
          <h3 class="profile-section__title">全部历史事件（按时间倒序）</h3>
          <AppSegmented
            :model-value="severityFilter"
            :options="[
              { value: 'all', label: '全部' },
              { value: 'minor', label: '一般' },
              { value: 'moderate', label: '较严重' },
              { value: 'severe', label: '严重' },
            ]"
            label="按严重程度筛选"
            @update:model-value="severityFilter = $event as SeverityFilter"
          />
        </div>

        <div v-if="filteredEvents.length" class="history-list">
          <ViolationEventItem
            v-for="item in filteredEvents"
            :key="item.id"
            :event="item"
            :show-student="false"
            @view="emit('view', $event)"
            @edit="emit('edit', $event)"
            @remove="emit('remove', $event)"
          />
        </div>
        <p v-else class="profile-empty">
          {{ allEvents.length ? '当前筛选下没有事件。' : '这名学生暂无违纪记录。' }}
        </p>
      </section>
    </div>

    <template #footer>
      <AppButton
        v-if="studentId"
        variant="ghost"
        :disabled="!student"
        @click="emit('openPhotos', studentId)"
      >
        查看照片
      </AppButton>
      <AppButton @click="close">关闭</AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.profile {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

.profile-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3);
  background: var(--color-bg-subtle);
  border-radius: var(--radius-md);
}

.profile-name {
  font-size: var(--text-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.profile-sub {
  margin-top: 2px;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.profile-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.profile-section__title {
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.severity-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: var(--space-2);
}

.severity-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
  padding: var(--space-3);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
}

.severity-count {
  font-size: var(--font-num-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  line-height: 1.1;
}

.behavior-title {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  margin-bottom: var(--space-1);
}

.behavior-rows {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-1) var(--space-3);
}

.behavior-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  font-size: var(--font-secondary);
  padding: 2px 0;
}

.behavior-label {
  min-width: 0;
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}

.behavior-count {
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}

.history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.history-list {
  max-height: 360px;
  overflow-y: auto;
  padding-right: var(--space-1);
}

.profile-empty {
  font-size: var(--font-secondary);
  color: var(--color-text-tertiary);
}
</style>
