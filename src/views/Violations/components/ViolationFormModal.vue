<script setup lang="ts">
/**
 * 新增 / 编辑违纪事件弹窗（v3.8.1 · Phase 3）。
 *
 * - **取消违纪类型分类**：界面只有「违纪事件 + 严重程度」；旧记录里的 category 不再出现。
 * - 事件选择列表 = 24 条系统预设 + 已有自定义预设 + 「＋ 自定义事件…」；
 * - 系统预设/自定义预设选中后**自动带出默认严重程度**；
 * - 教师可改**本次记录**的严重程度，但默认不会改预设；只有勾选「同时更新默认严重程度」
 *   并在保存成功后，才显式更新自定义预设（系统预设不可通过此入口修改）；
 * - 自定义事件首次保存时自动创建持久化预设（系统同名优先，不重复创建）；
 * - 编辑旧 `other-custom` / 无预设历史记录时，回填原始 `behaviorLabel`，保存后名称不被替换。
 *
 * 新增：学生多选（N 名学生 = N 条独立事件，一次写盘一次广播）。
 */
import { computed, ref, watch } from 'vue'

import {
  AppButton,
  AppField,
  AppInput,
  AppModal,
  AppSegmented,
  AppSelect,
  AppTextarea,
} from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useSemesterStore } from '@/stores/semester'
import { useStudentStore } from '@/stores/student'
import { useTimetableStore } from '@/stores/timetable'
import { useViolationPresetStore } from '@/stores/violationPreset'
import { useViolationStore } from '@/stores/violation'
import { formatDateKey, isDateKey } from '@/utils/date'
import { formatStudentShortName } from '@/utils/student'
import { VIOLATION_SEVERITY_LABELS, findViolationPresetById } from '@/utils/violation'
import {
  VIOLATION_CUSTOM_EVENT_SENTINEL,
  VIOLATION_PERIOD_OPTIONS,
  VIOLATION_SEVERITY_OPTIONS,
  VIOLATION_TIME_SLOT_OPTIONS,
  buildViolationEventOptions,
  selectionForEditingEvent,
  suggestSubjectFor,
  timeSlotDraftForKind,
} from '@/utils/violationUi'
import ViolationStudentPicker from './ViolationStudentPicker.vue'
import type {
  ViolationBatchDraft,
  ViolationCustomPreset,
  ViolationDraft,
  ViolationEvent,
  ViolationPreset,
  ViolationSeverity,
  ViolationTimeSlotKind,
} from '@/types/violation'

const props = defineProps<{
  modelValue: boolean
  /** 传入 = 编辑；不传 = 新增 */
  event?: ViolationEvent
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [count: number, mode: 'create' | 'edit']
}>()

const violationStore = useViolationStore()
const presetStore = useViolationPresetStore()
const studentStore = useStudentStore()
const timetable = useTimetableStore()
const semester = useSemesterStore()
const toast = useToast()

interface FormState {
  /** 事件下拉值：系统预设 id / 自定义预设 id / VIOLATION_CUSTOM_EVENT_SENTINEL */
  presetId: string
  /** 「＋ 自定义事件」输入内容 */
  customBehavior: string
  severity: ViolationSeverity
  date: string
  timeSlotKind: ViolationTimeSlotKind
  periodId: string
  subject: string
  customTimeText: string
  description: string
  teacherNote: string
  parentNote: string
}

const isEdit = computed(() => Boolean(props.event))
const saving = ref(false)
const selectedStudentIds = ref<Set<string>>(new Set())
const editStudentId = ref('')
const form = ref<FormState>(emptyForm())
/** 是否显式把「本次严重程度」写回自定义预设默认值（只对已保存的自定义预设显示） */
const updatePresetDefault = ref(false)

const activeStudents = computed(() => studentStore.activeStudents)
const nameCounts = computed(() => studentStore.nameCounts)
const counts = computed(() => violationStore.countByStudent)

const studentOptions = computed(() =>
  studentStore.students.map((student) => ({
    value: student.id,
    label: `${formatStudentShortName(student, nameCounts.value)}${
      student.deletedAt ? '（已退档）' : ''
    }`,
  })),
)

const presetOptions = computed(() => buildViolationEventOptions(presetStore.presets))

const selectedSystemPreset = computed<ViolationPreset | undefined>(() =>
  findViolationPresetById(form.value.presetId),
)
const selectedCustomPreset = computed<ViolationCustomPreset | undefined>(() =>
  presetStore.findById(form.value.presetId),
)
const isCustomEntry = computed(() => form.value.presetId === VIOLATION_CUSTOM_EVENT_SENTINEL)

/**
 * 显式更新预设的入口只在「已选中一条自定义预设」且本次严重程度与其默认值不同时出现。
 * 新建自定义事件（输入新名称）用首次选择绑定默认值，不属于「更新」。
 */
const canUpdatePresetDefault = computed(
  () =>
    Boolean(selectedCustomPreset.value) &&
    form.value.severity !== selectedCustomPreset.value!.defaultSeverity,
)

const selectedCount = computed(() => selectedStudentIds.value.size)

const severityOptions = VIOLATION_SEVERITY_OPTIONS

function emptyForm(): FormState {
  return {
    presetId: '',
    customBehavior: '',
    severity: 'minor',
    date: formatDateKey(new Date()),
    timeSlotKind: 'forenoon',
    periodId: '',
    subject: '',
    customTimeText: '',
    description: '',
    teacherNote: '',
    parentNote: '',
  }
}

function resetFromEvent(event: ViolationEvent | undefined): void {
  // 每次打开都重新允许提交；关闭动画/下一帧期间保持 saving，防止双击重复写入
  saving.value = false
  selectedStudentIds.value = new Set()
  editStudentId.value = event?.studentId ?? ''
  updatePresetDefault.value = false
  if (!event) {
    form.value = emptyForm()
    return
  }

  // 回填规则统一在 `selectionForEditingEvent`（可单测）：
  // 系统/自定义预设回填下拉，旧 other-custom / 无预设历史文本回填原始 behaviorLabel；
  // severity 永远取历史记录的值，不按当前预设重算。
  const selection = selectionForEditingEvent(event, presetStore.presets)
  form.value = {
    presetId: selection.presetId,
    customBehavior: selection.customBehavior,
    severity: selection.severity,
    date: event.date,
    timeSlotKind: event.timeSlotKind,
    periodId: event.periodId ?? '',
    subject: event.subject ?? '',
    customTimeText: event.customTimeText ?? '',
    description: event.description ?? '',
    teacherNote: event.teacherNote ?? '',
    parentNote: event.parentNote ?? '',
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) resetFromEvent(props.event)
  },
)

/* ---------- 联动 ---------- */

/** 选事件：系统/自定义预设自动带出默认严重程度；切换到自定义输入时保留当前严重程度 */
function onPresetChange(presetId: string): void {
  form.value.presetId = presetId
  updatePresetDefault.value = false
  if (presetId === VIOLATION_CUSTOM_EVENT_SENTINEL) return

  const custom = presetStore.findById(presetId)
  if (custom) {
    form.value.customBehavior = ''
    form.value.severity = custom.defaultSeverity
    return
  }
  const system = findViolationPresetById(presetId)
  if (system) {
    form.value.customBehavior = ''
    form.value.severity = system.defaultSeverity
  }
}

function onTimeSlotKindChange(kind: ViolationTimeSlotKind): void {
  const next = timeSlotDraftForKind(kind, {
    timeSlotKind: kind,
    ...(form.value.periodId ? { periodId: form.value.periodId as never } : {}),
    ...(form.value.customTimeText ? { customTimeText: form.value.customTimeText } : {}),
    ...(form.value.subject ? { subject: form.value.subject } : {}),
  })
  form.value.timeSlotKind = next.timeSlotKind
  form.value.periodId = next.periodId ?? ''
  form.value.subject = next.subject ?? ''
  form.value.customTimeText = next.customTimeText ?? ''
  if (kind === 'period') {
    if (!form.value.periodId) form.value.periodId = VIOLATION_PERIOD_OPTIONS[0]?.value ?? ''
    refreshSubjectSuggestion()
  }
}

function refreshSubjectSuggestion(): void {
  if (form.value.timeSlotKind !== 'period' || !form.value.periodId) {
    form.value.subject = ''
    return
  }
  const week = semester.weekOf(form.value.date)
  const suggested = suggestSubjectFor(
    timetable.weekView(week).lessons,
    form.value.date,
    form.value.periodId as never,
  )
  form.value.subject = suggested ?? ''
}

function onDateChange(): void {
  if (form.value.timeSlotKind === 'period') refreshSubjectSuggestion()
}

function onPeriodChange(): void {
  refreshSubjectSuggestion()
}

/* ---------- 提交 ---------- */

interface ResolvedPresetFields {
  presetId?: string
  presetKind?: 'system' | 'custom'
  behaviorLabel: string
}

/**
 * 把当前选择解析成事件里要落库的预设字段。
 *
 * - 系统/自定义预设直接取 id + label；
 * - 自定义输入：**系统预设优先 → 已有自定义 → 新建自定义**（去重规则在 Store，唯一入口）；
 * - 新建自定义预设会把「本次严重程度」绑定为首次 defaultSeverity。
 */
function resolvePresetFields(): ResolvedPresetFields | null {
  const presetId = form.value.presetId

  if (presetId && presetId !== VIOLATION_CUSTOM_EVENT_SENTINEL) {
    const system = findViolationPresetById(presetId)
    if (system) {
      return { presetId: system.id, presetKind: 'system', behaviorLabel: system.label }
    }
    const custom = presetStore.findById(presetId)
    if (custom) {
      return { presetId: custom.id, presetKind: 'custom', behaviorLabel: custom.label }
    }
    toast.danger('所选违纪事件已不存在，请重新选择或输入')
    return null
  }

  const label = form.value.customBehavior.trim()
  if (!label) {
    toast.danger('请选择或填写违纪事件')
    return null
  }
  const resolved = presetStore.resolveForSave(label, form.value.severity)
  if (resolved.kind === 'system') {
    return {
      presetId: resolved.preset.id,
      presetKind: 'system',
      behaviorLabel: resolved.preset.label,
    }
  }
  return {
    presetId: resolved.preset.id,
    presetKind: 'custom',
    behaviorLabel: resolved.preset.label,
  }
}

function buildDraft(): ViolationDraft | null {
  const current = form.value
  const presetFields = resolvePresetFields()
  if (!presetFields) return null

  if (!isDateKey(current.date)) {
    toast.danger('请选择正确的发生日期')
    return null
  }
  if (current.timeSlotKind === 'period' && !current.periodId) {
    toast.danger('请选择第几节课')
    return null
  }
  if (current.timeSlotKind === 'custom' && !current.customTimeText.trim()) {
    toast.danger('请填写自定义时间')
    return null
  }
  const periodLabel =
    current.timeSlotKind === 'period'
      ? VIOLATION_PERIOD_OPTIONS.find((option) => option.value === current.periodId)?.label
      : undefined
  return {
    studentId: '',
    date: current.date,
    timeSlotKind: current.timeSlotKind,
    ...(current.timeSlotKind === 'period'
      ? {
          periodId: current.periodId as never,
          ...(periodLabel ? { periodLabel } : {}),
          ...(current.subject.trim() ? { subject: current.subject.trim() } : {}),
        }
      : {}),
    ...(current.timeSlotKind === 'custom' ? { customTimeText: current.customTimeText.trim() } : {}),
    ...presetFields,
    severity: current.severity,
    ...(current.description.trim() ? { description: current.description.trim() } : {}),
    ...(current.teacherNote.trim() ? { teacherNote: current.teacherNote.trim() } : {}),
    ...(current.parentNote.trim() ? { parentNote: current.parentNote.trim() } : {}),
  }
}

/**
 * 事件写盘成功后，若教师勾选了「同时更新默认严重程度」，才更新自定义预设。
 * **顺序是刻意的**：取消保存 / 保存失败都不会提前改持久化预设。
 * 历史事件不会被批量改写——这里只改预设对象本身。
 */
function applyPresetDefaultUpdate(): void {
  if (!updatePresetDefault.value) return
  const preset = selectedCustomPreset.value
  if (!preset) return
  if (preset.defaultSeverity === form.value.severity) return
  presetStore.updateDefaultSeverity(preset.id, form.value.severity)
}

async function submit(): Promise<void> {
  if (saving.value) return
  const draft = buildDraft()
  if (!draft) return

  saving.value = true
  // 成功路径刻意不复位 saving：弹窗关闭是异步 DOM 更新，同一帧内第二次 click 仍可能进来；
  // 保持 true 直到下次打开 resetFromEvent()，双击只写一次。
  let succeeded = false
  try {
    if (isEdit.value && props.event) {
      const patch: Partial<ViolationDraft> = {
        ...draft,
        studentId: editStudentId.value,
        // 空串 = 清空该可选字段（数据层会把空串折成"删除该键"）
        description: form.value.description.trim(),
        teacherNote: form.value.teacherNote.trim(),
        parentNote: form.value.parentNote.trim(),
        subject: form.value.timeSlotKind === 'period' ? form.value.subject.trim() : '',
      }
      const updated = violationStore.updateViolation(props.event.id, patch)
      if (!updated) {
        toast.danger('保存失败，请检查填写内容后重试')
        return
      }
      applyPresetDefaultUpdate()
      succeeded = true
      emit('saved', 1, 'edit')
      emit('update:modelValue', false)
      return
    }

    if (selectedCount.value === 0) {
      toast.danger('请至少选择一名学生')
      return
    }
    const { studentId: _studentId, ...batchDraft } = draft
    void _studentId
    const created = violationStore.addViolationsForStudents(
      [...selectedStudentIds.value],
      batchDraft as ViolationBatchDraft,
    )
    if (created.length === 0) {
      toast.danger('保存失败：没有写入任何记录，请检查填写内容')
      return
    }
    applyPresetDefaultUpdate()
    succeeded = true
    emit('saved', created.length, 'create')
    emit('update:modelValue', false)
  } finally {
    if (!succeeded) saving.value = false
  }
}

function close(): void {
  emit('update:modelValue', false)
}
</script>

<template>
  <AppModal
    :model-value="modelValue"
    :title="isEdit ? '编辑违纪记录' : '新增违纪记录'"
    :width="720"
    @update:model-value="close"
  >
    <div class="form">
      <!-- 学生 -->
      <section class="form-section">
        <h3 class="form-section__title">学生</h3>
        <ViolationStudentPicker
          v-if="!isEdit"
          :students="activeStudents"
          :counts="counts"
          :name-counts="nameCounts"
          :model-value="selectedStudentIds"
          :disabled="saving"
          @update:model-value="selectedStudentIds = $event"
        />
        <AppField v-else label="关联学生" hint="修改学生关联会同时改 studentId 与姓名快照">
          <AppSelect v-model="editStudentId" :options="studentOptions" :disabled="saving" />
        </AppField>
        <p v-if="!isEdit" class="form-hint">
          一次保存会为每名选中学生各生成一条独立违纪事件（共
          {{ selectedCount }} 条）。
        </p>
      </section>

      <!-- 违纪事件 + 严重程度（v3.8.1：不再有分类） -->
      <section class="form-section">
        <h3 class="form-section__title">违纪事件</h3>
        <AppField label="违纪事件" required hint="系统预设优先；也可直接输入自定义事件">
          <AppSelect
            :model-value="form.presetId"
            :options="presetOptions"
            placeholder="选择或输入违纪事件"
            :disabled="saving"
            @update:model-value="onPresetChange($event as string)"
          />
        </AppField>

        <AppField v-if="isCustomEntry" label="自定义事件名称" required>
          <AppInput
            v-model="form.customBehavior"
            placeholder="例如：课堂上擅自离开座位"
            :disabled="saving"
            :maxlength="40"
          />
          <p class="form-hint form-hint--tight">
            首次保存会记住这个事件与本次严重程度，下次可直接选择，无需再选严重程度。
          </p>
        </AppField>

        <p v-if="selectedSystemPreset" class="preset-hint">
          系统预设「{{ selectedSystemPreset.label }}」默认严重程度：
          {{ VIOLATION_SEVERITY_LABELS[selectedSystemPreset.defaultSeverity] }}（可改本次记录，
          系统预设本身不会变）。
        </p>
        <p v-else-if="selectedCustomPreset" class="preset-hint">
          自定义事件「{{ selectedCustomPreset.label }}」默认严重程度：
          {{ VIOLATION_SEVERITY_LABELS[selectedCustomPreset.defaultSeverity] }}（可改本次记录）。
        </p>

        <AppField label="严重程度" hint="每条事件独立保存；只作标签，不折算次数、不扣分">
          <AppSegmented
            :model-value="form.severity"
            :options="severityOptions"
            label="严重程度"
            @update:model-value="form.severity = $event as ViolationSeverity"
          />
        </AppField>

        <label v-if="canUpdatePresetDefault" class="preset-update">
          <input v-model="updatePresetDefault" type="checkbox" class="preset-update__box" />
          <span>
            同时更新「{{ selectedCustomPreset?.label }}」的默认严重程度为
            {{ VIOLATION_SEVERITY_LABELS[form.severity] }}
            <span class="preset-update__note">
              （影响以后的新记录；历史记录与本次记录之外的记录不会被改动）
            </span>
          </span>
        </label>
      </section>

      <!-- 时间 -->
      <section class="form-section">
        <h3 class="form-section__title">发生时间</h3>
        <div class="form-grid">
          <AppField label="发生日期" required>
            <AppInput
              v-model="form.date"
              type="date"
              :disabled="saving"
              @update:model-value="onDateChange"
            />
          </AppField>
          <AppField label="时间段" required>
            <AppSelect
              :model-value="form.timeSlotKind"
              :options="VIOLATION_TIME_SLOT_OPTIONS"
              :disabled="saving"
              @update:model-value="onTimeSlotKindChange($event as ViolationTimeSlotKind)"
            />
          </AppField>
        </div>

        <div v-if="form.timeSlotKind === 'period'" class="form-grid">
          <AppField label="第几节课" required>
            <AppSelect
              v-model="form.periodId"
              :options="VIOLATION_PERIOD_OPTIONS"
              :disabled="saving"
              @update:model-value="onPeriodChange"
            />
          </AppField>
          <AppField label="科目" hint="优先按课程表带出；可手动填写">
            <AppInput
              v-model="form.subject"
              placeholder="如：数学"
              :disabled="saving"
              :maxlength="20"
            />
          </AppField>
        </div>

        <AppField
          v-if="form.timeSlotKind === 'custom'"
          label="自定义时间"
          required
          hint="例如：午休期间 / 课间十分钟"
        >
          <AppInput
            v-model="form.customTimeText"
            placeholder="填写具体时间或时间描述"
            :disabled="saving"
            :maxlength="30"
          />
        </AppField>

        <p class="form-hint">
          日期与时间段分开保存；当前严重程度：{{ VIOLATION_SEVERITY_LABELS[form.severity] }}
        </p>
      </section>

      <!-- 备注（教师 / 家长严格分开） -->
      <section class="form-section">
        <h3 class="form-section__title">备注</h3>
        <AppField label="事件描述" hint="可选">
          <AppTextarea
            v-model="form.description"
            :rows="2"
            :disabled="saving"
            placeholder="发生了什么"
          />
        </AppField>
        <AppField label="教师备注" hint="可选，仅教师可见">
          <AppTextarea
            v-model="form.teacherNote"
            :rows="2"
            :disabled="saving"
            placeholder="处理过程 / 提醒记录"
          />
        </AppField>
        <AppField label="家长处理意见" hint="可选，与教师备注分开保存；可稍后补充">
          <AppTextarea
            v-model="form.parentNote"
            :rows="2"
            :disabled="saving"
            placeholder="家长反馈 / 沟通结果"
          />
        </AppField>
      </section>
    </div>

    <template #footer>
      <AppButton variant="ghost" :disabled="saving" @click="close">取消</AppButton>
      <AppButton :loading="saving" @click="submit">
        {{ isEdit ? '保存修改' : `保存 ${selectedCount} 条记录` }}
      </AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

.form-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.form-section__title {
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  padding-bottom: var(--space-1);
  border-bottom: 1px solid var(--color-border-light);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

.form-hint {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  line-height: var(--leading-relaxed);
}

.form-hint--tight {
  margin-top: var(--space-1);
}

.preset-hint {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--color-bg-subtle);
  font-size: var(--font-caption);
  line-height: var(--leading-relaxed);
  color: var(--color-text-secondary);
}

/* 「同时更新预设默认严重程度」：与「改本次」在视觉上分开，避免误以为是同一件事 */
.preset-update {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-warning-soft-strong);
  border-radius: var(--radius-sm);
  background: var(--color-warning-soft);
  font-size: var(--font-caption);
  line-height: var(--leading-relaxed);
  color: var(--color-warning-strong);
  cursor: pointer;
}

.preset-update__box {
  margin-top: 2px;
  accent-color: var(--color-primary);
  cursor: pointer;
}

.preset-update__note {
  display: block;
  color: var(--color-text-secondary);
  font-weight: 400;
}

@media (max-width: 640px) {
  .form-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
