<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'

import { AppButton, AppField, AppInput, AppModal, AppSelect } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { runLockedOperation } from '@/composables/useOperationLock'
import { useStudentStore } from '@/stores/student'
import { ALL_DORMITORIES, CADRE_CUSTOM, CADRE_OPTIONS } from '@/utils/student'
import { splitTagInput } from '@/utils/studentBatch'
import type { StudentBatchChanges } from '@/utils/studentBatch'
import type { SelectOption, Student } from '@/types'

interface Props {
  modelValue: boolean
  /** 本次要修改的学生（父组件按选中 id 解析好传进来，顺序即列表顺序） */
  students?: Student[]
}

const props = withDefaults(defineProps<Props>(), {
  students: () => [],
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** 已落库（无论是否真的改动了数据），父组件据此清空选中集合 */
  applied: []
}>()

const studentStore = useStudentStore()
const toast = useToast()

/**
 * 三个哨兵值，**都不会作为字段值写进模型**——它们表达的是「这次怎么处置这个字段」。
 * 之所以需要它们：批量修改必须能区分「不修改」与「清空」，
 * 如果拿空串表示「不修改」，那教师就永远批量清不掉一个字段（Phase 5A 的技术债 #20 就是这个形状）。
 */
const DORMITORY_UNCHANGED = '__unchanged__'
const CADRE_UNCHANGED = '__unchanged__'
const CADRE_CLEAR = '__clear__'

/**
 * 宿舍：不修改 / 未分配（清空）/ 全部 8 间。
 * **列出全部 8 间而不是按性别收窄**——一次选中的学生可能男女都有，
 * 而选项取决于谁被选中会让人猜不透。性别是否匹配交给落库前的校验去挡，
 * 挡不住的那部分会跳过并报数（见 `utils/studentBatch.ts`）。
 */
const dormitoryChoices: SelectOption<string>[] = [
  { label: '不修改', value: DORMITORY_UNCHANGED },
  { label: '未分配（清空宿舍）', value: '' },
  ...ALL_DORMITORIES.map((room) => ({ label: room, value: room })),
]

/** 班委：不修改 / 清空 / 预设职务 / ＋自定义。预设里的「无」被滤掉——它就是「清空」 */
const cadreChoices: SelectOption<string>[] = [
  { label: '不修改', value: CADRE_UNCHANGED },
  { label: '清空班委', value: CADRE_CLEAR },
  ...CADRE_OPTIONS.filter((option) => option.value !== ''),
]

const form = reactive({
  dormitory: DORMITORY_UNCHANGED,
  cadreRole: CADRE_UNCHANGED,
  cadreCustom: '',
  addTags: '',
})

/** 要从所选学生身上移除的标签 */
const removeTags = ref<string[]>([])

/** 所选学生身上出现过的全部标签——只让教师从真实存在的里面挑，避免删一个不存在的 */
const removableTags = computed(() => {
  const seen = new Set<string>()
  for (const student of props.students) {
    for (const tag of student.tags ?? []) seen.add(tag)
  }
  // 标签是教师自己写的中文（「住校生」「走读」……），同样写明拼音序，
  // 否则排序跟着运行环境的默认 locale 变（本机 zh-CN / CI en-US 会给出两种顺序）
  return [...seen].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
})

const isCustomCadre = computed(() => form.cadreRole === CADRE_CUSTOM)

/** 选了「＋自定义」却什么都没填——这时提交等于把班委清空，多半不是本意 */
const customMissing = computed(() => isCustomCadre.value && !form.cadreCustom.trim())

const addTags = computed(() => splitTagInput(form.addTags))

const hasChanges = computed(
  () =>
    form.dormitory !== DORMITORY_UNCHANGED ||
    form.cadreRole !== CADRE_UNCHANGED ||
    addTags.value.length > 0 ||
    removeTags.value.length > 0,
)

const canSubmit = computed(
  () => hasChanges.value && !customMissing.value && props.students.length > 0,
)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    form.dormitory = DORMITORY_UNCHANGED
    form.cadreRole = CADRE_UNCHANGED
    form.cadreCustom = ''
    form.addTags = ''
    removeTags.value = []
  },
)

function toggleRemoveTag(tag: string) {
  const next = [...removeTags.value]
  const index = next.indexOf(tag)
  if (index === -1) next.push(tag)
  else next.splice(index, 1)
  removeTags.value = next
}

function buildChanges(): StudentBatchChanges {
  const changes: StudentBatchChanges = {}
  if (form.dormitory !== DORMITORY_UNCHANGED) changes.dormitory = form.dormitory
  if (form.cadreRole !== CADRE_UNCHANGED) {
    if (form.cadreRole === CADRE_CLEAR) changes.cadreRole = ''
    else if (form.cadreRole === CADRE_CUSTOM) changes.cadreRole = form.cadreCustom.trim()
    else changes.cadreRole = form.cadreRole
  }
  if (addTags.value.length) changes.addTags = addTags.value
  if (removeTags.value.length) changes.removeTags = removeTags.value
  return changes
}

async function submit() {
  if (!canSubmit.value) return
  const ids = props.students.map((student) => student.id)
  // RC-01 / RC-02：批量修改期间暂停同步，改完这批学生后自动补推一次
  const outcome = await runLockedOperation('student-batch', () =>
    studentStore.applyStudentBatch(ids, buildChanges()),
  )

  if (outcome.updated === 0 && outcome.skipped === 0) {
    toast.info(`所选的 ${ids.length} 名学生无需修改`)
  } else if (outcome.skipped > 0) {
    toast.warning(`已更新 ${outcome.updated} 名，跳过 ${outcome.skipped} 名（性别与所选宿舍不符）`)
  } else {
    toast.success(`已更新 ${outcome.updated} 名学生`)
  }

  emit('applied')
  emit('update:modelValue', false)
}

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <AppModal :model-value="modelValue" title="批量修改" :width="520" @update:model-value="close">
    <p class="batch-hint">将对已选中的 {{ students.length }} 名学生生效。不修改的项保持原样。</p>

    <AppField label="宿舍" hint="只能选该学生性别对应的房间，不符的会跳过">
      <AppSelect v-model="form.dormitory" :options="dormitoryChoices" />
    </AppField>

    <AppField
      label="班委职务"
      :error="customMissing ? '请输入职务名称' : ''"
      hint="选「清空班委」可批量取消"
    >
      <AppSelect v-model="form.cadreRole" :options="cadreChoices" />
      <AppInput v-if="isCustomCadre" v-model="form.cadreCustom" placeholder="输入职务名称" />
    </AppField>

    <AppField label="添加标签" hint="多个标签用逗号分隔，已存在的会自动去重">
      <AppInput v-model="form.addTags" placeholder="如：走读生，体育骨干" />
    </AppField>

    <AppField label="移除标签">
      <p v-if="!removableTags.length" class="batch-empty">所选学生没有任何标签</p>
      <div v-else class="tag-picker">
        <label v-for="tag in removableTags" :key="tag" class="tag-option">
          <input
            type="checkbox"
            class="tag-checkbox"
            :checked="removeTags.includes(tag)"
            @change="toggleRemoveTag(tag)"
          />
          <span>{{ tag }}</span>
        </label>
      </div>
    </AppField>

    <template #footer>
      <AppButton variant="ghost" @click="close">取消</AppButton>
      <AppButton :disabled="!canSubmit" @click="submit">确认修改</AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.batch-hint {
  margin-bottom: var(--space-4);
  padding: var(--space-3);
  background: var(--color-primary-soft);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  color: var(--color-primary-strong);
}

.batch-empty {
  font-size: var(--text-sm);
  color: var(--color-text-faint);
}

.tag-picker {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.tag-option {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast);
}

.tag-option:hover {
  background: var(--color-fill-disabled);
}

.tag-checkbox {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--color-primary);
  cursor: pointer;
}
</style>
