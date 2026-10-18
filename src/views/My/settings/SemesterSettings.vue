<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { AppButton, AppInput, AppSelect } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useSemesterStore } from '@/stores/semester'
import { useTimetableStore } from '@/stores/timetable'
import { formatMonthDay } from '@/utils/date'
import { computedSemesterEnd } from '@/utils/semester'
import type { SelectOption } from '@/types'
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
const timetable = useTimetableStore()
const router = useRouter()
const toast = useToast()

const settings = computed(() => semester.settings)
const weeks = computed(() => semester.weeks)
const endMismatch = computed(() => semester.endMismatch)
const computedEndLabel = computed(() => formatMonthDay(computedSemesterEnd(settings.value)))

/* ---------- v3.7.6：查看周次（与课程表页共用 timetable store 里的同一份状态） ---------- */

/** 正在查看的教学周：课程表页读的是同一个值，不从本页另存一份 */
const selectedWeek = computed(() => timetable.selectedWeek)
const viewingCurrentWeek = computed(() => timetable.viewingCurrentWeek)

/** 下拉选项：周次表来自学期设置（v3.7.5 起唯一的周次来源，不写死 20 周） */
const weekOptions = computed<SelectOption<number>[]>(() =>
  weeks.value.map((week) => ({
    label: `第 ${week.index} 周 · ${formatMonthDay(week.startDate)}-${formatMonthDay(week.endDate)}`,
    value: week.index,
  })),
)

const selectedWeekRange = computed(() => {
  const week = weeks.value.find((item) => item.index === selectedWeek.value)
  return week ? `${formatMonthDay(week.startDate)} — ${formatMonthDay(week.endDate)}` : ''
})

function selectWeek(value: number): void {
  timetable.setSelectedWeek(value)
}

function backToCurrentWeek(): void {
  const current = timetable.currentWeek
  if (current === undefined) return
  timetable.goToCurrentWeek()
  toast.success(`已回到本周（第 ${current} 周）`)
}

function openSchedule(): void {
  void router.push('/work/schedule')
}

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
        <!-- v3.7.6：周次选择从课程表页移到这里；课程表页只保留一个直达入口 -->
        <div class="week-switch" aria-label="切换课程表正在查看的教学周">
          <AppButton
            variant="ghost"
            size="sm"
            :disabled="selectedWeek <= 1"
            @click="timetable.stepSelectedWeek(-1)"
          >
            上一周
          </AppButton>
          <AppSelect
            class="week-select"
            :model-value="selectedWeek"
            :options="weekOptions"
            aria-label="选择教学周次"
            @update:model-value="selectWeek"
          />
          <AppButton
            variant="ghost"
            size="sm"
            :disabled="selectedWeek >= semester.weekCount"
            @click="timetable.stepSelectedWeek(1)"
          >
            下一周
          </AppButton>
          <AppButton
            v-if="timetable.currentWeek !== undefined && !viewingCurrentWeek"
            variant="secondary"
            size="sm"
            @click="backToCurrentWeek"
          >
            回到本周
          </AppButton>
          <AppButton variant="secondary" size="sm" @click="openSchedule">去课程表查看</AppButton>
        </div>

        <p class="week-switch-note">
          正在查看第 <strong>{{ selectedWeek }}</strong> 周（{{ selectedWeekRange }}）。
          这里切换的就是课程表页显示的周次；课程表页不再单独放周次选择卡片。
        </p>

        <p class="weeks-head">
          共 {{ semester.weekCount }} 周：第 1 周从 {{ settings.startDate }} 起，每周 7 天。
        </p>
        <p v-if="endMismatch" class="weeks-warn">
          学期结束日期（{{ settings.endDate }}）与按周数推算的最后一周结束日（{{
            computedEndLabel
          }}）不一致——这里只作提示，不会自动改动任何配置。
        </p>
        <ul class="week-list">
          <li v-for="week in weeks" :key="week.index">
            <button
              type="button"
              class="week-row"
              :class="{ 'is-selected': week.index === selectedWeek }"
              :aria-pressed="week.index === selectedWeek"
              @click="selectWeek(week.index)"
            >
              <span class="week-index">第{{ week.index }}周</span>
              <span class="week-range">
                {{ formatMonthDay(week.startDate) }} — {{ formatMonthDay(week.endDate) }}
              </span>
              <span v-if="week.index === selectedWeek" class="week-flag">正在查看</span>
            </button>
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

.week-switch {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--color-border-light);
}

.week-select {
  flex: 1 1 220px;
  min-width: 220px;
}

.week-switch-note {
  font-size: var(--font-secondary);
  color: var(--color-text-secondary);
  line-height: 1.7;
}

.week-switch-note strong {
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
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
  width: 100%;
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: 4px 6px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  font-family: inherit;
  font-size: var(--font-secondary);
  text-align: left;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.week-row:hover {
  background: var(--bg-hover);
}

.week-row:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.week-row.is-selected {
  background: var(--color-primary-soft);
}

.week-index {
  min-width: 4.5em;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}

.week-row.is-selected .week-index {
  color: var(--color-text-primary);
  font-weight: var(--font-weight-semibold);
}

.week-range {
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}

.week-flag {
  margin-left: auto;
  color: var(--color-primary-strong);
  font-size: var(--font-caption);
}
</style>
