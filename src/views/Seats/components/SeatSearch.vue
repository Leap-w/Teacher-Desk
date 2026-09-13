<script setup lang="ts">
import { computed, ref } from 'vue'
import { X } from 'lucide-vue-next'

import { formatStudentShortName } from '@/utils/student'
import type { Student } from '@/types'

/**
 * 学生定位（Search to Seat）：输入姓名（全名）或学号后四位；
 * 唯一命中 → Enter / 点击直接定位；重名（多名）→ 下拉列表供选择，避免跳错人。
 * 定位动作（高亮 / 滚动 / 闪烁 / 弹信息卡）由页面编排层执行。
 */

interface Props {
  /** 全部活跃学生（按学号升序） */
  students: Student[]
  /** 学生在当前方案中的座位文案（如「第3排第5列」）；未就座 / 缺座时返回 undefined */
  positionOf?: (studentId: string) => string | undefined
  placeholder?: string
}

const props = withDefaults(defineProps<Props>(), {
  positionOf: undefined,
  placeholder: '定位学生：姓名 / 学号后四位',
})

const emit = defineEmits<{
  /** 命中的学生（已由本组件在重名时完成消歧） */
  locate: [student: Student]
}>()

const query = ref('')
const open = ref(false)

/** 候选项：姓名全名匹配 或 学号后四位匹配（输入非空时） */
const candidates = computed<Student[]>(() => {
  const keyword = query.value.trim()
  if (!keyword) return []
  return props.students.filter(
    (student) => student.name === keyword || student.studentNo.slice(-4) === keyword,
  )
})

function reset() {
  query.value = ''
  open.value = false
}

function choose(student: Student) {
  emit('locate', student)
  reset()
}

/** Enter：唯一命中直接定位；多名命中则保持列表人工选择（不猜测） */
function onEnter() {
  if (!query.value.trim()) return
  if (candidates.value.length === 1) choose(candidates.value[0])
}

function onBlur() {
  // 让出焦点给下拉项点击（pointerdown.prevent 保持焦点时本分支通常不触发）
  window.setTimeout(() => {
    open.value = false
  }, 150)
}
</script>

<template>
  <div class="seat-search">
    <input
      v-model="query"
      class="seat-search-input"
      type="text"
      :placeholder="placeholder"
      :aria-label="placeholder"
      spellcheck="false"
      autocomplete="off"
      @focus="open = true"
      @blur="onBlur"
      @keydown.enter.prevent="onEnter"
      @keydown.esc.prevent="reset"
    />
    <svg
      v-if="!query.trim()"
      class="seat-search-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7"></circle>
      <path d="m20 20-3.5-3.5"></path>
    </svg>
    <button
      v-else
      class="seat-search-clear"
      type="button"
      aria-label="清空搜索"
      @pointerdown.prevent
      @click="reset"
    >
      <X :size="12" :stroke-width="2" aria-hidden="true" />
    </button>

    <ul v-if="open && query.trim()" class="seat-search-pop" role="listbox">
      <li v-if="candidates.length === 0" class="is-empty">未找到：{{ query.trim() }}</li>
      <li v-else-if="candidates.length > 1" class="is-tip">
        找到 {{ candidates.length }} 名学生，请选择：
      </li>
      <li v-for="student in candidates" :key="student.id" role="option">
        <button
          type="button"
          class="seat-search-item"
          @pointerdown.prevent
          @click="choose(student)"
        >
          <span class="search-item-name">{{ formatStudentShortName(student) }}</span>
          <span class="search-item-meta">
            {{ positionOf ? (positionOf(student.id) ?? '未就座') : '' }}
          </span>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.seat-search {
  position: relative;
  width: 232px;
}

.seat-search-input {
  width: 100%;
  height: 34px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  padding: 0 30px 0 30px;
  font-size: var(--text-sm);
  color: var(--color-text);
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.seat-search-input::placeholder {
  color: var(--color-text-faint);
}

.seat-search-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: var(--ring-focus);
}

.seat-search-icon {
  position: absolute;
  left: 9px;
  top: 50%;
  width: 14px;
  height: 14px;
  transform: translateY(-50%);
  color: var(--color-text-faint);
  pointer-events: none;
}

.seat-search-clear {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: var(--color-fill-disabled);
  color: var(--color-text-secondary);
  font-size: 10px;
  cursor: pointer;
}

.seat-search-clear:hover {
  background: var(--color-border);
  color: var(--color-text);
}

.seat-search-pop {
  position: absolute;
  left: 0;
  right: 0;
  top: 38px;
  z-index: 960; /* 高于信息卡（920），低于弹窗（--z-modal） */
  display: grid;
  gap: 2px;
  max-height: 300px;
  overflow-y: auto;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--color-surface);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}

.seat-search-pop li.is-empty,
.seat-search-pop li.is-tip {
  padding: 6px 8px;
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}

.seat-search-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  width: 100%;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  padding: 6px 8px;
  font-size: var(--text-sm);
  color: var(--color-text);
  cursor: pointer;
  text-align: left;
}

.seat-search-item:hover {
  background: var(--color-primary-soft);
}

.search-item-meta {
  flex-shrink: 0;
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
</style>
