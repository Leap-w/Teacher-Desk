<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { AppButton, AppField, AppInput, AppModal, AppSelect } from '@/components/ui'
import { DUTY_MAX_YEAR, DUTY_MIN_YEAR } from '@/utils/duty'
import { formatMonthDay, weekdayOfDateKey } from '@/utils/date'
import { WEEKDAY_LABELS } from '@/utils/timetable'
import type { DutyGroup } from '@/types/duty'
import type { SelectOption } from '@/types'

/**
 * 按天指定值日组（v3.7.5；v3.7.6 起指定会衔接后续轮换）：给**某一天**单独选一个值日组。
 *
 * 这一天固定为指定组，并成为之后自动轮换的衔接基准；之前的日期、轮换起点与组序都不动。
 * 取消指定后，这一天及其之后按原有轮换与其他仍然有效的指定重新衔接。
 * 组件本身不碰 store（与 DutyGroupEditModal 同款）：日期与组以 props 传入、
 * 选择结果用事件回传，落库与提示由页面负责。
 */
interface Props {
  modelValue: boolean
  /** 正在指定的日期（改动通过 `update:dateKey` 回传，页面据此重算下面两个 id） */
  dateKey: string
  groups: DutyGroup[]
  /** 这一天已指定的组 id（没有 = 还没指定过） */
  assignedGroupId?: string
  /**
   * 这一天**不指定的话**自动轮换到的组 id（已考虑之前其他日期的指定）。
   * 未指定时预选它；已指定时用它说明「取消指定后会回到哪一组」。
   */
  rotationGroupId?: string
  /** 这一天本来因「周末不排」而不值日（指定后会照常排） */
  autoSkippedWeekend?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  assignedGroupId: undefined,
  rotationGroupId: undefined,
  autoSkippedWeekend: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'update:dateKey': [value: string]
  save: [payload: { dateKey: string; groupId: string }]
  /** 取消这一天的指定（回到按轮换自动排） */
  clear: [dateKey: string]
}>()

const selected = ref('')

/** 选项跟着 props 走：组会被改名 / 删除，写死的选项会拿到上一轮的旧名字 */
const groupOptions = computed<SelectOption<string>[]>(() =>
  props.groups.map((group) => ({ label: group.name, value: group.id })),
)

/** 预选：已指定的组优先，其次轮换轮到的组（两者都没有就不预选） */
watch(
  () => [props.modelValue, props.dateKey, props.assignedGroupId, props.rotationGroupId] as const,
  ([open]) => {
    if (!open) return
    selected.value = props.assignedGroupId ?? props.rotationGroupId ?? ''
  },
  { immediate: true },
)

function onDateChange(event: Event): void {
  emit('update:dateKey', String((event.target as HTMLInputElement).value))
}

function onSave(): void {
  if (!selected.value) return
  emit('save', { dateKey: props.dateKey, groupId: selected.value })
}

const assignedGroupName = () =>
  props.groups.find((group) => group.id === props.assignedGroupId)?.name ?? ''

const rotationGroupName = () =>
  props.groups.find((group) => group.id === props.rotationGroupId)?.name ?? ''
</script>

<template>
  <AppModal
    :model-value="modelValue"
    title="按天指定值日组"
    :width="460"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="form-body">
      <AppField label="日期" required>
        <!-- 用 change 而不是 input 提交：日期框敲年份的每个字符都会触发 input，
             每敲一下都要重算一次「这天轮到哪一组」，输入过程会被打断 -->
        <AppInput
          :model-value="dateKey"
          type="date"
          :min="`${DUTY_MIN_YEAR}-01-01`"
          :max="`${DUTY_MAX_YEAR}-12-31`"
          @change="onDateChange"
        />
      </AppField>

      <AppField label="值日组" required>
        <AppSelect
          :model-value="selected || undefined"
          :options="groupOptions"
          :disabled="groups.length === 0"
          :placeholder="groups.length === 0 ? '还没有值日组' : '选择这一天值日的组'"
          @update:model-value="selected = String($event)"
        />
      </AppField>

      <p v-if="dateKey" class="assign-note">
        {{ formatMonthDay(dateKey) }} {{ WEEKDAY_LABELS[weekdayOfDateKey(dateKey)] }}：
        <template v-if="assignedGroupName()">
          已指定为 <strong>{{ assignedGroupName() }}</strong>
          <template v-if="autoSkippedWeekend">（这一天本来不值日，指定后照常值日）。</template>
          <template v-else>（不指定的话，自动轮到{{ rotationGroupName() || '——' }}）。</template>
        </template>
        <template v-else-if="autoSkippedWeekend">
          这一天本来不值日（当前设置为周末不排）；指定后会照常值日，并从指定组衔接之后的轮换。
        </template>
        <template v-else-if="rotationGroupName()">
          不指定的话自动轮到 <strong>{{ rotationGroupName() }}</strong
          >。
        </template>
        <template v-else>这一天还没有排班（多半是还没设置轮换起点）。</template>
      </p>

      <p class="assign-hint">
        指定后这一天固定按指定的组值日，之后的自动轮换会从这一组继续向后衔接；这一天的
        指定<strong>不会改动之前的日期、轮换起点和组序</strong>。点「取消指定」后，这一天
        与之后的日期会按原有轮换和其他仍然有效的指定重新衔接。
      </p>
    </div>

    <template #footer>
      <AppButton v-if="assignedGroupId" variant="ghost" @click="emit('clear', dateKey)">
        取消指定
      </AppButton>
      <AppButton variant="ghost" @click="emit('update:modelValue', false)">取消</AppButton>
      <AppButton :disabled="!selected || groups.length === 0" @click="onSave">保存</AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.form-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.assign-note {
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-fill-disabled);
  font-size: var(--text-sm);
  line-height: 1.7;
  color: var(--color-text-secondary);
}

.assign-note strong {
  color: var(--color-text);
}

.assign-hint {
  font-size: var(--text-sm);
  line-height: 1.7;
  color: var(--color-text-secondary);
}
</style>
