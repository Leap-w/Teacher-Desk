<script setup lang="ts">
import { ref, watch } from 'vue'

import { AppButton, AppDrawer, AppField, AppInput, AppSegmented, AppSelect } from '@/components/ui'
import { FAMILY_SCOPE_OPTIONS } from '@/utils/student'
import type { HolidayRosterFilters } from '@/utils/holidayQuery'
import type { FamilyScope, Gender, SelectOption } from '@/types'

/**
 * HolidayFilterDrawer — 假期名单的四组筛选（**AND 组合**）。
 *
 * 抽屉里改的是**草稿**，点「应用」才生效：几组条件是组合起来才有意义的
 * （「昌都市区 + 有亲属」才是教师脑子里那个问题），边改边筛会让名单
 * 在手指底下反复跳，反而看不清自己筛出了什么。
 *
 * 每一组的「全部」在数据里就是 `undefined`——不发明第六个枚举值（见 `HolidayRosterFilters`）。
 * 界面上那个「全部」是一个**段落控件的位置**，落到数据上就是「这一条不加限制」。
 *
 * **v3.6.2 删掉了「登记状态」这一组**：去向的筛选入口统一收进顶部三张统计卡片
 * （离校 / 留校 / 昌都市外离校），抽屉里再留一套状态筛选就成了第二个口径，
 * 教师会看不出名单到底被哪一边筛过。这里只剩「不看去向」的那几组条件。
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
    }
  },
  { immediate: true },
)

function close(): void {
  emit('update:modelValue', false)
}

/**
 * 应用时**只产出抽屉管的这几组条件**。顶部统计卡片的快捷筛选是**另一维**
 * （页面自己那个 `card` ref 管着），两者在 `filterRoster` 里 AND 组合；
 * 抽屉这里既不读也不写它——「重置」因此不会顺手把教师刚点的「留校」卡片清掉
 * （那是页面上看得见的一个选中态，悄悄改掉它比不改更让人困惑）。
 */
function apply(): void {
  const value = draft.value
  emit('apply', {
    keyword: value.keyword.trim(),
    ...(value.gender === 'all' ? {} : { gender: value.gender }),
    ...(value.scope ? { scope: value.scope as FamilyScope } : {}),
    ...(value.relative === 'all' ? {} : { relative: value.relative === 'yes' }),
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
