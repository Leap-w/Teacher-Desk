<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRight, CalendarRange, ClipboardList } from 'lucide-vue-next'

import { EmptyState } from '@/components/ui'
import { useAppSettingsStore } from '@/stores/appSettings'
import type { SubstituteRecord } from '@/types/substitute'
import { weekdayOfDateKey } from '@/utils/date'
import { WEEKDAY_LABELS, periodFullTextOf } from '@/utils/timetable'

/**
 * SubstituteList — 代课记录列表（v3.7.5 §6.2「查看代课记录列表」）。
 *
 * 一行讲清四件事：**哪一天哪儿节**、**谁的课**、**谁去上**、**什么科目**（备注另起一行）。
 * 「被代课 → 实际代课」两个方向各带一个标签：单看两个名字分不出谁替谁，
 * 箭头方向本身不是所有教师都会读的线索（§9.5：字段必须清楚易懂）。
 *
 * 排序由 store 的 `sorted` 决定（日期倒序 → 节次升序），本组件只渲染、不改序。
 * 节次的时间文案取**生效作息**（教学设置里改过时间就显示改后的），
 * 与课程表页同一口径（v3.3.0）。
 *
 * 三种空态各说各话：还没有任何记录 / 这段日期里没有记录 / 起止日期填反了——
 * 最后一种最容易被当成「统计坏了」，所以直接点名。
 */
const props = defineProps<{
  /** 已按日期范围筛过、已排序的记录 */
  records: readonly SubstituteRecord[]
  /** 库里还有没有记录（决定空态文案：没记过 vs 筛不出来） */
  hasAny: boolean
  /** 起止日期填反了（from > to）：此时列表必然为空，但这不等于「这段时间没有代课」 */
  rangeReversed?: boolean
}>()

const emit = defineEmits<{
  edit: [record: SubstituteRecord]
  remove: [record: SubstituteRecord]
}>()

const appSettings = useAppSettingsStore()

/** 生效作息里的一段：`第2节 · 09:20–10:00`；认不出的节次返回占位而不是空串 */
const periodTextOf = computed(
  () => (id: SubstituteRecord['periodId']) => periodFullTextOf(id, appSettings.periods),
)

const weekdayTextOf = (date: string) => WEEKDAY_LABELS[weekdayOfDateKey(date)]
</script>

<template>
  <div class="substitute-list">
    <article v-for="record in props.records" :key="record.id" class="substitute-card">
      <div class="card-when">
        <span class="when-date">{{ record.date }}</span>
        <span class="when-weekday">{{ weekdayTextOf(record.date) }}</span>
        <span class="when-period">{{ periodTextOf(record.periodId) }}</span>
      </div>

      <div class="card-main">
        <p class="card-pair">
          <span class="pair-side">
            <span class="pair-tag">被代课</span>
            <span class="pair-name">{{ record.originalTeacher }}</span>
          </span>
          <ArrowRight class="pair-arrow" :size="14" :stroke-width="2" aria-hidden="true" />
          <span class="pair-side">
            <span class="pair-tag is-substitute">实际代课</span>
            <span class="pair-name is-substitute">{{ record.substituteTeacher }}</span>
          </span>
          <span class="card-subject">{{ record.subject }}</span>
        </p>
        <p v-if="record.remark" class="card-remark">{{ record.remark }}</p>
      </div>

      <div class="card-actions">
        <button
          type="button"
          class="card-action"
          aria-label="编辑代课记录"
          @click="emit('edit', record)"
        >
          编辑
        </button>
        <button
          type="button"
          class="card-action is-danger"
          aria-label="删除代课记录"
          @click="emit('remove', record)"
        >
          删除
        </button>
      </div>
    </article>

    <EmptyState
      v-if="props.records.length === 0 && props.rangeReversed"
      :icon="CalendarRange"
      title="开始日期晚于结束日期"
      description="两个日期填反了，所以这里什么都没有。把先后的顺序调过来就能看到记录。"
    />
    <EmptyState
      v-else-if="props.records.length === 0 && props.hasAny"
      :icon="CalendarRange"
      title="这段时间里没有代课记录"
      description="换个日期范围看看，或者点「清除筛选」回到全部记录。"
    />
    <EmptyState
      v-else-if="props.records.length === 0"
      :icon="ClipboardList"
      title="还没有代课记录"
      description="点右下角的「＋ 记录代课」，把第一节代课登记下来。"
    />
  </div>
</template>

<style scoped>
.substitute-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.substitute-card {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-4);
  border: var(--border-hairline-width) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  transition:
    transform var(--duration-base) var(--ease-out),
    border-color var(--transition-fast),
    box-shadow var(--duration-base) var(--ease-out);
}

.substitute-card:hover {
  transform: translateY(-2px);
  border-color: var(--color-border-medium);
  box-shadow: var(--shadow-sm);
}

/* 左列：日期 / 星期 / 节次——等宽数字，扫一眼列就能比对先后 */
.card-when {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 132px;
  font-variant-numeric: tabular-nums;
}

.when-date {
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.when-weekday,
.when-period {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.card-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.card-pair {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
}

.pair-side {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.pair-tag {
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  background: var(--color-fill-disabled);
  color: var(--color-text-tertiary);
  font-size: var(--font-caption);
  white-space: nowrap;
}

.pair-tag.is-substitute {
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
}

.pair-name {
  font-size: var(--font-content);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pair-arrow {
  flex-shrink: 0;
  color: var(--color-text-faint);
}

.card-subject {
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: var(--color-fill-disabled);
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
}

.card-remark {
  margin: 0;
  font-size: var(--font-secondary);
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}

.card-actions {
  flex-shrink: 0;
  display: flex;
  gap: var(--space-1);
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.substitute-card:hover .card-actions,
.substitute-card:focus-within .card-actions {
  opacity: 1;
}

.card-action {
  padding: 4px 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
  cursor: pointer;
  transition:
    background var(--transition-fast),
    color var(--transition-fast);
}

.card-action:hover {
  background: var(--bg-hover);
  color: var(--color-text-primary);
}

.card-action.is-danger:hover {
  background: var(--color-danger-soft);
  color: var(--color-danger-strong);
}

/* 触屏没有 hover：操作按钮常显，否则等于没有入口 */
@media (hover: none) {
  .card-actions {
    opacity: 1;
  }
}

@media (max-width: 560px) {
  .substitute-card {
    flex-wrap: wrap;
  }

  .card-when {
    flex-direction: row;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
    width: 100%;
  }
}
</style>
