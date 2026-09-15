<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { AppBadge, AppButton, AppField, AppInput, AppModal } from '@/components/ui'
import { defaultDutyGroupName } from '@/utils/duty'
import { buildNameCounts, formatStudentShortName } from '@/utils/student'
import type { Student } from '@/types'
import type { DutyGroup } from '@/types/duty'

interface Props {
  modelValue: boolean
  /** 编辑的组；undefined = 新建 */
  group?: DutyGroup
  /** 可选学生：在读优先、学号升序（页面排好）；含已不在档案的，会在行内标出 */
  students: Student[]
  /** 在读学生 id（用于标注「已不在档案」） */
  activeIds: string[]
  /** 现有值日组（标注「已在第 N 组」，并据此给出新建组的默认名） */
  groups: DutyGroup[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  submit: [payload: { name: string; studentIds: string[] }]
}>()

const name = ref('')
const selected = ref<Set<string>>(new Set())
const keyword = ref('')

/** 重名消歧计数：候选名单就是这份 `students`（v3.3.1） */
const nameCounts = computed(() => buildNameCounts(props.students))

const activeIdSet = computed(() => new Set(props.activeIds))
const studentIdSet = computed(() => new Set(props.students.map((student) => student.id)))

/**
 * 组里引用了**档案里根本找不到**的学生 id（别的设备导入的备份）：候选名单里没有他们，
 * 但也不能因此悄悄丢掉——「已选 N 人」与实际保存的人数对不上是更糟的坑。
 * 他们在列表最前面单独列出（勾选自选组原顺序），教师取消勾选即可移除。
 */
const ghostIds = computed(() => [...selected.value].filter((id) => !studentIdSet.value.has(id)))

/** 学生 id → 他所在的**其他**值日组名（同一学生可在多组；只提示不拦截，§11.5） */
const otherGroupOf = computed(() => {
  const map = new Map<string, string>()
  for (const group of props.groups) {
    if (group.id === props.group?.id) continue
    for (const id of group.studentIds) {
      if (!map.has(id)) map.set(id, group.name)
    }
  }
  return map
})

const filtered = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  if (!query) return props.students
  return props.students.filter(
    (student) =>
      student.name.toLowerCase().includes(query) || student.studentNo.toLowerCase().includes(query),
  )
})

const selectedInOtherGroups = computed(() =>
  [...selected.value].filter((id) => otherGroupOf.value.has(id)),
)

function isActive(id: string): boolean {
  return activeIdSet.value.has(id)
}

function toggle(id: string): void {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

/** 打开时按「新建 / 编辑」重置表单：不保留上一次的输入，避免串组 */
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    name.value = props.group ? props.group.name : defaultDutyGroupName(props.groups.length)
    selected.value = new Set(props.group?.studentIds ?? [])
    keyword.value = ''
  },
  { immediate: true },
)

function onSubmit(): void {
  const trimmed = name.value.trim()
  if (!trimmed) return
  // 按列表顺序（学号升序）落库，组员顺序稳定可预期；档案里找不到的 id 原样保留在末尾
  const studentIds = [
    ...props.students.filter((student) => selected.value.has(student.id)).map((s) => s.id),
    ...ghostIds.value,
  ]
  emit('submit', { name: trimmed, studentIds })
}
</script>

<template>
  <AppModal
    :model-value="modelValue"
    :title="group ? '编辑值日组' : '新建值日组'"
    :width="520"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="form-body">
      <AppField label="组名" required>
        <AppInput v-model="name" placeholder="如：第 1 组" :maxlength="20" />
      </AppField>

      <AppField label="组员" :hint="`已选 ${selected.size} 人（点名字勾选 / 取消）`">
        <div class="picker">
          <AppInput v-model="keyword" placeholder="搜索姓名或学号" clearable size="sm" />
          <ul class="picker-list">
            <li v-for="id in ghostIds" :key="id">
              <label class="picker-item is-selected">
                <input type="checkbox" class="picker-box" :checked="true" @change="toggle(id)" />
                <span class="picker-name">未知学生</span>
                <AppBadge variant="warning" size="sm">档案里找不到</AppBadge>
              </label>
            </li>
            <li v-for="student in filtered" :key="student.id">
              <label class="picker-item" :class="{ 'is-selected': selected.has(student.id) }">
                <input
                  type="checkbox"
                  class="picker-box"
                  :checked="selected.has(student.id)"
                  @change="toggle(student.id)"
                />
                <span class="picker-name">{{ formatStudentShortName(student, nameCounts) }}</span>
                <AppBadge v-if="!isActive(student.id)" variant="warning" size="sm">
                  已不在档案
                </AppBadge>
                <AppBadge v-if="otherGroupOf.get(student.id)" variant="neutral" size="sm">
                  已在{{ otherGroupOf.get(student.id) }}
                </AppBadge>
              </label>
            </li>
          </ul>
          <p v-if="filtered.length === 0" class="picker-empty">没有匹配的学生。</p>
        </div>
      </AppField>

      <p v-if="ghostIds.length" class="ghost-note">
        其中有 {{ ghostIds.length }} 人在学生档案里找不到（多半是别的设备导入的备份）。
        保存时会原样保留这些人；要移除就取消勾选。
      </p>

      <p v-if="selectedInOtherGroups.length" class="other-group-note">
        其中 {{ selectedInOtherGroups.length }} 人已在其他值日组——保存后他们会同时出现在多个组，
        请确认这是你要的排法。
      </p>
    </div>

    <template #footer>
      <AppButton variant="ghost" @click="emit('update:modelValue', false)">取消</AppButton>
      <AppButton :disabled="!name.trim()" @click="onSubmit">
        {{ group ? '保存' : '创建' }}
      </AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.form-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.picker-list {
  max-height: 260px;
  overflow-y: auto;
  padding: 0;
  margin: 0;
  list-style: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.picker-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  /* 触控目标 ≥44px：与工作清单的统计卡同口径，手机上好点 */
  padding: var(--space-3) var(--space-3);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.picker-item:hover {
  background: var(--color-fill-disabled);
}

.picker-item.is-selected {
  background: var(--color-primary-soft);
}

.picker-box {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  accent-color: var(--color-primary);
  cursor: pointer;
}

.picker-name {
  flex: 1;
  font-size: var(--text-md);
  color: var(--color-text);
}

.picker-empty {
  padding: var(--space-3);
  font-size: var(--text-sm);
  color: var(--color-text-faint);
}

.ghost-note,
.other-group-note {
  font-size: var(--text-sm);
  line-height: 1.7;
  color: var(--color-warning-strong);
}
</style>
