<script setup lang="ts">
import { Users, Pencil } from 'lucide-vue-next'

import { EmptyState } from '@/components/ui'
import { familyScopeLabel, formatStudentShortName } from '@/utils/student'
import HolidayStatusBadge from './HolidayStatusBadge.vue'
import type { HolidayRosterRow } from '@/utils/holidayQuery'

/**
 * HolidayRosterList — 假期名单（可多选 + 学生级备注）。
 *
 * **整行就是勾选目标**，不再单独放一个 16px 的小方框：手机上点那个小框是常见误操作，
 * 而这里每一次点选都直接决定接下来「批量设为」会改到谁，点偏一行的代价是改错一个人的去向。
 * 复选框仍然画着，但它是**状态显示**（`pointer-events: none`），点击由整行接管。
 *
 * v3.6.2 在这一行里加了**备注**：
 * - 有备注时在名字下面以一行摘要显示（`备注：由姐姐接回`），**单行截断**——
 *   长备注不撑高列表（规格第 18 节），要看全文就点右边的备注按钮；
 * - 右侧那颗小按钮是**独立于选中的编辑入口**（`@click.stop`），
 *   留校学生同样有它（规格第 20 节）。
 *
 * 学号为空时不显示那一截（真实班级里学号大面积空缺，写一个空的「学号：」更难读）。
 */
defineProps<{
  rows: HolidayRosterRow[]
  selectedIds: Set<string>
  nameCounts: ReadonlyMap<string, number>
  /** 当前是否筛过（决定空态文案是「筛没了」还是「本来就没人」） */
  filtered: boolean
}>()

const emit = defineEmits<{
  toggle: [studentId: string]
  editNote: [studentId: string]
}>()
</script>

<template>
  <div v-if="rows.length" class="roster">
    <div
      v-for="row in rows"
      :key="row.student.id"
      class="roster-row"
      :class="{ 'is-selected': selectedIds.has(row.student.id) }"
      role="checkbox"
      :aria-checked="selectedIds.has(row.student.id)"
      :aria-label="`选择 ${row.student.name}`"
      tabindex="0"
      @click="emit('toggle', row.student.id)"
      @keydown.space.prevent="emit('toggle', row.student.id)"
      @keydown.enter.prevent="emit('toggle', row.student.id)"
    >
      <span class="row-box" aria-hidden="true">
        <svg viewBox="0 0 16 16" class="row-tick">
          <path d="M3.5 8.4 6.4 11.2 12.5 5" fill="none" stroke-width="2" stroke-linecap="round" />
        </svg>
      </span>

      <span class="row-main">
        <span class="row-name">
          {{ formatStudentShortName(row.student, nameCounts) }}
        </span>
        <span class="row-meta">
          <span v-if="row.student.studentNo">{{ row.student.studentNo }}</span>
          <span v-if="familyScopeLabel(row.student.familyLocation)" class="row-scope">
            {{ familyScopeLabel(row.student.familyLocation) }}
          </span>
        </span>
        <span v-if="row.note" class="row-note" :title="row.note">备注：{{ row.note }}</span>
      </span>

      <HolidayStatusBadge :status="row.status" />

      <button
        type="button"
        class="row-note-btn"
        :class="{ 'has-note': !!row.note }"
        :aria-label="
          row.note ? `编辑 ${row.student.name} 的假期备注` : `为 ${row.student.name} 添加假期备注`
        "
        :title="row.note ? '编辑假期备注' : '添加假期备注'"
        @click.stop="emit('editNote', row.student.id)"
        @keydown.space.stop
        @keydown.enter.stop
      >
        <Pencil :size="14" :stroke-width="2" aria-hidden="true" />
        <span v-if="row.note" class="row-note-btn-text">备注</span>
      </button>
    </div>
  </div>

  <div v-else class="roster-empty">
    <EmptyState
      :icon="Users"
      :title="filtered ? '没有符合条件的学生' : '还没有在读学生'"
      :description="
        filtered
          ? '换个条件再筛，或再点一次统计卡片取消筛选看回全部名单。'
          : '先到「学生档案」添加学生。'
      "
    />
  </div>
</template>

<style scoped>
.roster {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.roster-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  /* 触控目标 ≥44px，整行可点（见组件说明） */
  min-height: 52px;
  padding: var(--space-2) var(--space-3);
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast);
}

.roster-row:hover {
  background: var(--bg-hover);
}

.roster-row:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.roster-row.is-selected {
  background: var(--color-primary-soft);
  border-color: var(--color-primary);
}

.row-box {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-xs);
  background: var(--color-bg-white);
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast);
}

.roster-row.is-selected .row-box {
  background: var(--color-primary);
  border-color: var(--color-primary);
}

.row-tick {
  width: 14px;
  height: 14px;
  stroke: var(--color-text-inverse);
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.roster-row.is-selected .row-tick {
  opacity: 1;
}

.row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.row-name {
  font-size: var(--text-md);
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-meta {
  display: flex;
  gap: var(--space-2);
  font-size: var(--font-caption);
  color: var(--color-text-faint);
}

/* 备注摘要：单行截断，绝不撑高列表（长备注点备注按钮看全文） */
.row-note {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-note-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  /* 触控目标：高度 40px，配合行高不会把小屏挤坏 */
  min-height: 40px;
  padding: 0 var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-button);
  background: transparent;
  color: var(--color-text-faint);
  font-size: var(--font-caption);
  cursor: pointer;
  transition:
    background var(--transition-fast),
    color var(--transition-fast),
    border-color var(--transition-fast);
}

.row-note-btn:hover {
  background: var(--color-primary-bg);
  color: var(--color-primary-dark);
}

.row-note-btn.has-note {
  color: var(--color-primary-dark);
  border-color: var(--color-border-light);
  background: var(--color-primary-bg);
}

.row-note-btn:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.roster-empty {
  padding: var(--space-4) 0;
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
}
</style>
