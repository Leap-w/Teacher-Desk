<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { AppInput } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useSemesterStore } from '@/stores/semester'
import { formatMonthDay } from '@/utils/date'
import { computedSemesterEnd } from '@/utils/semester'
import SettingsPage from '../components/SettingsPage.vue'
import SettingsSection from '../components/SettingsSection.vue'
import SettingsField from '../components/SettingsField.vue'

/**
 * 学期设置（v3.7.5）——教学周次的统一配置来源。
 *
 * 四个字段里前三个决定周次（名称 / 开学日期 / 总周数），**结束日期只作记录**：
 * 它不参与教学周次生成、值日轮换或换课计算；与按周数推算的最后一周结束日不一致时
 * 只在下面给一条提示，**不自动改任何配置**（spec §3.1）。
 *
 * 写入纪律沿用课程时间页：**不拦输入、只拦结果**——store 校验没过就不写盘，
 * 名称与周数改用「失焦 / 回车提交」的草稿值，避免每敲一个字写一次盘。
 */
const semester = useSemesterStore()
const toast = useToast()

const settings = computed(() => semester.settings)
const weeks = computed(() => semester.weeks)
const endMismatch = computed(() => semester.endMismatch)
const computedEndLabel = computed(() => formatMonthDay(computedSemesterEnd(settings.value)))

/* ---------- 名称 / 周数：草稿 + 提交（失焦或回车），失败弹回 ---------- */
const nameDraft = ref(settings.value.name)
const weeksDraft = ref(String(settings.value.totalWeeks))
watch(settings, (value) => {
  nameDraft.value = value.name
  weeksDraft.value = String(value.totalWeeks)
})

function reject(reason: string): void {
  toast.danger(reason)
  nameDraft.value = settings.value.name
  weeksDraft.value = String(settings.value.totalWeeks)
}

function commitName(): void {
  if (nameDraft.value.trim() === settings.value.name) return
  const outcome = semester.update({ name: nameDraft.value })
  if (!outcome.ok) reject(outcome.reason)
  else toast.success('学期名称已保存')
}

function commitWeeks(): void {
  const parsed = Number(weeksDraft.value)
  if (parsed === settings.value.totalWeeks) return
  const outcome = semester.update({ totalWeeks: parsed })
  if (!outcome.ok) reject(outcome.reason)
}

/* ---------- 开学日期 / 结束日期：选完即提交（与课程时间页同一节奏） ---------- */

function commitStartDate(value: string): void {
  if (value === settings.value.startDate) return
  const outcome = semester.update({ startDate: value })
  if (!outcome.ok) toast.danger(outcome.reason)
}

function commitEndDate(value: string): void {
  if (value === settings.value.endDate) return
  const outcome = semester.update({ endDate: value })
  if (!outcome.ok) toast.danger(outcome.reason)
}
</script>

<template>
  <SettingsPage title="学期设置" subtitle="教学周次的统一来源，课程表换课按它选择周次">
    <SettingsSection title="学期信息">
      <SettingsField label="学期名称">
        <template #control>
          <AppInput
            v-model="nameDraft"
            aria-label="学期名称"
            :maxlength="20"
            @change="commitName"
            @blur="commitName"
            @keyup.enter="commitName"
          />
        </template>
      </SettingsField>

      <SettingsField label="开学日期" hint="第 1 周的起始日期；教学周次从这一天起每 7 天一周">
        <template #control>
          <AppInput
            type="date"
            :model-value="settings.startDate"
            aria-label="开学日期"
            @update:model-value="commitStartDate(String($event))"
          />
        </template>
      </SettingsField>

      <SettingsField label="学期总周数" hint="正整数；下面的教学周次列表随它动态变化">
        <template #control>
          <AppInput
            v-model="weeksDraft"
            type="number"
            aria-label="学期总周数"
            @change="commitWeeks"
            @blur="commitWeeks"
            @keyup.enter="commitWeeks"
          />
        </template>
      </SettingsField>

      <SettingsField
        label="学期结束日期"
        hint="选填，仅作记录：不参与教学周次生成、值日轮换或换课计算，可留空"
      >
        <template #control>
          <AppInput
            type="date"
            clearable
            :model-value="settings.endDate"
            aria-label="学期结束日期"
            @update:model-value="commitEndDate(String($event))"
          />
        </template>
      </SettingsField>
    </SettingsSection>

    <SettingsSection title="教学周次">
      <div class="weeks">
        <p class="weeks-head">
          共 {{ semester.weekCount }} 周：第 1 周从 {{ settings.startDate }} 起，每周 7 天。
        </p>
        <p v-if="endMismatch" class="weeks-warn">
          学期结束日期（{{ settings.endDate }}）与按周数推算的最后一周结束日（{{
            computedEndLabel
          }}）不一致——这里只作提示，不会自动改动任何配置。
        </p>
        <ul class="week-list">
          <li v-for="week in weeks" :key="week.index" class="week-row">
            <span class="week-index">第{{ week.index }}周</span>
            <span class="week-range">
              {{ formatMonthDay(week.startDate) }} — {{ formatMonthDay(week.endDate) }}
            </span>
          </li>
        </ul>
      </div>
    </SettingsSection>
  </SettingsPage>
</template>

<style scoped>
.weeks {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
}

.weeks-head {
  font-size: var(--font-secondary);
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.weeks-warn {
  font-size: var(--font-secondary);
  color: var(--color-warning-strong, var(--color-danger-strong));
  line-height: 1.6;
}

.week-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: var(--space-1) var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.week-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: 2px 0;
  font-size: var(--font-secondary);
}

.week-index {
  min-width: 4.5em;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}

.week-range {
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}
</style>
