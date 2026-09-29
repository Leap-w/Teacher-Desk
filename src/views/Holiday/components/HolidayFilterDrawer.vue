<script setup lang="ts">
import { ref, watch } from 'vue'

import { AppButton, AppDrawer, AppField, AppInput, AppSegmented, AppSelect } from '@/components/ui'
import { FAMILY_SCOPE_OPTIONS } from '@/utils/student'
import { HOLIDAY_STATUS_LABELS } from '@/utils/holiday'
import type { HolidayRosterFilters } from '@/utils/holidayQuery'
import type { FamilyScope, Gender, SelectOption } from '@/types'
import type { HolidayStatus } from '@/types/holiday'

/**
 * HolidayFilterDrawer — 假期名单的五组筛选（规格第 4 节，**AND 组合**）。
 *
 * 抽屉里改的是**草稿**，点「应用」才生效：五组条件是组合起来才有意义的
 * （「昌都市区 + 有亲属 + 未登记」才是教师脑子里那个问题），边改边筛会让名单
 * 在手指底下反复跳，反而看不清自己筛出了什么。
 *
 * 每一组的「全部」在数据里就是 `undefined`——不发明第六个枚举值（见 `HolidayRosterFilters`）。
 * 界面上那个「全部」是一个**段落控件的位置**，落到数据上就是「这一条不加限制」。
 */
const props = defineProps<{
  modelValue: boolean
  filters: HolidayRosterFilters
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** 点「应用」时带出草稿；点「重置」带出一份空的 */
  apply: [filters: HolidayRosterFilters]
}>()

/** 段落控件的取值：把 `undefined` 映射成一个真实可点的档位（界面概念，不落数据） */
type AllOr<T extends string> = 'all' | T

const ALL_LABEL = '全部'

const GENDER_OPTIONS: { value: AllOr<Gender>; label: string }[] = [
  { value: 'all', label: ALL_LABEL },
  { value: 'female', label: '女' },
  { value: 'male', label: '男' },
]

const RELATIVE_OPTIONS: { value: AllOr<'yes' | 'no'>; label: string }[] = [
  { value: 'all', label: ALL_LABEL },
  { value: 'yes', label: '有' },
  { value: 'no', label: '无' },
]

const STATUS_OPTIONS: { value: AllOr<HolidayStatus>; label: string }[] = [
  { value: 'all', label: ALL_LABEL },
  { value: 'unregistered', label: HOLIDAY_STATUS_LABELS.unregistered },
  { value: 'home', label: HOLIDAY_STATUS_LABELS.home },
  { value: 'stay', label: HOLIDAY_STATUS_LABELS.stay },
]

/** 家庭所在地多一档「全部」；`''` 就是「不限」（AppSelect 的 value 只认字符串与数字） */
const SCOPE_OPTIONS: SelectOption<string>[] = [
  { label: ALL_LABEL, value: '' },
  ...FAMILY_SCOPE_OPTIONS,
]

const draft = ref({
  keyword: '',
  gender: 'all' as AllOr<Gender>,
  scope: '',
  relative: 'all' as AllOr<'yes' | 'no'>,
  status: 'all' as AllOr<HolidayStatus>,
})

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    draft.value = {
      keyword: props.filters.keyword,
      gender: props.filters.gender ?? 'all',
      scope: props.filters.scope ?? '',
      relative:
        props.filters.relative === undefined ? 'all' : props.filters.relative ? 'yes' : 'no',
      status: props.filters.status ?? 'all',
    }
  },
  { immediate: true },
)

function close(): void {
  emit('update:modelValue', false)
}

function apply(): void {
  const value = draft.value
  emit('apply', {
    keyword: value.keyword.trim(),
    ...(value.gender === 'all' ? {} : { gender: value.gender }),
    ...(value.scope ? { scope: value.scope as FamilyScope } : {}),
    ...(value.relative === 'all' ? {} : { relative: value.relative === 'yes' }),
    ...(value.status === 'all' ? {} : { status: value.status }),
  })
  close()
}

function reset(): void {
  emit('apply', { keyword: '' })
  close()
}
</script>

<template>
  <AppDrawer :model-value="modelValue" title="筛选名单" :width="420" @update:model-value="close">
    <div class="filter-form">
      <AppField label="姓名或学号" hint="也搜电话 / 备注（与「我的学生」页同一套搜索）">
        <AppInput v-model="draft.keyword" placeholder="点这里输入" clearable />
      </AppField>

      <AppField label="性别">
        <AppSegmented v-model="draft.gender" :options="GENDER_OPTIONS" label="性别" />
      </AppField>

      <AppField label="家庭所在地">
        <AppSelect v-model="draft.scope" :options="SCOPE_OPTIONS" />
      </AppField>

      <AppField label="昌都市内亲属">
        <AppSegmented v-model="draft.relative" :options="RELATIVE_OPTIONS" label="昌都市内亲属" />
      </AppField>

      <AppField label="登记状态">
        <AppSegmented v-model="draft.status" :options="STATUS_OPTIONS" label="登记状态" />
      </AppField>
    </div>

    <template #footer>
      <AppButton variant="ghost" @click="reset">重置</AppButton>
      <AppButton @click="apply">应用</AppButton>
    </template>
  </AppDrawer>
</template>

<style scoped>
.filter-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
</style>
