<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { Check, Plus, X } from 'lucide-vue-next'

import { AppInput } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useFundStore } from '@/stores/fund'
import { categoryIcon, isPresetName } from '@/utils/fund'
import type { FundRecordType } from '@/types/fund'

/**
 * FundCategoryPicker — 分类选择（v3.6.0，规格第五 / 六节）。
 *
 * 预设分类（带 emoji）+ 教师自建分类，末尾一个「+ 自定义类型」。
 * 自建项**存到本地、长期复用**：下次再记同类支出时它在同一排里等着，不用再输一次。
 *
 * 三处刻意的地方：
 *
 * ① 自建项上的 `×` 是**立即生效**的（不再套一层确认框）。删错了当场再打一遍字就能加回，
 *    而多一层弹窗会让「清掉一个打错的类型」变成三步操作。删除**不动任何已有流水**——
 *    分类名是记在那笔流水上的事实，这一点由 toast 如实说明。
 *
 * ② 输入框里敲的名字**与预设重名时拒绝**：表单里会出现两个一模一样的选项。
 *    也被 `store.addCategory` 再挡一次（数据层兜底，§11.4）。
 *
 * ③ 新加的分类**当场选中**：教师说得出这个名字，就是想把这一笔记到它下面，
 *    加完还要再点一下是多余的一步。
 *
 * ④ 当前选中的自建项**不显示 `×`**：正在编辑的那笔流水还认着这个分类名（`keep` 会把它
 *    留在列表里），删掉它那个 chip 也不会消失——一个点了没反应的按钮比没有按钮更糟。
 *    想删先点别的分类即可。
 */
const props = defineProps<{
  /** 决定给哪一套预设：收入与支出各一套（规格第五 / 六节） */
  type: FundRecordType
  modelValue: string
}>()

const emit = defineEmits<{ 'update:modelValue': [string] }>()

const fundStore = useFundStore()
const toast = useToast()

interface ChipItem {
  name: string
  icon: string
  /** 自建项（可删除）；预设项没有这个入口 */
  custom: boolean
}

const chips = computed<ChipItem[]>(() =>
  fundStore.categoryNamesOf(props.type, props.modelValue).map((name) => ({
    name,
    icon: categoryIcon(name, props.type),
    custom: fundStore.categories.some((item) => item.type === props.type && item.name === name),
  })),
)

/* ---------- 新增自定义类型 ---------- */

const adding = ref(false)
const draft = ref('')
/** AppInput 没有把 focus 暴露出来（内部 input 被 $attrs 包着），这里从根元素上找 input */
const draftInput = ref<ComponentPublicInstance | null>(null)

async function openAdd() {
  adding.value = true
  draft.value = ''
  await nextTick()
  ;(draftInput.value?.$el as HTMLElement | undefined)?.querySelector('input')?.focus()
}

function cancelAdd() {
  adding.value = false
  draft.value = ''
}

function confirmAdd() {
  const name = draft.value.trim()
  if (!name) {
    toast.warning('请输入类型名称')
    return
  }
  if (isPresetName(name, props.type)) {
    toast.warning(`「${name}」已经是预设类型，直接选它就行`)
    return
  }
  if (fundStore.categories.some((item) => item.type === props.type && item.name === name)) {
    toast.info(`「${name}」已经在列表里了`)
    emit('update:modelValue', name)
    cancelAdd()
    return
  }
  const created = fundStore.addCategory(name, props.type)
  if (!created) {
    toast.danger('类型没能保存，请重试')
    return
  }
  emit('update:modelValue', created.name)
  cancelAdd()
}

/* ---------- 删除自定义类型 ---------- */

function removeChip(chip: ChipItem) {
  const target = fundStore.categories.find(
    (item) => item.type === props.type && item.name === chip.name,
  )
  if (!target) return
  const usage = fundStore.categoryUsage(chip.name)
  if (!fundStore.removeCategory(target.id)) {
    toast.danger('删除失败，请重试')
    return
  }
  // 如实说清后果：已有流水一点都不变，只是往后不再出现在选项里
  toast.success(
    usage > 0 ? `已删除「${chip.name}」，已有 ${usage} 笔记录的分类不变` : `已删除「${chip.name}」`,
  )
}
</script>

<template>
  <div class="category-picker" role="group" aria-label="分类">
    <button
      v-for="chip in chips"
      :key="chip.name"
      type="button"
      class="cat-chip"
      :class="{ 'is-active': modelValue === chip.name }"
      :aria-pressed="modelValue === chip.name ? 'true' : 'false'"
      @click="emit('update:modelValue', chip.name)"
    >
      <span v-if="chip.icon" class="cat-chip__icon" aria-hidden="true">{{ chip.icon }}</span>
      <span class="cat-chip__name">{{ chip.name }}</span>
      <Check
        v-if="modelValue === chip.name"
        :size="13"
        :stroke-width="2.5"
        class="cat-chip__check"
      />
      <span
        v-if="chip.custom && modelValue !== chip.name"
        class="cat-chip__remove"
        role="button"
        :aria-label="`删除类型 ${chip.name}`"
        @click.stop="removeChip(chip)"
      >
        <X :size="12" :stroke-width="2.5" />
      </span>
    </button>

    <span v-if="adding" class="cat-add-input">
      <AppInput
        ref="draftInput"
        v-model="draft"
        size="sm"
        :maxlength="8"
        placeholder="类型名，最多 8 字"
        @keydown.enter.prevent="confirmAdd"
        @keydown.esc.prevent="cancelAdd"
      />
      <button type="button" class="cat-add-confirm" aria-label="确定添加" @click="confirmAdd">
        <Check :size="15" :stroke-width="2.5" />
      </button>
      <button type="button" class="cat-add-cancel" aria-label="取消添加" @click="cancelAdd">
        <X :size="15" :stroke-width="2.5" />
      </button>
    </span>

    <button v-else type="button" class="cat-chip is-add" @click="openAdd">
      <Plus :size="13" :stroke-width="2.5" />
      <span class="cat-chip__name">自定义类型</span>
    </button>
  </div>
</template>

<style scoped>
.category-picker {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.cat-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-bg-white);
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  line-height: 1;
  cursor: pointer;
  user-select: none;
  transition:
    background var(--duration-base) var(--ease-out),
    color var(--duration-base) var(--ease-out),
    border-color var(--duration-base) var(--ease-out);
}

@media (hover: hover) {
  .cat-chip:hover:not(.is-active) {
    background: var(--bg-hover);
    color: var(--color-text-primary);
  }
}

.cat-chip:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.cat-chip.is-active {
  background: var(--color-primary-soft);
  border-color: transparent;
  color: var(--color-primary-dark);
  font-weight: var(--font-weight-medium);
}

.cat-chip__icon {
  font-size: 13px;
  line-height: 1;
}

.cat-chip__check {
  flex-shrink: 0;
}

.cat-chip.is-add {
  border-style: dashed;
  color: var(--color-text-tertiary);
}

/* 自建项上的删除点：克制的常显（手机上不会 hover，藏起来等于没有） */
.cat-chip__remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  margin-left: 1px;
  margin-right: -3px;
  border-radius: var(--radius-full);
  color: var(--color-text-tertiary);
}

@media (hover: hover) {
  .cat-chip__remove:hover {
    background: var(--color-danger-soft);
    color: var(--color-danger-strong);
  }
}

.cat-add-input {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.cat-add-input :deep(.app-input) {
  width: 168px;
}

.cat-add-confirm,
.cat-add-cancel {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-white);
  cursor: pointer;
}

.cat-add-confirm {
  border-color: transparent;
  background: var(--color-primary-soft);
  color: var(--color-primary-dark);
}

.cat-add-cancel {
  color: var(--color-text-tertiary);
}

.cat-add-confirm:focus-visible,
.cat-add-cancel:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

@media (max-width: 420px) {
  .cat-add-input :deep(.app-input) {
    width: 128px;
  }
}
</style>
