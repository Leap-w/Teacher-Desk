<script setup lang="ts">
/**
 * 违纪记录的学生多选器。
 *
 * 支持：按姓名搜索、按累计违纪次数排序（默认）、性别筛选、全选男生 / 全选女生、
 * 按宿舍一键选择、手动勾选/取消、清空；快捷选择与手动选择**可组合**。
 *
 * 累计次数由页面从 Store 的 `countByStudent` 传入，这里不另算。
 */
import { computed, ref } from 'vue'

import { AppBadge, AppButton, AppField, AppInput, AppSelect } from '@/components/ui'
import {
  addStudentsByDormitory,
  addStudentsByGender,
  addStudentsToSelection,
  buildDormitoryQuickOptions,
  buildViolationPickerRows,
  clearStudentSelection,
  toggleStudentSelection,
} from '@/utils/violationUi'
import type { Gender, Student } from '@/types'

const props = defineProps<{
  students: Student[]
  counts: ReadonlyMap<string, number>
  nameCounts: ReadonlyMap<string, number>
  modelValue: ReadonlySet<string>
  /** 已选人数上限提示（不限制保存，仅用于文案） */
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: Set<string>] }>()

const keyword = ref('')
const genderFilter = ref<'all' | Gender>('all')
const dormitory = ref('')
/** 是否已经选过宿舍（空串代表「未分配」，是有效选项，不能用 falsy 判断） */
const dormitoryChosen = ref(false)

const rows = computed(() =>
  buildViolationPickerRows(props.students, props.counts, {
    keyword: keyword.value,
    gender: genderFilter.value === 'all' ? null : genderFilter.value,
    nameCounts: props.nameCounts,
  }),
)

const dormitoryOptions = computed(() =>
  buildDormitoryQuickOptions(props.students).map((option) => ({
    value: option.value,
    label: `${option.label}（${option.count} 人）`,
    disabled: option.count === 0,
  })),
)

const selectedCount = computed(() => props.modelValue.size)

function apply(next: Set<string>): void {
  emit('update:modelValue', next)
}

function toggle(studentId: string): void {
  apply(toggleStudentSelection(props.modelValue, studentId))
}

function selectGender(gender: Gender): void {
  apply(addStudentsByGender(props.modelValue, props.students, gender))
}

function onDormitoryChange(value: string): void {
  dormitory.value = value
  dormitoryChosen.value = true
}

function selectDormitory(): void {
  if (!dormitoryChosen.value) return
  apply(addStudentsByDormitory(props.modelValue, props.students, dormitory.value))
}

function selectVisible(): void {
  apply(
    addStudentsToSelection(
      props.modelValue,
      rows.value.map((row) => row.student),
    ),
  )
}

function clearAll(): void {
  apply(clearStudentSelection())
}
</script>

<template>
  <div class="picker">
    <div class="picker-toolbar">
      <AppField label="按姓名搜索" class="picker-search">
        <AppInput
          v-model="keyword"
          placeholder="姓名 / 学号 / 身份证尾号"
          :disabled="disabled"
          clearable
        />
      </AppField>
      <AppField label="性别筛选">
        <AppSelect
          :model-value="genderFilter"
          :options="[
            { label: '全部', value: 'all' },
            { label: '男生', value: 'male' },
            { label: '女生', value: 'female' },
          ]"
          :disabled="disabled"
          @update:model-value="genderFilter = $event as 'all' | Gender"
        />
      </AppField>
    </div>

    <div class="picker-quick" role="group" aria-label="快捷选择">
      <AppButton size="sm" variant="secondary" :disabled="disabled" @click="selectGender('male')">
        全选男生
      </AppButton>
      <AppButton size="sm" variant="secondary" :disabled="disabled" @click="selectGender('female')">
        全选女生
      </AppButton>
      <div class="picker-dorm">
        <AppSelect
          :model-value="dormitory"
          :options="dormitoryOptions"
          placeholder="选择宿舍"
          size="sm"
          :disabled="disabled"
          @update:model-value="onDormitoryChange($event)"
        />
        <AppButton
          size="sm"
          variant="secondary"
          :disabled="disabled || !dormitory"
          @click="selectDormitory"
        >
          全选该宿舍
        </AppButton>
      </div>
      <AppButton size="sm" variant="ghost" :disabled="disabled" @click="selectVisible">
        全选当前筛选
      </AppButton>
      <AppButton
        size="sm"
        variant="ghost"
        :disabled="disabled || selectedCount === 0"
        @click="clearAll"
      >
        清空选择
      </AppButton>
    </div>

    <p class="picker-summary">
      已选 <strong>{{ selectedCount }}</strong> 人
      <span class="picker-hint">（可先用快捷方式选一批，再手动补选或取消）</span>
    </p>

    <ul v-if="rows.length" class="picker-list" aria-label="学生名单">
      <li v-for="row in rows" :key="row.student.id">
        <label class="picker-row" :class="{ 'is-selected': modelValue.has(row.student.id) }">
          <input
            type="checkbox"
            class="picker-check"
            :checked="modelValue.has(row.student.id)"
            :disabled="disabled"
            @change="toggle(row.student.id)"
          />
          <span class="picker-name">{{ row.displayName }}</span>
          <AppBadge variant="neutral" size="sm">{{ row.genderLabel }}</AppBadge>
          <span class="picker-dorm-label">{{ row.dormitoryLabel }}</span>
          <AppBadge :variant="row.count > 0 ? 'warning' : 'neutral'" size="sm">
            违纪 {{ row.count }} 次
          </AppBadge>
        </label>
      </li>
      <li v-if="rows.length === 0" class="picker-empty">没有匹配的学生。</li>
    </ul>
    <p v-else class="picker-empty">没有匹配的学生。</p>
  </div>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.picker-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 140px;
  gap: var(--space-3);
  align-items: end;
}

.picker-search {
  min-width: 0;
}

.picker-quick {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.picker-dorm {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
}

.picker-summary {
  font-size: var(--font-secondary);
  color: var(--color-text-secondary);
}

.picker-summary strong {
  color: var(--color-text-primary);
  font-weight: var(--font-weight-semibold);
}

.picker-hint {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.picker-list {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  padding: var(--space-1);
  background: var(--color-bg-white);
}

.picker-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 40px;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--font-secondary);
  color: var(--color-text-primary);
}

.picker-row:hover {
  background: var(--color-primary-bg);
}

.picker-row.is-selected {
  background: var(--color-primary-bg-active);
}

.picker-check {
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--color-primary);
  flex-shrink: 0;
}

.picker-name {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.picker-dorm-label {
  min-width: 84px;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  text-align: right;
}

.picker-empty {
  padding: var(--space-3);
  font-size: var(--font-secondary);
  color: var(--color-text-tertiary);
}

@media (max-width: 640px) {
  .picker-toolbar {
    grid-template-columns: minmax(0, 1fr);
  }

  .picker-dorm-label {
    display: none;
  }

  /* 宿舍下拉 + 「全选该宿舍」在手机上纵向排开，避免按钮文字被挤成两行 */
  .picker-dorm {
    width: 100%;
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
