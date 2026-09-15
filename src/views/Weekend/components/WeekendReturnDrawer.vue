<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { AppBadge, AppButton, AppDrawer, AppField, AppInput } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useNow } from '@/composables/useToday'
import { useStudentStore } from '@/stores/student'
import { useWeekendStore } from '@/stores/weekend'
import { formatDateKey } from '@/utils/date'
import { formatStudentShortName } from '@/utils/student'
import { currentWeekendKey, formatWeekendLabel, weekendKeyOf } from '@/utils/weekend'

interface Props {
  modelValue: boolean
  /**
   * 打开时预填的周末（页面正在看的那一期，周六键）。缺省回落到本周末。
   * **必须跟着页面走**：登记成功后页面会跳到刚登记的那一期，抽屉若固定回落到本周末，
   * 教师再点「登记返家」时默认日期与眼前的名单就不是同一期了（§9.17 审查修复）。
   */
  defaultWeekendKey?: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  submit: [payload: { weekendKey: string; studentIds: string[] }]
}>()

const toast = useToast()
const studentStore = useStudentStore()
const weekendStore = useWeekendStore()
const now = useNow()

/** 表单里填的原始日期；落库前经 `weekendKeyOf` 归到该周周六 */
const weekendDate = ref('')
const selected = ref<Set<string>>(new Set())
const keyword = ref('')
const error = ref('')

/** 候选名单：在读学生，按学号升序（花名册顺序） */
const students = computed(() =>
  [...studentStore.activeStudents].sort((a, b) => a.studentNo.localeCompare(b.studentNo)),
)

/** 填的日期归到哪个周末；周一~周五返回 undefined（提示教师改） */
const weekendKey = computed(() => weekendKeyOf(weekendDate.value))

/**
 * 已登记过的人：勾选框置为已选且禁用（一条记录只对应一个学生一个周末）。
 * 判定取自 store 的 `registeredIdsOf` 而非本组件再数一遍——与 `addReturns` 的跳过判定同源，
 * 不会出现「抽屉里能勾、保存时被静默跳过」。
 */
const registeredIds = computed(() =>
  // 日期还没填 / 填在周一~周五时没有周末键，此时「有没有登记过」无从谈起，
  // 一律按「都没登记」处理（提交会被 submit() 的校验拦下，不会走到落库）
  weekendKey.value ? weekendStore.registeredIdsOf(weekendKey.value) : new Set<string>(),
)

const filtered = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  if (!query) return students.value
  return students.value.filter(
    (student) =>
      student.name.toLowerCase().includes(query) || student.studentNo.toLowerCase().includes(query),
  )
})

function toggle(id: string): void {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

/** 换了周末就清空勾选：勾的是「某个周末返家的人」，换一期后原来的勾选不再成立 */
watch(weekendKey, () => {
  selected.value = new Set()
})

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    weekendDate.value = props.defaultWeekendKey ?? currentWeekendKey(formatDateKey(now.value))
    selected.value = new Set()
    keyword.value = ''
    error.value = ''
  },
  { immediate: true },
)

function close(): void {
  emit('update:modelValue', false)
}

/**
 * 提交：这里**不关抽屉**——关不关由页面按写入结果决定。
 * 一条也没选中时留在原处并提示，避免教师以为登记好了其实是空提交。
 */
function submit(): void {
  if (!weekendDate.value) {
    error.value = '请选择日期'
    return
  }
  if (!weekendKey.value) {
    error.value = '请选择周六或周日（周末按该周周六登记）'
    return
  }
  error.value = ''
  if (selected.value.size === 0) {
    toast.danger('请至少勾选一位返家的学生')
    return
  }
  // 按名单顺序（学号升序）落库，登记顺序稳定可预期
  const studentIds = students.value.filter((item) => selected.value.has(item.id)).map((i) => i.id)
  emit('submit', { weekendKey: weekendKey.value, studentIds })
}
</script>

<template>
  <AppDrawer :model-value="modelValue" title="登记返家" :width="480" @update:model-value="close">
    <!-- 表单仅作语义分组：保存 / 取消在抽屉 footer（表单外的兄弟节点） -->
    <form class="weekend-form" @submit.prevent>
      <AppField label="日期" required :error="error" hint="填周六或周日均可，按该周周六登记">
        <AppInput v-model="weekendDate" type="date" :error="!!error" />
      </AppField>

      <p v-if="weekendKey" class="weekend-line">
        登记为 <strong>{{ formatWeekendLabel(weekendKey) }}</strong> 的返家记录
      </p>

      <AppField label="返家的学生" :hint="`已选 ${selected.size} 人（点名字勾选 / 取消）`">
        <div class="picker">
          <AppInput v-model="keyword" placeholder="搜索姓名或学号" clearable size="sm" />
          <ul class="picker-list">
            <li v-for="student in filtered" :key="student.id">
              <label
                class="picker-item"
                :class="{
                  'is-selected': selected.has(student.id),
                  'is-locked': registeredIds.has(student.id),
                }"
              >
                <input
                  type="checkbox"
                  class="picker-box"
                  :checked="selected.has(student.id) || registeredIds.has(student.id)"
                  :disabled="registeredIds.has(student.id)"
                  @change="toggle(student.id)"
                />
                <span class="picker-name">{{
                  formatStudentShortName(student, studentStore.nameCounts)
                }}</span>
                <AppBadge v-if="registeredIds.has(student.id)" variant="neutral" size="sm">
                  已登记
                </AppBadge>
              </label>
            </li>
          </ul>
          <p v-if="filtered.length === 0" class="picker-empty">没有匹配的学生。</p>
        </div>
      </AppField>
    </form>

    <template #footer>
      <AppButton variant="ghost" @click="close">取消</AppButton>
      <AppButton @click="submit">保存</AppButton>
    </template>
  </AppDrawer>
</template>

<style scoped>
.weekend-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.weekend-line {
  margin-top: calc(var(--space-2) * -1);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.weekend-line strong {
  color: var(--color-text);
}

.picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.picker-list {
  max-height: 300px;
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
  /* 触控目标 ≥44px：与值日组员选择同口径，手机上好点 */
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

/* 已登记：勾选框禁用，整行不再有悬停反馈，避免教师以为是可点的 */
.picker-item.is-locked {
  cursor: default;
  opacity: 0.7;
}

.picker-item.is-locked:hover {
  background: transparent;
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
</style>
