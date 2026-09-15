<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { AppButton, AppModal, TemplateDownloadLink } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useDutyStore } from '@/stores/duty'
import { useStudentStore } from '@/stores/student'
import {
  DUTY_ARRANGE_HEADERS,
  DUTY_ARRANGE_HINT,
  DUTY_ARRANGE_SAMPLE,
  DUTY_GROUP_HEADERS,
  DUTY_GROUP_HINT,
  DUTY_GROUP_SAMPLE,
  parseDutyArrangeRows,
  parseDutyGroupRows,
  planDutyArrangeImport,
  planDutyGroupImport,
} from '@/services/dutyImport'
import { readSheetRows } from '@/services/studentImport'
import { describeRotation } from '@/utils/duty'

/**
 * 值日 Excel 导入弹窗（V1.1.5）：`mode = 'groups'` 导入分组、`'arrange'` 导入安排。
 * 与座位 / 学生 / 课程 / 工作导入同款流程：选择 → 解析 → 校验 → 预览 → 确认 →
 * **一次性写入**；有错禁止确认、取消不写。
 */
interface Props {
  modelValue: boolean
  mode: 'groups' | 'arrange'
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const toast = useToast()
const dutyStore = useDutyStore()
const studentStore = useStudentStore()

const fileInput = ref<HTMLInputElement>()
const parsing = ref(false)
const parseError = ref('')
const selectedFile = ref<File | null>(null)
const groupPlan = ref<ReturnType<typeof planDutyGroupImport> | null>(null)
const arrangePlan = ref<ReturnType<typeof planDutyArrangeImport> | null>(null)

const isGroups = computed(() => props.mode === 'groups')
const HINT = computed(() => (isGroups.value ? DUTY_GROUP_HINT : DUTY_ARRANGE_HINT))
const HEADERS = computed(() => (isGroups.value ? DUTY_GROUP_HEADERS : DUTY_ARRANGE_HEADERS))
const SAMPLE = computed(() => (isGroups.value ? DUTY_GROUP_SAMPLE : DUTY_ARRANGE_SAMPLE))

const canConfirm = computed(() => {
  if (isGroups.value) {
    const plan = groupPlan.value
    return plan !== null && plan.errorCount === 0 && plan.importable > 0
  }
  const plan = arrangePlan.value
  return plan !== null && plan.errorCount === 0 && plan.importable > 0
})

watch(
  () => props.modelValue,
  (open) => {
    if (!open) {
      groupPlan.value = null
      arrangePlan.value = null
      parseError.value = ''
      selectedFile.value = null
      if (fileInput.value) fileInput.value.value = ''
    }
  },
)

async function onFileChange(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  selectedFile.value = file
  parsing.value = true
  parseError.value = ''
  groupPlan.value = null
  arrangePlan.value = null

  try {
    const buffer = await file.arrayBuffer()
    const sheet = await readSheetRows(buffer)
    if (!sheet.ok) {
      parseError.value = sheet.error
      return
    }
    if (isGroups.value) {
      const parsed = parseDutyGroupRows(sheet.rows)
      if (!parsed.ok) {
        parseError.value = parsed.error
        return
      }
      groupPlan.value = planDutyGroupImport(
        parsed.rows,
        studentStore.activeStudents,
        dutyStore.groups,
      )
    } else {
      const parsed = parseDutyArrangeRows(sheet.rows)
      if (!parsed.ok) {
        parseError.value = parsed.error
        return
      }
      arrangePlan.value = planDutyArrangeImport(parsed.rows, dutyStore.groups, dutyStore.settings)
    }
  } catch (error) {
    parseError.value = error instanceof Error ? error.message : '文件读取失败'
  } finally {
    parsing.value = false
  }
}

function onConfirm(): void {
  if (isGroups.value) {
    const plan = groupPlan.value
    if (!plan || !canConfirm.value) return
    const outcome = dutyStore.applyDutyGroupImport(plan.plan)
    if (!outcome.ok) {
      toast.danger(outcome.reason)
      return
    }
    toast.success(
      `导入完成：更新 ${outcome.updated} 个组、新建 ${outcome.created} 个组，共 ${outcome.members} 名组员`,
    )
  } else {
    const plan = arrangePlan.value
    if (!plan || !canConfirm.value) return
    const outcome = dutyStore.applyDutyArrangeImport(plan.plan)
    if (!outcome.ok) {
      toast.danger(outcome.reason)
      return
    }
    toast.success(
      `导入完成：轮换从 ${outcome.startDate} 起（${describeRotation(dutyStore.settings, dutyStore.groups)}）`,
    )
  }
  emit('update:modelValue', false)
}
</script>

<template>
  <AppModal
    :model-value="modelValue"
    :title="isGroups ? '从 Excel 导入分组' : '从 Excel 导入安排'"
    :width="720"
    @update:model-value="emit('update:modelValue', false)"
  >
    <div class="import-body">
      <header class="hint">
        <p class="hint-text">{{ HINT }}</p>
        <TemplateDownloadLink
          :filename="isGroups ? '值日分组导入模板' : '值日安排导入模板'"
          :sheet-name="isGroups ? '值日分组' : '值日安排'"
          :headers="HEADERS"
          :sample="SAMPLE"
        />
      </header>

      <div class="file-row">
        <input
          ref="fileInput"
          type="file"
          accept=".xlsx,.xls"
          class="file-input"
          @change="onFileChange"
        />
        <p v-if="selectedFile" class="file-name">已选择：{{ selectedFile.name }}</p>
      </div>

      <p v-if="parsing" class="status-text">正在解析表格…</p>
      <p v-else-if="parseError" class="status-text is-error">{{ parseError }}</p>

      <!-- 分组预览 -->
      <section v-if="groupPlan" class="summary">
        <h3 class="summary-title">导入预览</h3>
        <ul class="summary-list">
          <li>数据行：{{ groupPlan.total }}</li>
          <li>
            可导入：<strong>{{ groupPlan.importable }}</strong>
          </li>
          <li>更新组：{{ groupPlan.plan.updates.length }}</li>
          <li>新建组：{{ groupPlan.groupsCreated }}</li>
          <li v-if="groupPlan.blocked > 0" class="is-error">被拦行数：{{ groupPlan.blocked }}</li>
        </ul>
        <p class="summary-note">未涉及的分组保持不变；组序 = 轮换顺序，新建的组排在队尾。</p>

        <div v-if="groupPlan.errorCount > 0" class="errors">
          <p class="errors-title">以下行无法导入：</p>
          <ul class="errors-list">
            <li
              v-for="row in groupPlan.rows.filter((r) => r.action === 'blocked').slice(0, 5)"
              :key="row.rowNumber"
            >
              第 {{ row.rowNumber }} 行：{{ row.errors.join('；') }}
            </li>
          </ul>
          <p v-if="groupPlan.blocked > 5" class="errors-more">
            仅显示前 5 条，共 {{ groupPlan.blocked }} 条错误
          </p>
        </div>
      </section>

      <!-- 安排预览 -->
      <section v-if="arrangePlan" class="summary">
        <h3 class="summary-title">导入预览</h3>
        <ul class="summary-list">
          <li>数据行：{{ arrangePlan.total }}</li>
          <li>
            可导入：<strong>{{ arrangePlan.importable }}</strong>
          </li>
          <li>覆盖值日日：{{ arrangePlan.days }}</li>
          <li>轮换起点：{{ arrangePlan.plan.startDate }}</li>
          <li v-if="arrangePlan.blocked > 0" class="is-error">
            被拦行数：{{ arrangePlan.blocked }}
          </li>
        </ul>
        <p class="summary-note">
          安排会换算成轮换起点 + 组顺序（组顺序 = 表里各组出现的先后；未提到的组排在其后）， 周末{{
            arrangePlan.plan.includeWeekend ? '照常排' : '不排'
          }}。
        </p>

        <div v-if="arrangePlan.errorCount > 0" class="errors">
          <p class="errors-title">以下行无法导入：</p>
          <ul class="errors-list">
            <li
              v-for="row in arrangePlan.rows.filter((r) => r.action === 'blocked').slice(0, 5)"
              :key="row.rowNumber"
            >
              第 {{ row.rowNumber }} 行：{{ row.errors.join('；') }}
            </li>
          </ul>
          <p v-if="arrangePlan.blocked > 5" class="errors-more">
            仅显示前 5 条，共 {{ arrangePlan.blocked }} 条错误
          </p>
        </div>
      </section>
    </div>

    <template #footer>
      <AppButton variant="ghost" @click="emit('update:modelValue', false)">取消</AppButton>
      <AppButton :disabled="!canConfirm" @click="onConfirm">
        确认导入 {{ isGroups ? (groupPlan?.importable ?? 0) : (arrangePlan?.importable ?? 0) }} 行
      </AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.import-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-fill-disabled);
}

.hint-text {
  font-size: var(--text-xs);
  line-height: 1.7;
  color: var(--color-text-secondary);
}

.file-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.file-input {
  font-size: var(--text-sm);
}

.file-name {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.status-text {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.status-text.is-error {
  color: var(--color-danger-strong);
}

.summary {
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-fill-disabled);
}

.summary-title {
  font-size: var(--text-sm);
  font-weight: 600;
  margin-bottom: var(--space-2);
}

.summary-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  list-style: none;
  padding: 0;
  margin: 0;
}

.summary-list strong {
  color: var(--color-primary-strong);
  font-size: var(--text-sm);
}

.summary-list .is-error {
  color: var(--color-danger-strong);
}

.summary-note {
  margin-top: var(--space-2);
  font-size: var(--text-xs);
  line-height: 1.7;
  color: var(--color-text-faint);
}

.errors {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}

.errors-title {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-danger-strong);
  margin-bottom: var(--space-1);
}

.errors-list {
  list-style: none;
  padding: 0;
  margin: 0;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.errors-list li {
  padding: 2px 0;
}

.errors-more {
  margin-top: var(--space-1);
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
</style>
